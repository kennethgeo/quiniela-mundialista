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

    # 1) Verificación local rápida (HS256 con secreto compartido, proyectos legacy)
    secret = (settings.SUPABASE_JWT_SECRET or "").strip()
    if secret:
        try:
            payload = jwt.decode(
                token,
                secret,
                algorithms=["HS256"],
                audience="authenticated",
            )
            if payload.get("sub"):
                return payload
        except jwt.ExpiredSignatureError:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="El token ha expirado",
                headers={"WWW-Authenticate": "Bearer"},
            )
        except jwt.InvalidTokenError:
            # Probablemente el token está firmado con llave asimétrica (ES256/RS256).
            # Caemos al método por API, que valida sin importar el algoritmo.
            pass

    # 2) Fallback: validar contra el servidor de Auth de Supabase. Funciona con
    #    llaves asimétricas (proyectos nuevos) y no depende del secreto compartido.
    try:
        supabase = get_supabase()
        res = supabase.auth.get_user(token)
        user = getattr(res, "user", None)
        if user and getattr(user, "id", None):
            return {
                "sub": user.id,
                "email": getattr(user, "email", None),
            }
    except Exception:  # noqa: BLE001
        pass

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Token inválido o expirado",
        headers={"WWW-Authenticate": "Bearer"},
    )


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
