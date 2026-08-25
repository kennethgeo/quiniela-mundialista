"""Punto de entrada de la API Quiniela Mundialista."""

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routes import admin, leaderboard, leagues, matches

logger = logging.getLogger(__name__)

app = FastAPI(
    title="Quiniela Mundialista API",
    description="API para la quiniela del Mundial FIFA 2026",
    version="1.0.0",
)

# Configuración de CORS - permitir el frontend y servidores de desarrollo
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        settings.FRONTEND_URL,
        "http://localhost:5173",
        "http://localhost:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Registrar routers de cada módulo
app.include_router(matches.router)
app.include_router(admin.router)
app.include_router(leaderboard.router)
app.include_router(leagues.router)


@app.get("/")
async def root():
    """Endpoint raíz con información básica de la API."""
    return {"message": "Quiniela Mundialista API", "version": "1.0.0"}


@app.get("/api/health")
async def health_check():
    """Estado del servicio. Público, así que NO dice qué secretos hay
    configurados ni devuelve la excepción de la base: eso era un mapa de la
    instalación para cualquiera que pasara por acá. El detalle va a los logs."""
    ok = True
    try:
        from app.services.supabase_client import get_supabase

        if settings.SUPABASE_URL and settings.SUPABASE_SERVICE_ROLE_KEY:
            get_supabase().table("matches").select("id").limit(1).execute()
        else:
            ok = False
            logger.error("Health check: faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY")
    except Exception:  # noqa: BLE001
        ok = False
        logger.exception("Health check: la consulta a la base falló")

    return {"status": "ok" if ok else "degraded"}
