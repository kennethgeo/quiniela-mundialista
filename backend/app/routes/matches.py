"""Rutas para gestionar los partidos del mundial."""

from fastapi import APIRouter, Depends, Query
from typing import Optional

from app.auth import get_current_user
from app.services.supabase_client import get_supabase

router = APIRouter(prefix="/api/matches", tags=["Partidos"])


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
