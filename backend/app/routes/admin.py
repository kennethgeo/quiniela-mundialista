"""Rutas administrativas para gestionar resultados y puntuación."""

import io
import secrets
import time

from fastapi import APIRouter, Body, Depends, HTTPException

from app.auth import require_admin
from app.models import MatchResultUpdate, MatchStatusUpdate
from app.services.supabase_client import get_supabase
from app.services.scoring import calculate_and_update_scores

router = APIRouter(prefix="/api/admin", tags=["Administración"])


# --- Match tolerante de nombres (igual que scoring.js) -----------------------
import re as _re
import unicodedata as _ud


def _norm_name(s: str) -> str:
    s = _ud.normalize("NFD", s or "")
    s = "".join(c for c in s if _ud.category(c) != "Mn")
    return _re.sub(r"\s+", " ", s.lower().strip())


def _champion_matches(actual: str, pick: str) -> bool:
    a, p = _norm_name(actual), _norm_name(pick)
    return bool(a) and bool(p) and a == p


def _scorer_matches(actual: str, pick: str) -> bool:
    a, p = _norm_name(actual), _norm_name(pick)
    if not a or not p:
        return False
    if a == p or (len(a) >= 3 and a in p) or (len(p) >= 3 and p in a):
        return True
    la, lp = a.split()[-1], p.split()[-1]
    if len(la) >= 3 and _re.search(r"\b" + _re.escape(la) + r"\b", p):
        return True
    if len(lp) >= 3 and _re.search(r"\b" + _re.escape(lp) + r"\b", a):
        return True
    return False


@router.post("/update-match")
async def update_match_result(
    result: MatchResultUpdate,
    admin: dict = Depends(require_admin),
):
    """Actualiza el resultado real de un partido y calcula los puntos."""
    supabase = get_supabase()

    # Actualizar resultado y estado del partido
    response = (supabase.table("matches")
        .update({
            "home_goals_actual": result.home_goals_actual,
            "away_goals_actual": result.away_goals_actual,
            "goes_to_penalties": result.goes_to_penalties,
            "penalties_winner_real": result.penalties_winner_real,
            "status": "finished"
        })
        .eq("id", result.match_id)
        .execute()
    )

    if not response.data:
        raise HTTPException(status_code=404, detail="Partido no encontrado")

    # Ejecutar el motor de puntuación para calcular y asignar puntos
    await calculate_and_update_scores(supabase, result.match_id)

    return {
        "message": "Resultado actualizado y puntos calculados",
        "match": response.data[0],
    }


@router.post("/set-match-status")
async def set_match_status(
    payload: MatchStatusUpdate,
    admin: dict = Depends(require_admin),
):
    """Cambia el estado de un partido (in_progress, finished)."""
    if payload.status not in ("in_progress", "finished"):
        raise HTTPException(status_code=400, detail="Estado inválido")

    supabase = get_supabase()
    response = (
        supabase.table("matches")
        .update({"status": payload.status})
        .eq("id", payload.match_id)
        .execute()
    )

    if not response.data:
        raise HTTPException(status_code=404, detail="Partido no encontrado")

    return {
        "message": f"Estado del partido actualizado a '{payload.status}'"
    }


def _norm_email(email: str) -> str:
    return (email or "").strip().lower()


