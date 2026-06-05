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
    """Verificación de salud del servicio."""
    return {"status": "ok", "service": "Quiniela Mundialista"}
