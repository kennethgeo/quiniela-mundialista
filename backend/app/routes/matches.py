"""Rutas para gestionar los partidos del mundial."""

import logging

import httpx
from fastapi import APIRouter, Body, Depends, Header, HTTPException, Query
from typing import Optional

from app.auth import get_current_user
from app.config import settings
from app.services.live_sync import sync_live_scores
from app.services.scoring import calculate_and_update_scores
from app.services.supabase_client import get_supabase

logger = logging.getLogger(__name__)

# Un refresco en vivo como mucho cada 20s en toda la app.
SEGUNDOS_ENTRE_REFRESCOS = 20

router = APIRouter(prefix="/api/matches", tags=["Partidos"])


@router.post("/recalc-scores")
async def recalc_scores(authorization: Optional[str] = Header(default=None)):
    """Recalcula los puntos de TODOS los partidos finalizados. Protegido con CRON_SECRET.

    Es idempotente (la función de scoring aplica solo la diferencia), así que
    sirve para corregir partidos que quedaron finalizados pero sin puntuar, sin
    duplicar puntos.
    """
    expected = settings.CRON_SECRET
    if not expected:
        raise HTTPException(status_code=503, detail="CRON_SECRET no configurado")
    if authorization != f"Bearer {expected}":
        raise HTTPException(status_code=401, detail="No autorizado")

    supabase = get_supabase()
    finished = (
        supabase.table("matches").select("id").eq("status", "finished").execute().data or []
    )
    updated_matches = 0
    errors = []
    for m in finished:
        try:
            r = await calculate_and_update_scores(supabase, m["id"])
            if r.get("predictions_updated"):
                updated_matches += 1
        except Exception as exc:  # noqa: BLE001
            errors.append(f"match {m['id']}: {exc}")

    return {
        "status": "ok",
        "finished": len(finished),
        "matches_with_changes": updated_matches,
        "errors": errors,
    }


@router.post("/reconcile-totals")
async def reconcile_totals(
    authorization: Optional[str] = Header(default=None),
    dry_run: bool = Query(default=True),
):
    """Reconcilia users.total_points con la suma autoritativa de puntos.

        total_points = Σ(predictions.points_earned)
                     + Σ(tournament_predictions.champion_points + top_scorer_points)

    Corrige el descuadre que provoca la lógica de deltas (fallos de red,
    ejecuciones concurrentes, etc.). NO modifica points_earned ni las
    predicciones: solo recalcula el agregado cacheado en users.total_points.

    Por defecto es dry_run (solo reporta). Pasa ?dry_run=false para aplicar.
    Protegido con CRON_SECRET.
    """
    expected = settings.CRON_SECRET
    if not expected:
        raise HTTPException(status_code=503, detail="CRON_SECRET no configurado")
    if authorization != f"Bearer {expected}":
        raise HTTPException(status_code=401, detail="No autorizado")

    supabase = get_supabase()

    def fetch_all(table: str, columns: str):
        rows = []
        start = 0
        page = 1000
        while True:
            chunk = (
                supabase.table(table)
                .select(columns)
                .range(start, start + page - 1)
                .execute()
                .data
                or []
            )
            rows.extend(chunk)
            if len(chunk) < page:
                break
            start += page
        return rows

    # Suma autoritativa por usuario
    totals: dict = {}
    for p in fetch_all("predictions", "user_id, points_earned"):
        uid = p["user_id"]
        totals[uid] = totals.get(uid, 0) + (p.get("points_earned") or 0)

    for tp in fetch_all("tournament_predictions", "user_id, champion_points, top_scorer_points"):
        uid = tp["user_id"]
        totals[uid] = totals.get(uid, 0) + (tp.get("champion_points") or 0) + (tp.get("top_scorer_points") or 0)

    users = fetch_all("users", "id, display_name, total_points, points_adjustment")

    discrepancies = []
    for u in users:
        uid = u["id"]
        stored = u.get("total_points") or 0
        # El ajuste manual del admin también forma parte del total autoritativo.
        computed = totals.get(uid, 0) + (u.get("points_adjustment") or 0)
        if stored != computed:
            discrepancies.append({
                "user_id": uid,
                "display_name": u.get("display_name"),
                "stored": stored,
                "computed": computed,
                "diff": computed - stored,
            })

    applied = 0
    if not dry_run:
        for d in discrepancies:
            supabase.table("users").update({"total_points": d["computed"]}).eq("id", d["user_id"]).execute()
            applied += 1

    return {
        "status": "ok",
        "dry_run": dry_run,
        "users_checked": len(users),
        "discrepancies": len(discrepancies),
        "applied": applied,
        "details": discrepancies,
    }


