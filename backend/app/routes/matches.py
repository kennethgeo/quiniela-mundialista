"""Rutas para gestionar los partidos del mundial."""

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from typing import Optional

from app.auth import get_current_user
from app.config import settings
from app.services.live_sync import sync_live_scores
from app.services.supabase_client import get_supabase

router = APIRouter(prefix="/api/matches", tags=["Partidos"])


@router.post("/sync-live")
async def sync_live(authorization: Optional[str] = Header(default=None)):
    """Sincroniza marcadores en vivo desde ESPN. Protegido con CRON_SECRET.

    Pensado para ser invocado por un scheduler (GitHub Actions / Vercel Cron)
    enviando el header ``Authorization: Bearer <CRON_SECRET>``.
    """
    expected = settings.CRON_SECRET
    if not expected:
        raise HTTPException(status_code=503, detail="CRON_SECRET no configurado")
    if authorization != f"Bearer {expected}":
        raise HTTPException(status_code=401, detail="No autorizado")

    supabase = get_supabase()
    return await sync_live_scores(supabase)


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

@router.get("/external-games")
async def get_external_games():
    """Proxy para obtener los juegos de la API externa."""
    import httpx
    from fastapi import HTTPException
    url = "https://worldcup26.ir/get/games"
    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(url, timeout=15.0)
            response.raise_for_status()
            return response.json()
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Error obteniendo API: {e}")
