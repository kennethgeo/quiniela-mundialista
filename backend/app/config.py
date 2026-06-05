"""
Configuración de la aplicación.

Carga variables de entorno usando pydantic-settings.
Las variables se leen del archivo .env o del entorno del sistema.
"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Configuración global de la aplicación Quiniela Mundialista."""

    # URL del proyecto Supabase (ej: https://xxxx.supabase.co)
    SUPABASE_URL: str

    # Clave de servicio (service_role) para operaciones administrativas que
    # necesitan saltarse las políticas RLS de Supabase
    SUPABASE_SERVICE_ROLE_KEY: str

    # Secreto JWT de Supabase para verificar tokens de autenticación
    SUPABASE_JWT_SECRET: str

    # URL del frontend permitida en CORS (por defecto el dev server de Vite)
    FRONTEND_URL: str = "http://localhost:5173"

    # Modo debug: activa logs detallados y recarga automática
    DEBUG: bool = False

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
    )


# Instancia singleton de la configuración
settings = Settings()
