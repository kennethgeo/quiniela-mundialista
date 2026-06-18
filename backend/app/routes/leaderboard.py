"""Rutas para el ranking de jugadores."""

from fastapi import APIRouter, Depends

from app.auth import get_current_user
from app.services.supabase_client import get_supabase

router = APIRouter(prefix="/api/leaderboard", tags=["Ranking"])

# Campos que se devuelven por jugador (forma estable de la respuesta).
_OUT_FIELDS = ("id", "display_name", "avatar_url", "total_points")


def _tiebreak_key(u: dict):
    """Clave de orden con el desempate oficial (debe coincidir con la vista
    user_badges_view y con frontend/src/lib/leaderboard.js):

        1) puntos          ↓   2) marcadores exactos      ↓
        3) correctos       ↓   4) goles del goleador      ↓
        5) acertó campeón  ↓   6) fecha de registro       ↑

    Se ordena ascendente: los criterios "mayor gana" van negados; la fecha de
    registro (más antiguo gana) va en positivo como último desempate. Tolera
    filas sin las columnas nuevas (se tratan como 0/False).
    """
    return (
        -int(u.get("total_points") or 0),
        -int(u.get("exact_count") or 0),
        -int(u.get("correct_count") or 0),
        -int(u.get("scorer_goals") or 0),
        -int(bool(u.get("champion_hit"))),
        u.get("created_at") or "",
    )


def _rank(users_data: list[dict]) -> list[dict]:
    """Ordena con el desempate y agrega la posición, devolviendo forma estable."""
    users_data.sort(key=_tiebreak_key)
    return [
        {**{k: u.get(k) for k in _OUT_FIELDS}, "rank": i}
        for i, u in enumerate(users_data, 1)
    ]


@router.get("")
async def global_leaderboard(user: dict = Depends(get_current_user)):
    """Ranking global de todos los jugadores, con desempate oficial."""
    supabase = get_supabase()

    # Se lee user_badges_view (no users) porque ahí viven las métricas de
    # desempate (exactos, correctos, goles del goleador, campeón).
    response = supabase.table("user_badges_view").select("*").execute()
    return _rank(list(response.data or []))


@router.get("/league/{league_id}")
async def league_leaderboard(
    league_id: str,
    user: dict = Depends(get_current_user),
):
    """Ranking dentro de una liga privada, con desempate oficial."""
    supabase = get_supabase()

    members_response = (
        supabase.table("league_members")
        .select("user_id")
        .eq("league_id", league_id)
        .execute()
    )
    member_ids = [m["user_id"] for m in (members_response.data or []) if m.get("user_id")]
    if not member_ids:
        return []

    rows = (
        supabase.table("user_badges_view")
        .select("*")
        .in_("id", member_ids)
        .execute()
    )
    return _rank(list(rows.data or []))
