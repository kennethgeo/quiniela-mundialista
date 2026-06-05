"""
Módulo de autenticación y autorización.

Proporciona dependencias de FastAPI para:
- Verificar tokens JWT de Supabase (get_current_user)
- Validar permisos de administrador (require_admin)
"""

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.config import settings
from app.services.supabase_client import get_supabase

# Esquema de seguridad Bearer para extraer el token del header Authorization
security = HTTPBearer()


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> dict:
    """
    Dependencia de FastAPI que decodifica y valida el token JWT de Supabase.

    Retorna un diccionario con la información del usuario autenticado,
    incluyendo 'sub' (UUID del usuario).

    Raises:
        HTTPException 401: si el token es inválido, expirado o mal formado.
    """
    token = credentials.credentials

    try:
        # Decodificar el JWT usando el secreto de Supabase
        payload = jwt.decode(
            token,
            settings.SUPABASE_JWT_SECRET,
            algorithms=["HS256"],
            audience="authenticated",
        )
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="El token ha expirado",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except jwt.InvalidTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token inválido",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Verificar que el payload contenga el campo 'sub' (ID del usuario)
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token no contiene información del usuario",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return payload


async def require_admin(
    current_user: dict = Depends(get_current_user),
) -> dict:
    """
    Dependencia de FastAPI que verifica que el usuario autenticado
    tenga permisos de administrador (is_admin = true en la tabla users).

    Raises:
        HTTPException 403: si el usuario no es administrador.
        HTTPException 404: si el usuario no existe en la tabla users.
    """
    supabase = get_supabase()
    user_id = current_user["sub"]

    # Consultar la tabla users para verificar el flag is_admin
    response = (
        supabase.table("users")
        .select("is_admin")
        .eq("id", user_id)
        .single()
        .execute()
    )

    if not response.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Usuario no encontrado en la base de datos",
        )

    if not response.data.get("is_admin", False):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tienes permisos de administrador",
        )

    return current_user
