"""Rutas para el ranking de jugadores."""

from fastapi import APIRouter, Depends

from app.auth import get_current_user
from app.services.supabase_client import get_supabase

router = APIRouter(prefix="/api/leaderboard", tags=["Ranking"])


@router.get("")
async def global_leaderboard(user: dict = Depends(get_current_user)):
    """Ranking global de todos los jugadores, ordenado por puntos totales."""
    supabase = get_supabase()

    response = (
        supabase.table("users")
        .select("id, display_name, avatar_url, total_points")
        .order("total_points", desc=True)
        .execute()
    )

    # Agregar posición en el ranking
    ranked = []
    for i, user_data in enumerate(response.data, 1):
        ranked.append({**user_data, "rank": i})
    return ranked


@router.get("/league/{league_id}")
async def league_leaderboard(
    league_id: str,
    user: dict = Depends(get_current_user),
):
    """Ranking dentro de una liga privada."""
    supabase = get_supabase()

    # Obtener miembros de la liga con sus datos de usuario
    members_response = (
        supabase.table("league_members")
        .select("user_id, users(id, display_name, avatar_url, total_points)")
        .eq("league_id", league_id)
        .execute()
    )

    # Extraer datos de usuario y ordenar por puntos descendente
    users_data = [
        m["users"] for m in members_response.data if m.get("users")
    ]
    users_data.sort(key=lambda x: x.get("total_points", 0), reverse=True)

    # Agregar posición en el ranking de la liga
    ranked = []
    for i, u in enumerate(users_data, 1):
        ranked.append({**u, "rank": i})
    return ranked
