"""
Motor de Puntuación Avanzado - Quiniela Mundialista FIFA 2026
Implementa las reglas de puntuación según el tipo de predicción y resultado real.
"""


def calculate_points(prediction: dict, match_result: dict) -> int:
    """
    Calcula los puntos obtenidos por una predicción según el resultado real.

    Args:
        prediction: {
            'prediction_type': str ('Marcador' o 'Solo_Ganador'),
            'home_pred': int (goles predichos local),
            'away_pred': int (goles predichos visitante),
            'penalties_pred': str or None (ganador predicho en penales: 'home', 'away', None),
            'use_powerup_x2': bool
        }
        match_result: {
            'home_goals': int (goles reales local),
            'away_goals': int (goles reales visitante),
            'goes_to_penalties': bool (si fue a penales),
            'penalties_winner': str or None ('home', 'away')
        }

    Returns:
        int: Puntos obtenidos (ya aplicado el powerup x2 si corresponde)
    """

    prediction_type = prediction.get('prediction_type', 'Marcador')
    use_powerup = prediction.get('use_powerup_x2', False)

    # Calcular puntos base según el tipo de predicción
    if prediction_type == 'Marcador':
        points = _calculate_marcador_points(prediction, match_result)
    elif prediction_type == 'Solo_Ganador':
        points = _calculate_solo_ganador_points(prediction, match_result)
    else:
        points = 0

    # Aplicar powerup x2 si fue utilizado
    if use_powerup and points > 0:
        points *= 2

    return points


def _calculate_marcador_points(prediction: dict, match_result: dict) -> int:
    """
    Modo "Marcador": Reglas detalladas según penales y empate.
    """
    home_pred = prediction.get('home_pred', 0)
    away_pred = prediction.get('away_pred', 0)
    penalties_pred = prediction.get('penalties_pred')

    home_real = match_result.get('home_goals', 0)
    away_real = match_result.get('away_goals', 0)
    goes_to_penalties = match_result.get('goes_to_penalties', False)
    penalties_winner = match_result.get('penalties_winner')

    # Validaciones básicas
    if home_pred is None or away_pred is None:
        return 0

    # =========================================================================
    # CASO 1: SIN PENALES (empate en 90 minutos pero no va a penales)
    # =========================================================================
    if not goes_to_penalties:
        # Empate exacto
        if home_pred == home_real and away_pred == away_real:
            return 6

        # Ganador correcto sin empate exacto
        pred_winner = _get_winner(home_pred, away_pred)
        real_winner = _get_winner(home_real, away_real)

        if pred_winner == real_winner and pred_winner in ('home', 'away'):
            # Ganador correcto + acierta goles de un equipo
            if home_pred == home_real or away_pred == away_real:
                return 4
            # Ganador correcto sin marcador exacto
            return 3

        # Acierta goles de un equipo, pero falla el ganador
        if home_pred == home_real or away_pred == away_real:
            return 1

        return 0

    # =========================================================================
    # CASO 2: CON PENALES (empate a 90 min + definición por penales)
    # =========================================================================

    # Empate exacto a los 90 minutos
    if home_pred == home_real and away_pred == away_real:
        # Empate exacto + acierta ganador de penales
        if penalties_pred == penalties_winner:
            return 9
        # Empate exacto + falla ganador de penales
        else:
            return 6

    # Empate sin marcador exacto (predijo 2-2, real 1-1, etc.)
    if _get_winner(home_pred, away_pred) == 'draw' and _get_winner(home_real, away_real) == 'draw':
        # Empate sin exacto + acierta ganador penales
        if penalties_pred == penalties_winner:
            return 6
        # Empate sin exacto + falla ganador penales
        else:
            return 3

    # EXCEPCIÓN: Predijo ganador en 90 min, pero resultado real fue empate a penales
    # En este caso, 0 puntos en la parte de penales
    pred_winner = _get_winner(home_pred, away_pred)
    real_winner = _get_winner(home_real, away_real)

    if pred_winner in ('home', 'away') and real_winner == 'draw':
        # No se otorgan puntos por la definición de penales
        # Solo evaluar si acertó parcialmente el marcador
        if home_pred == home_real or away_pred == away_real:
            return 1
        return 0

    # Otros casos: 0 puntos
    return 0


