"""
Modelos Pydantic v2 para la API de Quiniela Mundialista.

Define los esquemas de validación para requests y responses
de partidos, predicciones, ligas y tabla de posiciones.
"""

from datetime import datetime, timezone
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, computed_field


# =============================================================================
# Modelos de Partidos
# =============================================================================


class MatchResponse(BaseModel):
    """Respuesta con los datos completos de un partido."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    home_team: str
    away_team: str
    home_flag_url: Optional[str] = None
    away_flag_url: Optional[str] = None
    kickoff_at: datetime
    phase: str  # Ej: "Fase de Grupos", "Octavos", "Cuartos", etc.
    group_name: Optional[str] = None  # Ej: "Grupo A" (solo en fase de grupos)
    matchday: Optional[int] = None  # Jornada dentro de la fase
    home_goals_actual: Optional[int] = None
    away_goals_actual: Optional[int] = None
    status: str  # "pending", "in_progress", "finished"
    venue: Optional[str] = None  # Nombre del estadio
    city: Optional[str] = None  # Ciudad del partido

    @computed_field
    @property
    def is_locked(self) -> bool:
        """
        Un partido se bloquea 15 minutos antes del kickoff.
        Una vez bloqueado, no se pueden crear ni modificar predicciones.
        """
        from datetime import timedelta

        lock_time = self.kickoff_at - timedelta(minutes=15)
        return datetime.now(timezone.utc) >= lock_time


class MatchResultUpdate(BaseModel):
    """Datos para actualizar el resultado real de un partido (solo admin)."""

    match_id: int
    home_goals_actual: int = Field(ge=0, description="Goles del equipo local")
    away_goals_actual: int = Field(ge=0, description="Goles del equipo visitante")
    goes_to_penalties: bool = Field(default=False, description="Indica si el partido se definió en penales")
    penalties_winner_real: Optional[str] = Field(default=None, description="Equipo ganador en penales (nombre o código)")


class MatchStatusUpdate(BaseModel):
    """Datos para actualizar el estado de un partido (solo admin)."""

    match_id: int
    status: str = Field(
        description="Nuevo estado del partido: 'in_progress' o 'finished'"
    )


# =============================================================================
# Modelos de Predicciones
# =============================================================================


class PredictionCreate(BaseModel):
    """Datos para crear o actualizar una predicción."""

    match_id: int
    prediction_type: str = Field(default="Marcador", description="Modalidad de predicción: 'Marcador' o 'Solo_Ganador'")
    home_goals_pred: Optional[int] = Field(default=None, ge=0, description="Goles predichos para el local")
    away_goals_pred: Optional[int] = Field(default=None, ge=0, description="Goles predichos para el visitante")
    penalties_winner_pred: Optional[str] = Field(default=None, description="Equipo predicho para ganar en penales")
    use_powerup_x2: bool = Field(default=False, description="Activar powerup x2 de puntos")


class PredictionResponse(BaseModel):
    """Respuesta con los datos de una predicción."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: str
    match_id: int
    home_goals_pred: int
    away_goals_pred: int
    points_earned: Optional[int] = None
    created_at: datetime


# =============================================================================
# Modelos de Tabla de Posiciones (Leaderboard)
# =============================================================================


class LeaderboardEntry(BaseModel):
    """Una entrada en la tabla de posiciones."""

    model_config = ConfigDict(from_attributes=True)

    user_id: str
    display_name: Optional[str] = None
    avatar_url: Optional[str] = None
    total_points: int = 0
    rank: Optional[int] = None


# =============================================================================
# Modelos de Ligas
# =============================================================================


class LeagueCreate(BaseModel):
    """Datos para crear una nueva liga privada."""

    name: str = Field(
        min_length=3,
        max_length=50,
        description="Nombre de la liga",
    )


class LeagueResponse(BaseModel):
    """Respuesta con los datos de una liga."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    invitation_code: str
    admin_id: str
    member_count: Optional[int] = 0


class JoinLeague(BaseModel):
    """Datos para unirse a una liga mediante código de invitación."""

    invitation_code: str = Field(
        min_length=6,
        max_length=6,
        description="Código de invitación de 6 caracteres",
    )
