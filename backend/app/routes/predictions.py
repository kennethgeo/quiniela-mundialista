"""Rutas para gestionar las predicciones de los usuarios."""

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status

from app.auth import get_current_user
from app.models import PredictionCreate
from app.services.supabase_client import get_supabase

router = APIRouter(prefix="/api/predictions", tags=["Predicciones"])

# Minutos antes del kickoff en que se bloquean las predicciones
LOCKOUT_MINUTES = 15


@router.post("")
async def save_prediction(
    prediction: PredictionCreate,
    user: dict = Depends(get_current_user),
):
    """Guarda o actualiza una predicción. Bloquea si faltan menos de 15 min."""
    supabase = get_supabase()
    user_id = user["sub"]

    # Verificar que el partido existe y obtener su hora de inicio
    match_response = (
        supabase.table("matches")
        .select("id, kickoff_at, status")
        .eq("id", prediction.match_id)
        .single()
        .execute()
    )
    match = match_response.data

    if not match:
        raise HTTPException(status_code=404, detail="Partido no encontrado")

    if match["status"] != "pending":
        raise HTTPException(
            status_code=403, detail="Este partido ya comenzó o finalizó"
        )

    # Regla de bloqueo de 15 minutos antes del kickoff
    kickoff = datetime.fromisoformat(
        match["kickoff_at"].replace("Z", "+00:00")
    )
    lockout_time = kickoff - timedelta(minutes=LOCKOUT_MINUTES)
    now = datetime.now(timezone.utc)

    if now >= lockout_time:
        raise HTTPException(
            status_code=403,
            detail=(
                "Las predicciones están bloqueadas para este partido. "
                f"Se cerraron {LOCKOUT_MINUTES} minutos antes del inicio."
            ),
        )

    # Upsert: insertar o actualizar predicción existente
    data = {
        "user_id": user_id,
        "match_id": prediction.match_id,
        "prediction_type": prediction.prediction_type,
        "home_goals_pred": prediction.home_goals_pred,
        "away_goals_pred": prediction.away_goals_pred,
        "penalties_winner_pred": prediction.penalties_winner_pred,
        "use_powerup_x2": prediction.use_powerup_x2,
        "updated_at": now.isoformat(),
    }

    response = (
        supabase.table("predictions")
        .upsert(data, on_conflict="user_id,match_id")
        .execute()
    )

    return {"message": "Predicción guardada exitosamente", "data": response.data}


@router.get("/mine")
async def my_predictions(user: dict = Depends(get_current_user)):
    """Obtiene todas las predicciones del usuario actual."""
    supabase = get_supabase()
    user_id = user["sub"]

    response = (
        supabase.table("predictions")
        .select("*, matches(*)")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .execute()
    )
    return response.data


@router.get("/match/{match_id}")
async def match_predictions(
    match_id: int,
    user: dict = Depends(get_current_user),
):
    """Obtiene todas las predicciones de un partido (solo si ya comenzó)."""
    supabase = get_supabase()

    # Verificar que el partido ya no está pendiente
    match_response = (
        supabase.table("matches")
        .select("status")
        .eq("id", match_id)
        .single()
        .execute()
    )

    if match_response.data["status"] == "pending":
        raise HTTPException(
            status_code=403,
            detail=(
                "Las predicciones de otros usuarios no están disponibles "
                "hasta que el partido comience."
            ),
        )

    response = (
        supabase.table("predictions")
        .select("*, users(display_name, avatar_url)")
        .eq("match_id", match_id)
        .execute()
    )
    return response.data
