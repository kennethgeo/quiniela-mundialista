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
    try:
        return await sync_live_scores(supabase)
    except Exception as exc:  # noqa: BLE001 - exponer el error al cron para diagnóstico
        raise HTTPException(status_code=500, detail=f"{type(exc).__name__}: {exc}")


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

    try:
        return await sync_live_scores(supabase)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"{type(exc).__name__}: {exc}")


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