@router.post("/delete-user")
async def delete_user(
    user_id: str = Body(..., embed=True),
    ban: bool = Body(False, embed=True),
    admin: dict = Depends(require_admin),
):
    """Elimina por completo a un usuario y todos sus datos.

    Borra al usuario de Supabase Auth, lo que elimina en cascada su fila en
    public.users y todo lo dependiente (predicciones, predicciones de torneo,
    membresías de liga, suscripciones push, chat, etc.).

    Si ban=True, además agrega su correo a la lista negra (banned_emails) para
    que NO pueda volver a registrarse.

    Guardas:
    - Un admin no puede borrarse a sí mismo.
    - Solo accesible para usuarios con is_admin = true.
    """
    if not user_id:
        raise HTTPException(status_code=400, detail="user_id requerido")
    if user_id == admin.get("sub"):
        raise HTTPException(status_code=400, detail="No puedes borrarte a ti mismo")

    supabase = get_supabase()

    # Nombre y correo (best-effort, ANTES de borrar) para mensaje y ban.
    display_name = None
    email = None
    try:
        info = supabase.table("users").select("display_name, email").eq("id", user_id).single().execute()
        display_name = (info.data or {}).get("display_name")
        email = (info.data or {}).get("email")
    except Exception:  # noqa: BLE001
        pass

    banned_email = None
    if ban and email:
        try:
            supabase.table("banned_emails").upsert({
                "email": _norm_email(email),
                "reason": "Baneado al eliminar la cuenta",
                "banned_by": admin.get("sub"),
            }).execute()
            banned_email = _norm_email(email)
        except Exception:  # noqa: BLE001 - no bloquear el borrado si falla el ban
            pass

    # Limpieza explícita de tablas que apuntan a auth.users (NO se borran al
    # eliminar solo la fila de public.users): evita predicciones globales
    # "huérfanas" que quedaban en la portada como "Jugador".
    for tbl in ("tournament_predictions", "push_subscriptions"):
        try:
            supabase.table(tbl).delete().eq("user_id", user_id).execute()
        except Exception:  # noqa: BLE001
            pass

    # Borrar de Auth → cascada a public.users y dependientes
    deleted_via = "auth"
    try:
        supabase.auth.admin.delete_user(user_id)
    except Exception:  # noqa: BLE001 - p.ej. el usuario ya no existe en Auth
        # Respaldo: borrar la fila de public.users (también cascada)
        res = supabase.table("users").delete().eq("id", user_id).execute()
        if not res.data:
            raise HTTPException(status_code=404, detail="Usuario no encontrado")
        deleted_via = "users_table"

    return {
        "status": "ok",
        "deleted": user_id,
        "display_name": display_name,
        "banned_email": banned_email,
        "via": deleted_via,
    }


@router.post("/ban-email")
async def ban_email(
    email: str = Body(..., embed=True),
    reason: str = Body("", embed=True),
    admin: dict = Depends(require_admin),
):
    """Agrega un correo a la lista negra (no podrá registrarse)."""
    norm = _norm_email(email)
    if not norm or "@" not in norm:
        raise HTTPException(status_code=400, detail="Correo inválido")
    supabase = get_supabase()
    supabase.table("banned_emails").upsert({
        "email": norm,
        "reason": (reason or "").strip() or None,
        "banned_by": admin.get("sub"),
    }).execute()
    return {"status": "ok", "email": norm}


@router.post("/unban-email")
async def unban_email(
    email: str = Body(..., embed=True),
    admin: dict = Depends(require_admin),
):
    """Quita un correo de la lista negra (podrá registrarse de nuevo)."""
    norm = _norm_email(email)
    supabase = get_supabase()
    supabase.table("banned_emails").delete().eq("email", norm).execute()
    return {"status": "ok", "email": norm}


