"""Rutas administrativas para gestionar resultados y puntuación."""

from fastapi import APIRouter, Body, Depends, HTTPException

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


@router.post("/delete-user")
async def delete_user(
    user_id: str = Body(..., embed=True),
    admin: dict = Depends(require_admin),
):
    """Elimina por completo a un usuario y todos sus datos.

    Borra al usuario de Supabase Auth, lo que elimina en cascada su fila en
    public.users y todo lo dependiente (predicciones, predicciones de torneo,
    membresías de liga, suscripciones push, chat, etc.).

    Guardas:
    - Un admin no puede borrarse a sí mismo.
    - Solo accesible para usuarios con is_admin = true.
    """
    if not user_id:
        raise HTTPException(status_code=400, detail="user_id requerido")
    if user_id == admin.get("sub"):
        raise HTTPException(status_code=400, detail="No puedes borrarte a ti mismo")

    supabase = get_supabase()

    # Nombre para el mensaje de confirmación (best-effort)
    display_name = None
    try:
        info = supabase.table("users").select("display_name").eq("id", user_id).single().execute()
        display_name = (info.data or {}).get("display_name")
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
        "via": deleted_via,
    }
