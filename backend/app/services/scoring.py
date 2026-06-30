"""
Motor de puntuación de la Quiniela Mundialista.

Reglas (Modalidad Marcador):
- Marcador exacto (incluye empate exacto) → 3 pts.
- Aciertas quién gana o que es empate, pero no el marcador → 1 pt.
- Fallas el resultado (quién gana / empate) → 0 pts.
- Penales: si predijiste un ganador pero el partido fue a penales (empate en
  90'), 0 pts. Si predijiste empate y aciertas el ganador de penales, conservas
  el punto; si lo fallas, 0.

Modalidad Solo_Ganador:
- Aciertas el resultado → 1 pt; fallas → 0.

Modificador: comodín x2 → duplica los puntos ganados (1→2, 3→6).

Esta lógica es idéntica a la del frontend (lib/scoring.js).
"""

from app.services.notifications import broadcast_push_to_users


def evaluate_prediction(
    pred: dict,
    home_actual: int,
    away_actual: int,
    goes_to_penalties: bool,
    penalties_winner_real: str,
    home_team: str = None,
    away_team: str = None,
) -> int:

    pred_type = pred.get("prediction_type", "Marcador")
    home_pred = pred.get("home_goals_pred")
    away_pred = pred.get("away_goals_pred")
    penalties_winner_pred = pred.get("penalties_winner_pred")
    use_powerup = pred.get("use_powerup_x2", False)

    # Ganador real en tiempo regular
    if home_actual > away_actual:
        real_winner = "home"
    elif away_actual > home_actual:
        real_winner = "away"
    else:
        real_winner = "tie"

    points = 0

    if pred_type == "Marcador":
        if home_pred is None or away_pred is None:
            return 0

        if home_pred > away_pred:
            pred_winner = "home"
        elif away_pred > home_pred:
            pred_winner = "away"
        else:
            pred_winner = "tie"

        # Predijo un ganador y el partido se fue a penales (empate en 90'/120').
        # Si el equipo que eligió ganador es el que avanzó en penales, 1 punto
        # (acertó quién pasa). Si no, 0.
        if goes_to_penalties and pred_winner != "tie":
            pred_team = home_team if pred_winner == "home" else away_team
            points = 1 if (penalties_winner_real and pred_team and pred_team == penalties_winner_real) else 0
        else:
            if real_winner == "tie":
                if home_pred == home_actual and away_pred == away_actual:
                    points = 3  # empate exacto
                elif pred_winner == "tie":
                    points = 1  # acierta empate, no el marcador
                else:
                    points = 0
                # Penales: el marcador del empate vale igual (3/1) aunque se
                # falle el penal. Acertar quién pasa suma +1 a la base, así el
                # comodín x2 también lo duplica.
                if (goes_to_penalties and pred_winner == "tie"
                        and penalties_winner_pred and penalties_winner_real
                        and penalties_winner_pred == penalties_winner_real):
                    points += 1
            else:
                if home_pred == home_actual and away_pred == away_actual:
                    points = 3  # marcador exacto
                elif pred_winner == real_winner:
                    points = 1  # acierta el ganador, no el marcador
                else:
                    points = 0

    elif pred_type == "Solo_Ganador":
        pred_winner = "tie"
        if home_pred is not None and away_pred is not None:
            if home_pred > away_pred:
                pred_winner = "home"
            elif away_pred > home_pred:
                pred_winner = "away"

        if goes_to_penalties:
            if pred_winner == "tie":
                if penalties_winner_pred and penalties_winner_real and penalties_winner_pred == penalties_winner_real:
                    points = 1
                else:
                    points = 0
            else:
                points = 0
        else:
            points = 1 if pred_winner == real_winner else 0

    # Comodín x2: duplica los puntos ganados (incluido el +1 de penales).
    if use_powerup:
        points *= 2

    return points


async def calculate_and_update_scores(supabase, match_id: int) -> dict:
    """
    Obtiene el resultado del partido, evalúa todas las predicciones
    usando las nuevas reglas y actualiza los puntos de los usuarios.
    """
    # 1. Obtener resultado real del partido
    match_response = (
        supabase.table("matches")
        .select("id, home_team, away_team, home_goals_actual, away_goals_actual, status, goes_to_penalties, penalties_winner_real")
        .eq("id", match_id)
        .single()
        .execute()
    )
    match = match_response.data

    if not match or match.get("status") != "finished":
        return {"status": "error", "message": "Partido no finalizado o no encontrado"}

    home_actual = match["home_goals_actual"]
    away_actual = match["away_goals_actual"]
    goes_to_penalties = match.get("goes_to_penalties", False)
    penalties_winner_real = match.get("penalties_winner_real")

    if home_actual is None or away_actual is None:
        return {"status": "error", "message": "El partido no tiene resultado válido"}

    # 2. Obtener todas las predicciones para este partido
    predictions_response = (
        supabase.table("predictions").select("*").eq("match_id", match_id).execute()
    )
    predictions = predictions_response.data

    if not predictions:
        return {"status": "ok", "message": "No hay predicciones para este partido"}

    updates = []
    user_points_delta = {}

    # 3. Evaluar cada predicción
    for pred in predictions:
        pts = evaluate_prediction(
            pred,
            home_actual,
            away_actual,
            goes_to_penalties,
            penalties_winner_real,
            match.get("home_team"),
            match.get("away_team")
        )
        
        # Calcular la diferencia si ya tenía puntos calculados antes
        old_points = pred.get("points_earned") or 0
        delta = pts - old_points

        if delta != 0:
            updates.append({"id": pred["id"], "points_earned": pts})
            user_id = pred["user_id"]
            user_points_delta[user_id] = user_points_delta.get(user_id, 0) + delta

    # 4. Guardar los nuevos puntos en la tabla predictions.
    #    Se usa UPDATE por id (no upsert): el upsert parcial intentaba INSERTAR
    #    filas sin user_id y violaba el NOT NULL, dejando los partidos sin puntuar.
    for u in updates:
        supabase.table("predictions").update(
            {"points_earned": u["points_earned"]}
        ).eq("id", u["id"]).execute()

    # 5. users.total_points lo mantiene SOLA la base de datos (trigger
    #    recompute_user_total). Ya no lo tocamos aquí con deltas: ese patrón
    #    (leer-sumar-escribir) se pisaba con el sync del frontend bajo
    #    concurrencia ("lost update") y descuadraba los totales.
    updated_users = sum(1 for d in user_points_delta.values() if d != 0)

    # 6. Enviar notificaciones push a los usuarios que ganaron puntos
    users_with_positive_delta = [u for u, d in user_points_delta.items() if d > 0]
    if users_with_positive_delta:
        # Enviar push en background para no bloquear
        # Usamos await porque la función es async, pero idealmente se usaría BackgroundTasks en FastAPI
        # Para simplicidad lo haremos await
        await broadcast_push_to_users(
            supabase, 
            users_with_positive_delta, 
            title="¡Tus puntos se han actualizado!", 
            body=f"El partido {match_id} ha finalizado. Revisa tu posición en el ranking.",
            url="/ranking"
        )

    return {
        "status": "ok",
        "predictions_evaluated": len(predictions),
        "predictions_updated": len(updates),
        "users_updated": updated_users,
    }
