"""Rutas para gestionar ligas privadas entre amigos."""

import secrets

from fastapi import APIRouter, Depends, HTTPException

from app.auth import get_current_user
from app.models import JoinLeague, LeagueCreate
from app.services.supabase_client import get_supabase

def _exigir_membresia(supabase, league_id: str, user_id: str) -> None:
    """Corta si quien pide no es miembro de la quiniela.

    Estas rutas corren con service_role, o sea que SALTAN la RLS: sin esta
    comprobación, cualquiera con sesión y un UUID de liga se llevaba los
    detalles, la lista de miembros y el código de invitación de una quiniela
    ajena. La RLS no cubre lo que el backend consulta con la llave de servicio.
    """
    pertenece = (
        supabase.table("league_members")
        .select("user_id")
        .eq("league_id", league_id)
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    if not pertenece.data:
        # 404 y no 403: confirmar que la liga existe ya le sirve a quien esté
        # probando UUIDs al azar.
        raise HTTPException(status_code=404, detail="Quiniela no encontrada")


router = APIRouter(prefix="/api/leagues", tags=["Ligas"])


def generate_invitation_code(length: int = 8) -> str:
    """Genera un código de invitación.

    Con 'random' (Mersenne Twister) la secuencia es predecible si se observan
    suficientes códigos, y con la app abierta al público eso deja adivinar
    invitaciones a quinielas ajenas. 'secrets' usa el generador del sistema.
    Se quitan las letras y dígitos que se confunden al dictarlos por WhatsApp
    (O/0, I/1) y se sube a 8 caracteres: 32^8 en vez de 36^6.
    """
    chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "".join(secrets.choice(chars) for _ in range(length))


@router.post("")
async def create_league(
    league: LeagueCreate,
    user: dict = Depends(get_current_user),
):
    """Crea una nueva liga privada."""
    supabase = get_supabase()
    user_id = user["sub"]

    # Generar código único de invitación
    code = generate_invitation_code()

    # Crear la liga
    league_response = (
        supabase.table("leagues")
        .insert(
            {
                "name": league.name,
                "invitation_code": code,
                "admin_id": user_id,
            }
        )
        .execute()
    )

    league_data = league_response.data[0]

    # El creador se une automáticamente como miembro
    supabase.table("league_members").insert(
        {"league_id": league_data["id"], "user_id": user_id}
    ).execute()

    return {"message": "Liga creada exitosamente", "data": league_data}


@router.post("/join")
async def join_league(
    payload: JoinLeague,
    user: dict = Depends(get_current_user),
):
    """Unirse a una liga usando el código de invitación."""
    supabase = get_supabase()
    user_id = user["sub"]

    # Buscar la liga por código de invitación (case-insensitive)
    league_response = (
        supabase.table("leagues")
        .select("id, name")
        .eq("invitation_code", payload.invitation_code.upper())
        .execute()
    )

    if not league_response.data:
        raise HTTPException(
            status_code=404, detail="Código de invitación inválido"
        )

    league = league_response.data[0]

    # Verificar si el usuario ya es miembro de esta liga
    existing = (
        supabase.table("league_members")
        .select("*")
        .eq("league_id", league["id"])
        .eq("user_id", user_id)
        .execute()
    )

    if existing.data:
        raise HTTPException(
            status_code=400, detail="Ya eres miembro de esta liga"
        )

    # Registrar la membresía
    supabase.table("league_members").insert(
        {"league_id": league["id"], "user_id": user_id}
    ).execute()

    return {
        "message": f"Te uniste a la liga '{league['name']}'",
        "league": league,
    }


@router.get("/mine")
async def my_leagues(user: dict = Depends(get_current_user)):
    """Lista las ligas del usuario actual."""
    supabase = get_supabase()
    user_id = user["sub"]

    response = (
        supabase.table("league_members")
        .select("league_id, leagues(id, name, invitation_code, admin_id)")
        .eq("user_id", user_id)
        .execute()
    )

    leagues = [m["leagues"] for m in response.data if m.get("leagues")]

    # Agregar conteo de miembros a cada liga
    for league in leagues:
        count_response = (
            supabase.table("league_members")
            .select("user_id", count="exact")
            .eq("league_id", league["id"])
            .execute()
        )
        league["member_count"] = count_response.count or 0

    return leagues


@router.get("/{league_id}")
async def get_league(
    league_id: str,
    user: dict = Depends(get_current_user),
):
    """Obtiene los detalles de una liga con sus miembros. Solo para miembros."""
    supabase = get_supabase()
    _exigir_membresia(supabase, league_id, user["sub"])

    # Datos de la liga
    league_response = (
        supabase.table("leagues")
        .select("*")
        .eq("id", league_id)
        .single()
        .execute()
    )

    # Miembros de la liga con sus datos de usuario
    members_response = (
        supabase.table("league_members")
        .select("users(id, display_name, avatar_url, total_points)")
        .eq("league_id", league_id)
        .execute()
    )

    members = [m["users"] for m in members_response.data if m.get("users")]

    return {**league_response.data, "members": members}


@router.delete("/{league_id}")
async def delete_league(
    league_id: str,
    user: dict = Depends(get_current_user),
):
    """Elimina una liga (solo el administrador puede hacerlo)."""
    supabase = get_supabase()
    user_id = user["sub"]

    # Verificar que el usuario actual es el admin de la liga
    league_response = (
        supabase.table("leagues")
        .select("admin_id")
        .eq("id", league_id)
        .single()
        .execute()
    )

    if league_response.data["admin_id"] != user_id:
        raise HTTPException(
            status_code=403,
            detail="Solo el admin puede eliminar la liga",
        )

    supabase.table("leagues").delete().eq("id", league_id).execute()
    return {"message": "Liga eliminada exitosamente"}