@router.post("/sync-live")
async def sync_live(authorization: Optional[str] = Header(default=None)):
    """Sincroniza marcadores en vivo desde worldcup26.ir. Protegido con CRON_SECRET.

    Pensado para ser invocado por un scheduler (GitHub Actions / Vercel Cron)
    enviando el header ``Authorization: Bearer <CRON_SECRET>``.
    """
    expected = settings.CRON_SECRET
    if not expected:
        raise HTTPException(status_code=503, detail="CRON_SECRET no configurado")
    if authorization != f"Bearer {expected}":
        raise HTTPException(status_code=401, detail="No autorizado")

    supabase = get_supabase()

    # El sync del Mundial y el de los demás torneos ESPN son independientes: si uno
    # falla (p. ej. el Mundial ya terminó y su fuente viene vacía), el otro igual corre.
    result = {}
    try:
        result = await sync_live_scores(supabase)
    except Exception as exc:  # noqa: BLE001 - no bloquear el resto de torneos
        result["live_scores_error"] = f"{type(exc).__name__}: {exc}"

    try:
        from app.services.espn_tournament_sync import sync_all_espn_tournaments
        result["espn_tournaments"] = await sync_all_espn_tournaments(supabase)
    except Exception as exc:  # noqa: BLE001
        result["espn_tournaments_error"] = str(exc)
    return result


@router.post("/notify-daily")
async def notify_daily(authorization: Optional[str] = Header(default=None)):
    """Resumen de los partidos del día. Pensado para dispararse a las 6am de
    Costa Rica (12:00 UTC) desde el cron de GitHub Actions.

    Va en el backend y no en una edge function a propósito: acá ya existe la
    autenticación por CRON_SECRET, ya está el envío de push, y se despliega
    solo con cada push a main. Una edge function habría que desplegarla a mano
    —un paso que ya se olvidó una vez— y hoy no hay pg_cron en la base que la
    dispare.
    """
    expected = settings.CRON_SECRET
    if not expected:
        raise HTTPException(status_code=503, detail="CRON_SECRET no configurado")
    if authorization != f"Bearer {expected}":
        raise HTTPException(status_code=401, detail="No autorizado")

    from datetime import datetime, timezone
    from app.services.notifications import enviar_push_personalizado
    from app.services.resumen_diario import armar_mensajes, ventana_del_dia

    supabase = get_supabase()
    desde, hasta = ventana_del_dia(datetime.now(timezone.utc))

    partidos = (
        supabase.table("matches")
        .select("id, tournament_id, home_team, away_team, kickoff_at, status")
        .gte("kickoff_at", desde.isoformat())
        .lt("kickoff_at", hasta.isoformat())
        .execute()
        .data
        or []
    )
    # Un partido cancelado o pospuesto no se anuncia.
    partidos = [p for p in partidos if p.get("status") not in ("cancelled", "postponed")]
    if not partidos:
        return {"status": "ok", "partidos": 0, "mensaje": "Hoy no se juega nada"}

    torneos = sorted({p["tournament_id"] for p in partidos})

    # Solo torneos que siguen en juego. Una quiniela de un torneo TERMINADO no
    # debe avisar nada: la liga tica corre temporada tras temporada sobre el
    # mismo tournament_id, así que los miembros de una quiniela vieja recibirían
    # avisos de partidos que no están jugando. Es el mismo corte que hace el hub
    # para separar las quinielas terminadas.
    activos = (
        supabase.table("tournaments").select("id")
        .in_("id", torneos).neq("status", "finished").execute().data or []
    )
    ids_activos = {t["id"] for t in activos}
    partidos = [p for p in partidos if p["tournament_id"] in ids_activos]
    if not partidos:
        return {"status": "ok", "partidos": 0, "mensaje": "Hoy no se juega nada en un torneo activo"}

    ligas = (
        supabase.table("leagues").select("id, tournament_id")
        .in_("tournament_id", sorted(ids_activos)).execute().data or []
    )
    if not ligas:
        return {"status": "ok", "partidos": len(partidos), "mensaje": "Ningún torneo con quiniela"}

    torneo_de_liga = {l["id"]: l["tournament_id"] for l in ligas}
    filas = (
        supabase.table("league_members").select("league_id, user_id")
        .in_("league_id", list(torneo_de_liga)).limit(20000).execute().data or []
    )
    membresias = [
        {**f, "tournament_id": torneo_de_liga[f["league_id"]]}
        for f in filas if f["league_id"] in torneo_de_liga
    ]

    predicciones = (
        supabase.table("predictions").select("user_id, league_id, match_id")
        .in_("match_id", [p["id"] for p in partidos]).limit(20000).execute().data or []
    )

    mensajes = armar_mensajes(partidos, membresias, predicciones)
    resultado = await enviar_push_personalizado(supabase, mensajes)

    return {
        "status": "ok",
        "partidos": len(partidos),
        "personas": len(mensajes),
        **resultado,
    }


