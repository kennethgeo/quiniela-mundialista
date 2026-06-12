"""Punto de entrada de la API Quiniela Mundialista."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routes import admin, leaderboard, leagues, matches, predictions

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
app.include_router(predictions.router)
app.include_router(admin.router)
app.include_router(leaderboard.router)
app.include_router(leagues.router)


@app.get("/")
async def root():
    """Endpoint raíz con información básica de la API."""
    return {"message": "Quiniela Mundialista API", "version": "1.0.0"}


@app.get("/api/health")
async def health_check():
    """Verificación de salud del servicio, configuración y conexión a la BD."""
    db_status = "skipped"
    try:
        from app.services.supabase_client import get_supabase

        if settings.SUPABASE_URL and settings.SUPABASE_SERVICE_ROLE_KEY:
            get_supabase().table("matches").select("id").limit(1).execute()
            db_status = "ok"
    except Exception as exc:  # noqa: BLE001 - reportar error de BD para diagnóstico
        db_status = f"{type(exc).__name__}: {exc}"

    return {
        "status": "ok",
        "service": "Quiniela Mundialista",
        "config": {
            "supabase_url": bool(settings.SUPABASE_URL),
            "supabase_service_role_key": bool(settings.SUPABASE_SERVICE_ROLE_KEY),
            "supabase_jwt_secret": bool(settings.SUPABASE_JWT_SECRET),
            "cron_secret": bool(settings.CRON_SECRET),
        },
        "db": db_status,
    }
