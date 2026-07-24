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
    """Tabla real de posiciones (equipos) de un torneo ESPN: puntos, PJ, G/E/P, DG.
    Proxy a ESPN (prueba la temporada del torneo y las 2 recientes)."""
    from datetime import datetime, timezone

    supabase = get_supabase()
    t = (supabase.table("tournaments").select("external_ref, season")
         .eq("id", tournament_id).single().execute().data) or {}
    league = (t.get("external_ref") or "").strip()
    if not league:
        raise HTTPException(status_code=400, detail="El torneo no es de fuente ESPN")

    def _i(v):
        try:
            return int(float(v))
        except (TypeError, ValueError):
            return 0

    years, seen = [], set()
    for y in ([t.get("season")] if (t.get("season") or "").isdigit() else []) + \
             [str(datetime.now(timezone.utc).year), str(datetime.now(timezone.utc).year - 1)]:
        if y and y not in seen:
            seen.add(y); years.append(y)

    async with httpx.AsyncClient(timeout=20.0) as client:
        for yr in years:
            try:
                r = await client.get(
                    f"https://site.web.api.espn.com/apis/v2/sports/soccer/{league}/standings",
                    params={"lang": "es", "region": "es", "season": yr})
                data = r.json()
            except Exception:  # noqa: BLE001
                continue
            children = data.get("children") or ([{"standings": data["standings"]}] if data.get("standings") else [])
            groups = []
            for ch in children:
                entries = ((ch.get("standings") or {}).get("entries")) or []
                rows = []
                for e in entries:
                    stats = {s.get("name"): s.get("value") for s in e.get("stats", [])}
                    tm = e.get("team") or {}
                    logo = (tm.get("logos") or [{}])[0].get("href") if tm.get("logos") else tm.get("logo")
                    rows.append({
                        "team": tm.get("displayName") or tm.get("name"),
                        "logo": logo,
                        "rank": _i(stats.get("rank")),
                        "points": _i(stats.get("points")),
                        "played": _i(stats.get("gamesPlayed")),
                        "wins": _i(stats.get("wins")),
                        "draws": _i(stats.get("ties")),
                        "losses": _i(stats.get("losses")),
                        "gd": _i(stats.get("pointDifferential")),
                    })
                if rows:
                    rows.sort(key=lambda x: x["rank"] or 999)
                    groups.append({"name": ch.get("name") or ch.get("displayName"), "rows": rows})
            if groups:
                return {"tournament_id": tournament_id, "season": yr, "groups": groups}
    return {"tournament_id": tournament_id, "groups": []}


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