@router.post("/notify-kickoff")
async def notify_kickoff(authorization: Optional[str] = Header(default=None)):
    """Recordatorio 45 minutos antes del saque, SOLO a quien le falta predecir.

    El resumen de las 6am ya dice cuántas te faltan, pero es una vez al día: si
    el partido es a las 8pm y lo viste temprano, nada te vuelve a tocar.

    OJO CON EL CRON: el ancho de la ventana tiene que coincidir con el
    intervalo del disparador (15 min). Si el cron se hace más lento o más
    rápido sin tocar ANCHO_VENTANA_MIN, la gente recibe el aviso dos veces o no
    lo recibe. Está probado en test_recordatorio_saque.py.
    """
    expected = settings.CRON_SECRET
    if not expected:
        raise HTTPException(status_code=503, detail="CRON_SECRET no configurado")
    if authorization != f"Bearer {expected}":
        raise HTTPException(status_code=401, detail="No autorizado")

    from datetime import datetime, timezone
    from app.services.notifications import enviar_push_personalizado
    from app.services.resumen_diario import armar_recordatorios, ventana_recordatorio

    supabase = get_supabase()
    desde, hasta = ventana_recordatorio(datetime.now(timezone.utc))

    partidos = (
        supabase.table("matches")
        .select("id, tournament_id, home_team, away_team, kickoff_at, status")
        .gte("kickoff_at", desde.isoformat())
        .lt("kickoff_at", hasta.isoformat())
        .execute()
        .data
        or []
    )
    partidos = [p for p in partidos if p.get("status") not in ("cancelled", "postponed")]
    if not partidos:
        return {"status": "ok", "partidos": 0}

    torneos = sorted({p["tournament_id"] for p in partidos})
    # Mismo corte que el resumen diario: una quiniela de un torneo terminado no
    # debe avisar nada (la liga tica reusa el mismo tournament_id temporada
    # tras temporada).
    activos = (
        supabase.table("tournaments").select("id")
        .in_("id", torneos).neq("status", "finished").execute().data or []
    )
    ids_activos = {t["id"] for t in activos}
    partidos = [p for p in partidos if p["tournament_id"] in ids_activos]
    if not partidos:
        return {"status": "ok", "partidos": 0}

    ligas = (
        supabase.table("leagues").select("id, tournament_id")
        .in_("tournament_id", sorted(ids_activos)).execute().data or []
    )
    if not ligas:
        return {"status": "ok", "partidos": len(partidos), "personas": 0}

    torneo_de_liga = {l["id"]: l["tournament_id"] for l in ligas}
    filas = (
        supabase.table("league_members").select("league_id, user_id")
        .in_("league_id", list(torneo_de_liga)).limit(20000).execute().data or []
    )
    membresias = [
        {**f, "tournament_id": torneo_de_liga[f["league_id"]]}
        for f in filas if f["league_id"] in torneo_de_liga
    ]

    predicciones = (
        supabase.table("predictions").select("user_id, league_id, match_id")
        .in_("match_id", [p["id"] for p in partidos]).limit(20000).execute().data or []
    )

    mensajes = armar_recordatorios(partidos, membresias, predicciones)
    resultado = await enviar_push_personalizado(supabase, mensajes)

    return {"status": "ok", "partidos": len(partidos), "personas": len(mensajes), **resultado}


