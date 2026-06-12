"""
Cliente de Supabase configurado con la clave de servicio (service_role).

La clave service_role permite saltarse las políticas de Row Level Security (RLS),
lo cual es necesario para operaciones administrativas del backend como:
- Actualizar resultados de partidos
- Recalcular puntajes
- Gestionar ligas y usuarios

IMPORTANTE: Este cliente NUNCA debe exponerse al frontend.
"""

from supabase import Client, create_client

from app.config import settings

# Cliente singleton de Supabase (se inicializa una sola vez)
_supabase_client: Client | None = None


def get_supabase() -> Client:
    """
    Retorna la instancia singleton del cliente de Supabase.

    Usa la clave service_role para tener acceso completo a la base de datos,
    sin restricciones de RLS.
    """
    global _supabase_client

    if _supabase_client is None:
        # Sanear la URL: quitar espacios, barra final y un posible sufijo
        # '/rest/v1' (el "RESTful endpoint" que muestra el panel Data API).
        url = settings.SUPABASE_URL.strip().rstrip("/")
        if url.endswith("/rest/v1"):
            url = url[: -len("/rest/v1")]

        _supabase_client = create_client(
            url,
            settings.SUPABASE_SERVICE_ROLE_KEY.strip(),
        )

    return _supabase_client
