"""Rutas para gestionar los partidos del mundial."""

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Query
from typing import Optional

from app.auth import get_current_user
from app.config import settings
from app.services.live_sync import sync_live_scores
from app.services.scoring import calculate_and_update_scores
from app.services.supabase_client import get_supabase

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


@router.post("/refresh-live")
async def refresh_live():
    """Refresco de marcadores en vivo, público pero con límite de frecuencia.

    Lo llama el frontend mientras un usuario mira un partido en curso, para
    actualizar el marcador sin depender del cron. Se sincroniza como mucho una
    vez cada 20s (throttle global en BD) para evitar abuso/carga.
    """
    from datetime import datetime, timezone, timedelta

    supabase = get_supabase()
    now = datetime.now(timezone.utc)

    # Throttle global vía BD (best-effort: si la tabla no existe, se ignora)
    try:
        state = (
            supabase.table("live_sync_state").select("last_sync").eq("id", 1).maybe_single().execute()
        )
        last = (state.data or {}).get("last_sync") if state else None
        if last:
            last_dt = datetime.fromisoformat(str(last).replace("Z", "+00:00"))
            if (now - last_dt) < timedelta(seconds=20):
                return {"throttled": True}
        supabase.table("live_sync_state").upsert({"id": 1, "last_sync": now.isoformat()}).execute()
    except Exception:  # noqa: BLE001
        pass

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