@router.post("/notify-daily-league")
async def notify_daily_league(
    league_id: str = Body(..., embed=True),
    user: dict = Depends(get_current_user),
):
    """Avisa los partidos de hoy a los miembros de UNA quiniela, a pedido de su
    administrador.

    Es el mismo resumen que manda el cron a las 6am, pero disparado a mano y
    acotado a una sola quiniela. El cron usa CRON_SECRET porque no hay usuario;
    acá sí lo hay, así que se comprueba que sea administrador DE ESA quiniela.

    La comprobación se hace contra las tablas y no con es_admin_liga(): esa
    función mira auth.uid(), y el backend corre con service_role, donde
    auth.uid() es NULL — la RPC diría que no es admin siempre.
    """
    from datetime import datetime, timezone
    from app.services.notifications import enviar_push_personalizado
    from app.services.resumen_diario import armar_mensajes, ventana_del_dia

    supabase = get_supabase()
    uid = user["sub"]

    liga = (
        supabase.table("leagues").select("id, name, admin_id, tournament_id")
        .eq("id", league_id).limit(1).execute().data or []
    )
    if not liga:
        raise HTTPException(status_code=404, detail="Quiniela no encontrada")
    liga = liga[0]

    # Creador, co-admin, o admin global de la app.
    es_creador = liga.get("admin_id") == uid
    fila = (
        supabase.table("league_members").select("es_admin")
        .eq("league_id", league_id).eq("user_id", uid).limit(1).execute().data or []
    )
    es_coadmin = bool(fila) and bool(fila[0].get("es_admin"))
    perfil = (
        supabase.table("users").select("is_admin").eq("id", uid).limit(1).execute().data or []
    )
    es_admin_global = bool(perfil) and bool(perfil[0].get("is_admin"))

    if not (es_creador or es_coadmin or es_admin_global):
        # 404 y no 403: confirmar que la quiniela existe ya le sirve a quien
        # esté probando UUIDs.
        raise HTTPException(status_code=404, detail="Quiniela no encontrada")

    desde, hasta = ventana_del_dia(datetime.now(timezone.utc))
    partidos = (
        supabase.table("matches")
        .select("id, tournament_id, home_team, away_team, kickoff_at, status")
        .eq("tournament_id", liga["tournament_id"])
        .gte("kickoff_at", desde.isoformat())
        .lt("kickoff_at", hasta.isoformat())
        .execute().data or []
    )
    partidos = [p for p in partidos if p.get("status") not in ("cancelled", "postponed")]
    if not partidos:
        return {"status": "ok", "partidos": 0, "enviados": 0,
                "mensaje": "Hoy no hay partidos en esta quiniela"}

    filas = (
        supabase.table("league_members").select("league_id, user_id")
        .eq("league_id", league_id).limit(20000).execute().data or []
    )
    membresias = [{**f, "tournament_id": liga["tournament_id"]} for f in filas]

    predicciones = (
        supabase.table("predictions").select("user_id, league_id, match_id")
        .eq("league_id", league_id)
        .in_("match_id", [p["id"] for p in partidos]).limit(20000).execute().data or []
    )

    mensajes = armar_mensajes(partidos, membresias, predicciones)
    resultado = await enviar_push_personalizado(supabase, mensajes)

    return {
        "status": "ok",
        "quiniela": liga.get("name"),
        "partidos": len(partidos),
        "personas": len(mensajes),
        **resultado,
    }