@router.post("/update-user")
async def update_user(
    payload: dict = Body(...),
    admin: dict = Depends(require_admin),
):
    """Edita el perfil de un usuario: nombre visible y/o rol de admin.

    Usa la service key (salta RLS), por eso vive en el backend. Un admin no puede
    quitarse a sí mismo el rol de admin (para no quedar sin administradores por
    error)."""
    user_id = (payload.get("user_id") or "").strip()
    if not user_id:
        raise HTTPException(status_code=400, detail="user_id requerido")

    updates: dict = {}
    if "display_name" in payload:
        name = (payload.get("display_name") or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="El nombre no puede estar vacío")
        if len(name) > 40:
            raise HTTPException(status_code=400, detail="El nombre es demasiado largo (máx. 40)")
        updates["display_name"] = name
    if "is_admin" in payload:
        is_admin = bool(payload.get("is_admin"))
        if not is_admin and user_id == admin.get("sub"):
            raise HTTPException(status_code=400, detail="No puedes quitarte a ti mismo el rol de admin")
        updates["is_admin"] = is_admin

    if not updates:
        raise HTTPException(status_code=400, detail="Nada que actualizar")

    supabase = get_supabase()
    res = supabase.table("users").update(updates).eq("id", user_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    return {"status": "ok", "user": res.data[0]}


@router.post("/adjust-points")
async def adjust_points(
    user_id: str = Body(..., embed=True),
    points_adjustment: int = Body(..., embed=True),
    admin: dict = Depends(require_admin),
):
    """Ajuste manual de puntos (bonus o penalización) para un usuario.

    Guarda el ajuste en users.points_adjustment; el total autoritativo lo
    recalcula la BD (recompute_user_total lo suma). Reemplaza el ajuste anterior
    (no es acumulativo) para que sea fácil de revisar/revertir."""
    if not user_id:
        raise HTTPException(status_code=400, detail="user_id requerido")
    try:
        adj = int(points_adjustment)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="points_adjustment debe ser un entero")

    supabase = get_supabase()
    res = supabase.table("users").update({"points_adjustment": adj}).eq("id", user_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    # Forzar recálculo del total autoritativo (la función incluye el ajuste).
    try:
        supabase.rpc("recompute_user_total", {"p_user_id": user_id}).execute()
    except Exception:  # noqa: BLE001 - si falta la función, el trigger lo hará al próximo cambio
        pass
    return {"status": "ok", "user_id": user_id, "points_adjustment": adj}


@router.post("/set-temp-password")
async def set_temp_password(
    user_id: str = Body(..., embed=True),
    admin: dict = Depends(require_admin),
):
    """Genera una contraseña temporal para un usuario (sin necesidad de SMTP).

    El admin se la comparte a la persona para que entre y la cambie. Usa la
    service key (auth.admin)."""
    if not user_id:
        raise HTTPException(status_code=400, detail="user_id requerido")
    temp = secrets.token_urlsafe(9)
    supabase = get_supabase()
    try:
        supabase.auth.admin.update_user_by_id(user_id, {"password": temp})
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"No se pudo actualizar la contraseña: {exc}")
    return {"status": "ok", "user_id": user_id, "temp_password": temp}