def _calculate_solo_ganador_points(prediction: dict, match_result: dict) -> int:
    """
    Modo "Solo Ganador": Solo se evalúa ganador o empate.
    """
    penalties_pred = prediction.get('penalties_pred')

    home_real = match_result.get('home_goals', 0)
    away_real = match_result.get('away_goals', 0)
    goes_to_penalties = match_result.get('goes_to_penalties', False)
    penalties_winner = match_result.get('penalties_winner')

    real_winner = _get_winner(home_real, away_real)

    # Si el usuario predijo ganador en 90 min, evaluar
    if penalties_pred in ('home', 'away'):
        # No es empate
        if real_winner in ('home', 'away'):
            # Acierta ganador
            if penalties_pred == real_winner:
                return 3
            return 0
        # Es empate
        elif real_winner == 'draw':
            # Falló (predijo ganador pero fue empate)
            return 0

    # Si el usuario predijo empate
    elif penalties_pred is None or penalties_pred == 'draw':
        # Caso 1: Resultado fue empate sin penales
        if real_winner == 'draw' and not goes_to_penalties:
            return 3

        # Caso 2: Resultado fue empate a 90 min Y a penales
        if real_winner == 'draw' and goes_to_penalties:
            # Acierta empate + acierta ganador penales
            if penalties_pred == 'draw' or penalties_pred is None:
                # Usuario solo predijo empate sin especificar ganador de penales
                # Dar 3 puntos por acertar empate
                # (Este formato es más simple para "Solo Ganador")
                return 3
            # Si realmente especificó ganador de penales
            if penalties_pred == penalties_winner:
                return 5
            # Acierta empate pero falla ganador de penales
            elif penalties_pred in ('home', 'away'):
                return 3

        # No es empate
        if real_winner in ('home', 'away'):
            return 0

    return 0


def _get_winner(home_goals: int, away_goals: int) -> str:
    """
    Determina el ganador basado en goles.

    Returns:
        'home', 'away', o 'draw'
    """
    if home_goals > away_goals:
        return 'home'
    elif away_goals > home_goals:
        return 'away'
    else:
        return 'draw'


# ============================================================================
# EJEMPLO DE USO
# ============================================================================

if __name__ == '__main__':
    # Ejemplo 1: Predicción exacta sin penales
    pred1 = {
        'prediction_type': 'Marcador',
        'home_pred': 2,
        'away_pred': 1,
        'penalties_pred': None,
        'use_powerup_x2': False
    }
    result1 = {
        'home_goals': 2,
        'away_goals': 1,
        'goes_to_penalties': False,
        'penalties_winner': None
    }
    print(f"Ejemplo 1 (Marcador exacto): {calculate_points(pred1, result1)} pts (esperado: 6)")

    # Ejemplo 2: Empate exacto + acierta ganador penales
    pred2 = {
        'prediction_type': 'Marcador',
        'home_pred': 1,
        'away_pred': 1,
        'penalties_pred': 'home',
        'use_powerup_x2': False
    }
    result2 = {
        'home_goals': 1,
        'away_goals': 1,
        'goes_to_penalties': True,
        'penalties_winner': 'home'
    }
    print(f"Ejemplo 2 (Empate exacto + penales correctos): {calculate_points(pred2, result2)} pts (esperado: 9)")

    # Ejemplo 3: Powerup x2
    pred3 = {
        'prediction_type': 'Marcador',
        'home_pred': 2,
        'away_pred': 1,
        'penalties_pred': None,
        'use_powerup_x2': True
    }
    result3 = {
        'home_goals': 2,
        'away_goals': 1,
        'goes_to_penalties': False,
        'penalties_winner': None
    }
    print(f"Ejemplo 3 (Marcador exacto con powerup): {calculate_points(pred3, result3)} pts (esperado: 12)")

    # Ejemplo 4: Solo ganador correcto
    pred4 = {
        'prediction_type': 'Solo_Ganador',
        'home_pred': None,
        'away_pred': None,
        'penalties_pred': 'home',
        'use_powerup_x2': False
    }
    result4 = {
        'home_goals': 2,
        'away_goals': 1,
        'goes_to_penalties': False,
        'penalties_winner': None
    }
    print(f"Ejemplo 4 (Solo ganador correcto): {calculate_points(pred4, result4)} pts (esperado: 3)")