@router.post("/refresh-live")
async def refresh_live(user: dict = Depends(get_current_user)):
    """Refresco de marcadores en vivo. Lo llama el frontend mientras alguien
    mira un partido en curso, para no depender del cron.

    ANTES ERA PÚBLICO y corría con service_role: cualquiera en internet podía
    disparar sincronizaciones, llamadas a ESPN, escrituras y recálculos sin
    límite. Ahora exige sesión y el throttle es una sola escritura atómica.

    El throttle es un UPDATE condicional: 'poné last_sync = ahora, pero SOLO si
    el último fue hace más de 20s'. Postgres serializa la fila, así que de dos
    peticiones simultáneas exactamente una se lleva el turno. El patrón viejo
    (leer, comparar, escribir) dejaba pasar a las dos.
    """
    from datetime import datetime, timezone, timedelta

    supabase = get_supabase()
    now = datetime.now(timezone.utc)
    corte = (now - timedelta(seconds=SEGUNDOS_ENTRE_REFRESCOS)).isoformat()

    try:
        turno = (
            supabase.table("live_sync_state")
            .update({"last_sync": now.isoformat()})
            .eq("id", 1)
            .lt("last_sync", corte)
            .execute()
        )
        if not turno.data:
            # O bien alguien sincronizó hace menos de 20s, o la fila todavía no
            # existe (primera vez). Solo en el segundo caso se sigue.
            existe = (
                supabase.table("live_sync_state").select("id").eq("id", 1).execute()
            )
            if existe.data:
                return {"throttled": True}
            supabase.table("live_sync_state").insert(
                {"id": 1, "last_sync": now.isoformat()}
            ).execute()
    except Exception:  # noqa: BLE001
        # Falla cerrada a propósito: si el limitador no funciona, no se corre
        # una operación privilegiada sin límite. Antes esto era 'except: pass',
        # o sea que la protección desaparecía justo cuando hacía falta.
        logger.exception("No se pudo aplicar el límite de refresco")
        raise HTTPException(
            status_code=503, detail="Servicio de sincronización no disponible"
        )

    # Mundial + torneos ESPN (Liga CR, etc.), desacoplados: si uno falla, el otro
    # igual corre. Antes esto solo sincronizaba el Mundial, por eso el marcador en
    # vivo de la Liga CR no avanzaba entre corridas del cron.
    result = {}
    try:
        result = await sync_live_scores(supabase)
    except Exception as exc:  # noqa: BLE001
        result["live_scores_error"] = f"{type(exc).__name__}: {exc}"
    try:
        from app.services.espn_tournament_sync import sync_all_espn_tournaments
        result["espn_tournaments"] = await sync_all_espn_tournaments(supabase)
    except Exception as exc:  # noqa: BLE001
        result["espn_tournaments_error"] = str(exc)
    return result


@router.get("/tournament-standings")
async def tournament_standings(tournament_id: int, user: dict = Depends(get_current_user)):
    """Tabla de posiciones (equipos) de un torneo: puntos, PJ, G/E/P, DG.

    Se calcula desde NUESTRA tabla `matches` (no proxy a ESPN) para que se vea
    en vivo: los partidos 'in_progress' ya tienen marcador actualizado por el
    sync (cada ~5 min) y entran en la tabla con ese marcador parcial, en vez
    de esperar a que ESPN publique la tabla oficial (que solo se actualiza
    cuando el partido termina)."""
    supabase = get_supabase()
    matches = (supabase.table("matches")
               .select("group_name, home_team, away_team, home_flag_url, away_flag_url, "
                       "home_goals_actual, away_goals_actual, status")
               .eq("tournament_id", tournament_id).eq("phase", "groups")
               .in_("status", ["finished", "in_progress"])
               .execute().data or [])

    groups = {}
    for m in matches:
        hg, ag = m.get("home_goals_actual"), m.get("away_goals_actual")
        if hg is None or ag is None:
            continue
        gname = m.get("group_name")
        table = groups.setdefault(gname, {})

        def _team(name, flag):
            if name not in table:
                table[name] = {"team": name, "logo": flag, "played": 0, "wins": 0,
                                "draws": 0, "losses": 0, "gf": 0, "ga": 0}
            elif flag and not table[name]["logo"]:
                table[name]["logo"] = flag
            return table[name]

        home = _team(m["home_team"], m.get("home_flag_url"))
        away = _team(m["away_team"], m.get("away_flag_url"))
        home["played"] += 1; away["played"] += 1
        home["gf"] += hg; home["ga"] += ag
        away["gf"] += ag; away["ga"] += hg
        if hg > ag:
            home["wins"] += 1; away["losses"] += 1
        elif hg < ag:
            away["wins"] += 1; home["losses"] += 1
        else:
            home["draws"] += 1; away["draws"] += 1

    out_groups = []
    # None (liga sin grupos) al final si conviviera con grupos reales, aunque
    # en la práctica un torneo tiene uno u otro, no ambos.
    for gname in sorted(groups.keys(), key=lambda k: (k is None, k or "")):
        rows = list(groups[gname].values())
        for r in rows:
            r["points"] = r["wins"] * 3 + r["draws"]
            r["gd"] = r["gf"] - r["ga"]
        rows.sort(key=lambda r: (-r["points"], -r["gd"], -r["gf"], r["team"]))
        for i, r in enumerate(rows, start=1):
            r["rank"] = i
        out_groups.append({"name": gname, "rows": rows})

    return {"tournament_id": tournament_id, "groups": out_groups}


