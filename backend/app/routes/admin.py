"""Rutas administrativas para gestionar resultados y puntuación."""

from fastapi import APIRouter, Depends, HTTPException

from app.auth import require_admin
from app.models import MatchResultUpdate, MatchStatusUpdate
from app.services.supabase_client import get_supabase
from app.services.scoring import calculate_and_update_scores

router = APIRouter(prefix="/api/admin", tags=["Administración"])


@router.post("/update-match")
async def update_match_result(
    result: MatchResultUpdate,
    admin: dict = Depends(require_admin),
):
    """Actualiza el resultado real de un partido y calcula los puntos."""
    supabase = get_supabase()

    # Actualizar resultado y estado del partido a finalizado
    response = (
        supabase.table("matches")
        .update(
            {
                "home_goals_actual": result.home_goals_actual,
                "away_goals_actual": result.away_goals_actual,
                "status": "finished",
            }
        )
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
