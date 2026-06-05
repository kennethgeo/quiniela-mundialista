"""
Motor de puntuación de la Quiniela Mundialista.

Sistema de puntos:
  - 3 puntos: Resultado exacto (marcador idéntico al real)
  - 1 punto:  Resultado correcto (acertó ganador o empate, pero no el marcador)
  - 0 puntos: Resultado incorrecto

La lógica de desenlace:
  - Victoria local:   goles_local > goles_visitante
  - Victoria visitante: goles_visitante > goles_local
  - Empate:           goles_local == goles_visitante
"""

from supabase import Client


def _get_outcome(home_goals: int, away_goals: int) -> str:
    """
    Determina el desenlace de un partido o predicción.

    Returns:
        'home' si gana el local, 'away' si gana el visitante, 'draw' si empatan.
    """
    if home_goals > away_goals:
        return "home"
    elif away_goals > home_goals:
        return "away"
    else:
        return "draw"


def _calculate_points(
    pred_home: int,
    pred_away: int,
    actual_home: int,
    actual_away: int,
) -> int:
    """
    Calcula los puntos obtenidos por una predicción individual.

    Args:
        pred_home: Goles predichos para el equipo local.
        pred_away: Goles predichos para el equipo visitante.
        actual_home: Goles reales del equipo local.
        actual_away: Goles reales del equipo visitante.

    Returns:
        3 si acertó el marcador exacto,
        1 si acertó el desenlace (ganador o empate),
        0 si falló por completo.
    """
    # Verificar resultado exacto (máxima puntuación)
    if pred_home == actual_home and pred_away == actual_away:
        return 3

    # Verificar si acertó el desenlace (ganador o empate)
    pred_outcome = _get_outcome(pred_home, pred_away)
    actual_outcome = _get_outcome(actual_home, actual_away)

    if pred_outcome == actual_outcome:
        return 1

    # No acertó nada
    return 0


async def calculate_and_update_scores(supabase: Client, match_id: int) -> None:
    """
    Calcula y actualiza los puntajes de todas las predicciones de un partido.

    Proceso:
    1. Obtiene el resultado real del partido
    2. Obtiene TODAS las predicciones para este partido
    3. Calcula los puntos de cada predicción
    4. Actualiza los puntos de cada predicción en la BD
    5. Recalcula el total de puntos de cada usuario afectado
    6. Actualiza la columna total_points en la tabla users

    Args:
        supabase: Cliente de Supabase con permisos de servicio.
        match_id: ID del partido a procesar.

    Raises:
        ValueError: Si el partido no existe o no tiene resultado registrado.
    """
    # Paso 1: Obtener el resultado real del partido
    match_response = (
        supabase.table("matches")
        .select("home_goals_actual, away_goals_actual")
        .eq("id", match_id)
        .single()
        .execute()
    )

    match_data = match_response.data
    if not match_data:
        raise ValueError(f"Partido con ID {match_id} no encontrado")

    actual_home = match_data["home_goals_actual"]
    actual_away = match_data["away_goals_actual"]

    if actual_home is None or actual_away is None:
        raise ValueError(
            f"El partido {match_id} no tiene resultado registrado"
        )

    # Paso 2: Obtener todas las predicciones para este partido
    predictions_response = (
        supabase.table("predictions")
        .select("id, user_id, home_goals_pred, away_goals_pred")
        .eq("match_id", match_id)
        .execute()
    )

    predictions = predictions_response.data or []

    if not predictions:
        # No hay predicciones para este partido, nada que calcular
        return

    # Paso 3 y 4: Calcular puntos y actualizar cada predicción
    # Recopilar los user_ids afectados para actualizar sus totales después
    affected_user_ids: set[str] = set()

    for prediction in predictions:
        points = _calculate_points(
            pred_home=prediction["home_goals_pred"],
            pred_away=prediction["away_goals_pred"],
            actual_home=actual_home,
            actual_away=actual_away,
        )

        # Actualizar los puntos de esta predicción en la base de datos
        supabase.table("predictions").update(
            {"points_earned": points}
        ).eq("id", prediction["id"]).execute()

        affected_user_ids.add(prediction["user_id"])

    # Paso 5 y 6: Recalcular el total de puntos para cada usuario afectado
    for user_id in affected_user_ids:
        # Sumar todos los puntos ganados en todas las predicciones del usuario
        user_predictions_response = (
            supabase.table("predictions")
            .select("points_earned")
            .eq("user_id", user_id)
            .not_.is_("points_earned", "null")
            .execute()
        )

        total_points = sum(
            p["points_earned"]
            for p in (user_predictions_response.data or [])
        )

        # Actualizar el total de puntos en la tabla de usuarios
        supabase.table("users").update(
            {"total_points": total_points}
        ).eq("id", user_id).execute()