@router.post("/update-match-events")
async def update_match_events(
    match_id: int = Body(..., embed=True),
    events: list = Body(..., embed=True),
    admin: dict = Depends(require_admin),
):
    """Reemplaza los eventos (goles) de un partido en events_json.

    Sirve para cargar/corregir goleadores a mano cuando ESPN falla o falta un
    dato. Cada evento: {player, side ('home'|'away'), penalty, own_goal, minute}.
    De esto depende 'goles del goleador' de la vista. Usa la service key."""
    if not isinstance(events, list):
        raise HTTPException(status_code=400, detail="events debe ser una lista")

    clean = []
    for ev in events:
        if not isinstance(ev, dict):
            continue
        player = (ev.get("player") or "").strip()
        if not player:
            continue
        clean.append({
            "type": "goal",
            "player": player,
            "side": "away" if ev.get("side") == "away" else "home",
            "penalty": bool(ev.get("penalty")),
            "own_goal": bool(ev.get("own_goal")),
            "minute": (ev.get("minute") or "").strip() or None,
        })

    supabase = get_supabase()
    res = supabase.table("matches").update({"events_json": clean}).eq("id", match_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Partido no encontrado")
    return {"status": "ok", "match_id": match_id, "events": clean}


@router.post("/create-tournament")
async def create_tournament(
    payload: dict = Body(...),
    admin: dict = Depends(require_admin),
):
    """Crea un torneo nuevo (Copa/Liga). Sirve para estrenar el multi-torneo."""
    name = (payload.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="El nombre es obligatorio")
    kind = payload.get("kind") if payload.get("kind") in ("cup", "league") else "cup"
    source = payload.get("source") if payload.get("source") in ("espn", "manual") else "manual"
    status = payload.get("status") if payload.get("status") in ("upcoming", "active", "finished") else "upcoming"

    import re
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")

    supabase = get_supabase()
    row = {
        "name": name,
        "slug": slug or None,
        "kind": kind,
        "source": source,
        "status": status,
        "external_ref": (payload.get("external_ref") or "").strip() or None,
        "season": (payload.get("season") or "").strip() or None,
    }
    try:
        res = supabase.table("tournaments").insert(row).execute()
    except Exception as exc:  # noqa: BLE001 - p.ej. slug duplicado
        raise HTTPException(status_code=400, detail=f"No se pudo crear: {exc}")
    return {"status": "ok", "tournament": (res.data or [None])[0]}


@router.post("/update-tournament")
async def update_tournament(
    payload: dict = Body(...),
    admin: dict = Depends(require_admin),
):
    """Edita un torneo (nombre, estado, fuente...)."""
    tid = payload.get("id")
    if not tid:
        raise HTTPException(status_code=400, detail="id requerido")
    updates = {}
    for f in ("name", "external_ref", "season"):
        if f in payload:
            updates[f] = (payload.get(f) or "").strip() or None
    if payload.get("kind") in ("cup", "league"):
        updates["kind"] = payload["kind"]
    if payload.get("source") in ("espn", "manual"):
        updates["source"] = payload["source"]
    if payload.get("status") in ("upcoming", "active", "finished"):
        updates["status"] = payload["status"]
    if not updates:
        raise HTTPException(status_code=400, detail="Nada que actualizar")

    supabase = get_supabase()
    res = supabase.table("tournaments").update(updates).eq("id", tid).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Torneo no encontrado")
    return {"status": "ok", "tournament": res.data[0]}


@router.post("/set-tournament-globals")
async def set_tournament_globals(
    payload: dict = Body(...),
    admin: dict = Depends(require_admin),
):
    """Fija el campeón/goleador reales y el bloqueo de un torneo."""
    tid = payload.get("tournament_id")
    if not tid:
        raise HTTPException(status_code=400, detail="tournament_id requerido")
    updates = {}
    if "actual_champion" in payload:
        updates["actual_champion"] = (payload.get("actual_champion") or "").strip() or None
    if "actual_top_scorer" in payload:
        updates["actual_top_scorer"] = (payload.get("actual_top_scorer") or "").strip() or None
    if "predictions_locked" in payload:
        updates["predictions_locked"] = bool(payload.get("predictions_locked"))
    if not updates:
        raise HTTPException(status_code=400, detail="Nada que actualizar")
    supabase = get_supabase()
    res = supabase.table("tournaments").update(updates).eq("id", tid).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Torneo no encontrado")
    return {"status": "ok", "tournament": res.data[0]}


@router.post("/calc-tournament-globals")
async def calc_tournament_globals(
    tournament_id: int = Body(..., embed=True),
    admin: dict = Depends(require_admin),
):
    """Reparte los 12 pts de campeón/goleador de UN torneo, usando su campeón/
    goleador reales y match tolerante (acentos/apellido; goleador admite varios
    separados por coma). Idempotente."""
    supabase = get_supabase()
    t = (supabase.table("tournaments").select("actual_champion, actual_top_scorer")
         .eq("id", tournament_id).single().execute().data) or {}
    champ = t.get("actual_champion")
    scorers = [s.strip() for s in _re.split(r"[,;/]", t.get("actual_top_scorer") or "") if s.strip()]
    if not champ and not scorers:
        return {"status": "ok", "message": "Sin campeón/goleador definidos", "updated": 0}

    preds = (supabase.table("tournament_predictions")
             .select("id, user_id, league_id, champion_team, top_scorer_name, champion_points, top_scorer_points")
             .eq("tournament_id", tournament_id).execute().data or [])

    # Puntos de campeón/goleador configurables por quiniela.
    league_ids = list({p.get("league_id") for p in preds if p.get("league_id")})
    lcfg = {}
    if league_ids:
        for r in (supabase.table("leagues").select("id, champion_points, scorer_points")
                  .in_("id", league_ids).execute().data or []):
            lcfg[r["id"]] = r

    updated = 0
    users = set()
    for p in preds:
        cfg = lcfg.get(p.get("league_id")) or {}
        champ_pts = cfg.get("champion_points", 12) if cfg.get("champion_points") is not None else 12
        scorer_pts = cfg.get("scorer_points", 12) if cfg.get("scorer_points") is not None else 12
        cp = champ_pts if (champ and p.get("champion_team") and _champion_matches(champ, p["champion_team"])) else 0
        sp = scorer_pts if (p.get("top_scorer_name") and any(_scorer_matches(n, p["top_scorer_name"]) for n in scorers)) else 0
        if cp != (p.get("champion_points") or 0) or sp != (p.get("top_scorer_points") or 0):
            supabase.table("tournament_predictions").update(
                {"champion_points": cp, "top_scorer_points": sp}).eq("id", p["id"]).execute()
            updated += 1
            users.add(p["user_id"])
    for uid in users:
        try:
            supabase.rpc("recompute_user_total", {"p_user_id": uid}).execute()
        except Exception:  # noqa: BLE001
            pass
    return {"status": "ok", "updated": updated, "users": len(users)}


@router.post("/create-match")
async def create_match(
    payload: dict = Body(...),
    admin: dict = Depends(require_admin),
):
    """Agrega un partido a un torneo (carga manual de fixtures).

    Para ligas se usa phase='groups' + matchday = jornada. Los códigos de equipo
    son ISO de flagcdn (ej. 'es','de') o dejar 'xx'."""
    tid = payload.get("tournament_id")
    home = (payload.get("home_team") or "").strip()
    away = (payload.get("away_team") or "").strip()
    kickoff = (payload.get("kickoff_at") or "").strip()
    if not tid or not home or not away or not kickoff:
        raise HTTPException(status_code=400, detail="Faltan datos (torneo, equipos, fecha)")

    supabase = get_supabase()
    if not (supabase.table("tournaments").select("id").eq("id", tid).execute().data):
        raise HTTPException(status_code=404, detail="Torneo no encontrado")

    row = {
        "tournament_id": tid,
        "home_team": home,
        "away_team": away,
        "home_team_code": (payload.get("home_team_code") or "xx").strip().lower() or "xx",
        "away_team_code": (payload.get("away_team_code") or "xx").strip().lower() or "xx",
        "kickoff_at": kickoff,
        "phase": payload.get("phase") or "groups",
        "matchday": payload.get("matchday"),
        "group_name": (payload.get("group_name") or "").strip() or None,
        "status": "pending",
    }
    try:
        res = supabase.table("matches").insert(row).execute()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"No se pudo crear: {exc}")
    return {"status": "ok", "match": (res.data or [None])[0]}