@router.get("/player-stats")
async def player_stats(tournament_id: int, user: dict = Depends(get_current_user)):
    """Top goleadores y asistencias del torneo, en vivo.

    ESPN (nuestra fuente de partidos) no expone asistencias para ligas como
    Costa Rica. Cuando el torneo tiene unafut_league_slug/unafut_competition_id
    configurados, se usa en su lugar la API pública de UNAFUT (GeniusSports/
    pixeles.club, sin auth) que sí trae ambas estadísticas reales."""
    supabase = get_supabase()
    t = (supabase.table("tournaments")
         .select("unafut_league_slug, unafut_competition_id")
         .eq("id", tournament_id).single().execute().data) or {}
    slug, comp_id = t.get("unafut_league_slug"), t.get("unafut_competition_id")
    if not slug or not comp_id:
        return {"tournament_id": tournament_id, "scorers": [], "assists": [], "source": None}

    def _rows(entries):
        # No confiar en que UNAFUT ya venga ordenado: se ordena acá por las
        # dudas antes de recortar el top 5.
        ranked = sorted(entries or [], key=lambda e: e.get("value") or 0, reverse=True)
        return [{
            "player": e.get("personName"),
            "team": e.get("teamName"),
            "team_logo": e.get("teamLogo"),
            "photo": e.get("image"),
            "value": e.get("value"),
        } for e in ranked[:5]]

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.get(
                f"https://gapi.pixeles.club/ligas/{slug}/api/stats",
                params={"competitionId": comp_id})
            r.raise_for_status()
            data = r.json() or {}
    except Exception:  # noqa: BLE001
        return {"tournament_id": tournament_id, "scorers": [], "assists": [], "source": "unafut"}

    players = data.get("players") or {}
    return {
        "tournament_id": tournament_id,
        "scorers": _rows(players.get("goals")),
        "assists": _rows(players.get("assists")),
        "source": "unafut",
    }


@router.get("/verify-scores")
async def verify_scores(tournament_id: int, user: dict = Depends(get_current_user)):
    """Compara nuestros marcadores contra los de UNAFUT y reporta las diferencias.

    ESPN ya se contradijo consigo misma en este torneo (su scoreboard decía
    SUSPENDED mientras su summary daba el partido por terminado). Con una sola
    fuente, un dato malo se descubre cuando alguien reclama.

    NO corrige nada: solo reporta, para que el admin decida. Corregir
    automáticamente haría que dos fuentes en desacuerdo se pisen entre ellas en
    cada pasada."""
    from app.services.score_check import comparar_con_unafut

    try:
        return await comparar_con_unafut(get_supabase(), tournament_id)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Error comparando fuentes: {exc}")


@router.get("/external-games")
async def get_external_games():
    """Proxy para obtener los juegos de la API externa (worldcup26.ir)."""
    url = "https://worldcup26.ir/get/games"
    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(url, timeout=15.0)
            response.raise_for_status()
            return response.json()
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Error obteniendo API: {e}")


@router.get("")
async def list_matches(
    phase: Optional[str] = Query(None, description="Filtrar por fase"),
    user: dict = Depends(get_current_user),
):
    """Lista todos los partidos, opcionalmente filtrados por fase."""
    supabase = get_supabase()
    query = supabase.table("matches").select("*").order("kickoff_at")

    if phase:
        query = query.eq("phase", phase)

    response = query.execute()
    return response.data


@router.get("/upcoming")
async def upcoming_matches(user: dict = Depends(get_current_user)):
    """Devuelve los próximos 5 partidos pendientes."""
    from datetime import datetime, timezone

    supabase = get_supabase()
    now = datetime.now(timezone.utc).isoformat()

    response = (
        supabase.table("matches")
        .select("*")
        .eq("status", "pending")
        .gte("kickoff_at", now)
        .order("kickoff_at")
        .limit(5)
        .execute()
    )
    return response.data


@router.get("/{match_id}")
async def get_match(match_id: int, user: dict = Depends(get_current_user)):
    """Obtiene los detalles de un partido específico."""
    supabase = get_supabase()
    response = (
        supabase.table("matches")
        .select("*")
        .eq("id", match_id)
        .single()
        .execute()
    )
    return response.data