@router.post("/delete-match")
async def delete_match(
    match_id: int = Body(..., embed=True),
    admin: dict = Depends(require_admin),
):
    """Borra un partido (y sus predicciones en cascada). Solo para torneos que
    cargaste a mano; usar con cuidado."""
    supabase = get_supabase()
    res = supabase.table("matches").delete().eq("id", match_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Partido no encontrado")
    return {"status": "ok", "deleted": match_id}


@router.post("/sync-espn")
async def sync_espn(
    tournament_id: int = Body(..., embed=True),
    admin: dict = Depends(require_admin),
):
    """Sincroniza los partidos (fixtures + resultados) de un torneo ESPN.
    Requiere source='espn' y external_ref (código de liga)."""
    from app.services.espn_tournament_sync import sync_espn_tournament

    supabase = get_supabase()
    t = supabase.table("tournaments").select("id, external_ref, source").eq("id", tournament_id).single().execute().data
    if not t:
        raise HTTPException(status_code=404, detail="Torneo no encontrado")
    if t.get("source") != "espn":
        raise HTTPException(status_code=400, detail="El torneo no es de fuente ESPN")
    if tournament_id == 1:
        raise HTTPException(status_code=400, detail="El Mundial usa su propio sync (sync-live)")
    try:
        # Botón admin: importa la temporada completa (el cron mantiene la ventana).
        res = await sync_espn_tournament(supabase, t, full=True)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Error de sync: {exc}")
    if res.get("error"):
        raise HTTPException(status_code=400, detail=res["error"])
    return {"status": "ok", **res}


@router.post("/sync-rosters")
async def sync_rosters(
    tournament_id: int = Body(..., embed=True),
    admin: dict = Depends(require_admin),
):
    """Trae de ESPN los jugadores de todos los equipos de un torneo y los guarda
    en `players`. Se usa para que el pick de goleador sea una selección real.

    Requiere que el torneo tenga external_ref = código de liga ESPN
    (p. ej. 'esp.1' LaLiga, 'uefa.champions', 'fifa.world', 'crc.1' Liga tica)."""
    import httpx

    supabase = get_supabase()
    t = supabase.table("tournaments").select("external_ref").eq("id", tournament_id).single().execute().data
    league = ((t or {}).get("external_ref") or "").strip()
    if not league:
        raise HTTPException(status_code=400, detail="El torneo no tiene código de liga (external_ref)")

    base = f"https://site.api.espn.com/apis/site/v2/sports/soccer/{league}"
    # Español: equipos y posiciones localizados. Los nombres de jugadores son
    # nombres propios (no cambian), así que el match del goleador sigue calzando.
    es = {"lang": "es", "region": "es"}
    rows = []
    n_teams = 0
    async with httpx.AsyncClient(timeout=25.0) as client:
        tr = await client.get(f"{base}/teams", params=es)
        tr.raise_for_status()
        try:
            teams = tr.json()["sports"][0]["leagues"][0]["teams"]
        except (KeyError, IndexError):
            raise HTTPException(status_code=400, detail=f"ESPN no devolvió equipos para '{league}'")

        for tw in teams:
            tm = tw.get("team") or {}
            tid = tm.get("id")
            tname = tm.get("displayName") or tm.get("name") or "?"
            if not tid:
                continue
            n_teams += 1
            try:
                rr = await client.get(f"{base}/teams/{tid}/roster", params=es)
                athletes = rr.json().get("athletes") or []
            except Exception:  # noqa: BLE001
                continue
            # ESPN devuelve lista plana o agrupada por posición ({items:[...]}).
            flat = []
            for a in athletes:
                if isinstance(a, dict) and isinstance(a.get("items"), list):
                    flat.extend(a["items"])
                else:
                    flat.append(a)
            for p in flat:
                if not isinstance(p, dict):
                    continue
                name = p.get("fullName") or p.get("displayName")
                if not name:
                    continue
                pos = (p.get("position") or {})
                rows.append({
                    "tournament_id": tournament_id,
                    "team": tname,
                    "name": name,
                    "position": pos.get("abbreviation") or pos.get("name"),
                    "external_id": str(p.get("id")) if p.get("id") else None,
                    "headshot_url": (p.get("headshot") or {}).get("href"),
                })

    # Upsert por (tournament_id, external_id). Los que no tengan id se insertan.
    saved = 0
    with_id = [r for r in rows if r["external_id"]]
    without_id = [r for r in rows if not r["external_id"]]
    if with_id:
        supabase.table("players").upsert(with_id, on_conflict="tournament_id,external_id").execute()
        saved += len(with_id)
    if without_id:
        supabase.table("players").insert(without_id).execute()
        saved += len(without_id)

    return {"status": "ok", "teams": n_teams, "players": saved}


@router.post("/broadcast")
async def broadcast(
    title: str = Body(..., embed=True),
    body: str = Body(..., embed=True),
    url: str = Body("/", embed=True),
    admin: dict = Depends(require_admin),
):
    """Envía una notificación push a TODOS los usuarios con suscripción activa."""
    from app.services.notifications import broadcast_push_to_users

    title = (title or "").strip()
    body = (body or "").strip()
    if not title or not body:
        raise HTTPException(status_code=400, detail="Título y mensaje son obligatorios")

    supabase = get_supabase()
    users = supabase.table("users").select("id").execute().data or []
    user_ids = [u["id"] for u in users]
    try:
        result = await broadcast_push_to_users(supabase, user_ids, title, body, url or "/")
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Error enviando push: {exc}")
    return {"status": "ok", "result": result}


@router.post("/recalc-scores")
async def admin_recalc_scores(admin: dict = Depends(require_admin)):
    """Recalcula los puntos de los partidos de ELIMINATORIA finalizados con las
    reglas actuales (backend = service role, así sí actualiza las predicciones de
    todos). No toca la fase de grupos.

    Útil tras cambiar una regla de puntaje de eliminatoria (penales): los
    points_earned viejos no se recalculan solos, y el auto-sync solo re-puntúa
    cuando cambian los datos. Es idempotente (aplica solo la diferencia)."""
    supabase = get_supabase()
    finished = (
        supabase.table("matches")
        .select("id")
        .eq("status", "finished")
        .neq("phase", "groups")
        .execute()
        .data
        or []
    )
    recalculated = 0
    errors = []
    for m in finished:
        try:
            await calculate_and_update_scores(supabase, m["id"])
            recalculated += 1
        except Exception as exc:  # noqa: BLE001
            errors.append(f"match {m['id']}: {exc}")

    return {
        "status": "ok",
        "finished": len(finished),
        "recalculated": recalculated,
        "errors": errors,
    }


@router.post("/optimize-avatars")
async def optimize_avatars(admin: dict = Depends(require_admin)):
    """Optimiza (redimensiona + comprime) los avatares YA subidos.

    Las fotos viejas se subían sin procesar (varios MB) y se descargaban una y
    otra vez en el ranking/podio, disparando el Cached Egress de Supabase. Esto
    recorre los avatares actuales de cada usuario, los reduce a ~256px webp con
    cache de 1 año, actualiza la URL y borra el archivo grande anterior.

    Idempotente: salta los que ya están livianos (< 60KB y .webp).
    Requiere la service key (salta RLS), por eso vive en el backend.
    """
    from PIL import Image  # import perezoso para no romper si falta Pillow

    supabase = get_supabase()
    users = supabase.table("users").select("id, avatar_url").execute().data or []

    optimized, errors = [], []
    skipped = 0
    bytes_before = bytes_after = 0

    for u in users:
        url = u.get("avatar_url") or ""
        if "/avatars/" not in url:
            continue
        old_path = url.split("/avatars/")[1].split("?")[0]

        try:
            data = supabase.storage.from_("avatars").download(old_path)
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{old_path}: download {exc}")
            continue

        # Ya optimizado: saltar.
        if len(data) < 60_000 and old_path.lower().endswith(".webp"):
            skipped += 1
            continue

        try:
            img = Image.open(io.BytesIO(data)).convert("RGB")
            img.thumbnail((256, 256))
            out = io.BytesIO()
            img.save(out, format="WEBP", quality=82, method=6)
            new_bytes = out.getvalue()
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{old_path}: resize {exc}")
            continue

        new_path = f"{u['id']}-{int(time.time() * 1000)}.webp"
        try:
            supabase.storage.from_("avatars").upload(
                new_path,
                new_bytes,
                {"content-type": "image/webp", "cache-control": "31536000", "upsert": "true"},
            )
            public = supabase.storage.from_("avatars").get_public_url(new_path)
            new_url = public if isinstance(public, str) else (public or {}).get("publicUrl", public)
            supabase.table("users").update({"avatar_url": new_url}).eq("id", u["id"]).execute()
            if old_path != new_path:
                try:
                    supabase.storage.from_("avatars").remove([old_path])
                except Exception:  # noqa: BLE001
                    pass
            bytes_before += len(data)
            bytes_after += len(new_bytes)
            optimized.append({"user": u["id"], "before": len(data), "after": len(new_bytes)})
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{old_path}: upload {exc}")

    return {
        "status": "ok",
        "optimized": len(optimized),
        "skipped": skipped,
        "errors": errors,
        "kb_before": round(bytes_before / 1024),
        "kb_after": round(bytes_after / 1024),
    }
