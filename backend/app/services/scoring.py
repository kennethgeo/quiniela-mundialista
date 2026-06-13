"""
Motor de puntuación avanzado para la Quiniela Mundialista.

Evalúa predicciones comparándolas con el resultado real bajo las reglas:
Modalidad A (Marcador):
- Sin penales: 6 (Exacto), 4 (Ganador + 1 marcador), 3 (Solo Ganador), 1 (Falla ganador pero acierta 1 marcador). Empates: 6 (Exacto), 3 (No exacto).
- Con penales: 9 (Empate exacto + penales), 6 (Empate exacto + falla penales o Empate no exacto + penales), 3 (Empate no exacto + falla penales), 0 (Exclusión si predijo ganador regular pero fue a penales).

Modalidad B (Solo Ganador):
- 3 Pts: Acierta ganador en 90 mins o acierta que hay empate.
- 5 Pts: Acierta empate + acierta ganador de penales.
- 0 Pts: Falla.

Modificador Global:
- x2 si use_powerup_x2 es True.
"""

from app.services.notifications import broadcast_push_to_users

def evaluate_prediction(
    pred: dict,
    home_actual: int,
    away_actual: int,
    goes_to_penalties: bool,
    penalties_winner_real: str
) -> int:
    
    pred_type = pred.get("prediction_type", "Marcador")
    home_pred = pred.get("home_goals_pred")
    away_pred = pred.get("away_goals_pred")
    penalties_winner_pred = pred.get("penalties_winner_pred")
    use_powerup = pred.get("use_powerup_x2", False)
    
    # Determinar ganador real en tiempo regular
    if home_actual > away_actual:
        real_winner = "home"
    elif away_actual > home_actual:
        real_winner = "away"
    else:
        real_winner = "tie"
        
    points = 0
    
    if pred_type == "Marcador":
        if home_pred is None or away_pred is None:
            return 0  # Invalida
            
        # Determinar ganador predicho en tiempo regular
        if home_pred > away_pred:
            pred_winner = "home"
        elif away_pred > home_pred:
            pred_winner = "away"
        else:
            pred_winner = "tie"
            
        # Regla de exclusión para penales
        # Si predijo que alguien ganaba en 90min, pero el partido fue a penales (empate real)
        if goes_to_penalties and pred_winner != "tie":
            points = 0
        else:
            if real_winner == "tie":
                # Escenario de empate
                if home_pred == home_actual and away_pred == away_actual:
                    points = 6  # Empate exacto
                elif pred_winner == "tie":
                    points = 3  # Empate no exacto
                else:
                    points = 0
                    
                # Evaluar penales si aplica y predijo empate (ya validado por regla exclusión)
                if goes_to_penalties and pred_winner == "tie" and penalties_winner_pred and penalties_winner_real:
                    if penalties_winner_pred == penalties_winner_real:
                        points += 3
            else:
                # Escenario donde hay ganador en 90 mins (Sin penales)
                if home_pred == home_actual and away_pred == away_actual:
                    points = 6  # Marcador exacto
                elif pred_winner == real_winner:
                    if home_pred == home_actual or away_pred == away_actual:
                        points = 4  # Ganador correcto + 1 marcador
                    else:
                        points = 3  # Solo ganador correcto
                else:
                    if home_pred == home_actual or away_pred == away_actual:
                        points = 1  # Falla ganador pero acierta 1 marcador
                    else:
                        points = 0
                        
    elif pred_type == "Solo_Ganador":
        # En Solo_Ganador, los usuarios envían:
        # home_goals_pred=1, away_goals_pred=0 para "Local"
        # home_goals_pred=0, away_goals_pred=1 para "Visitante"
        # home_goals_pred=0, away_goals_pred=0 para "Empate"
        pred_winner = "tie"
        if home_pred is not None and away_pred is not None:
            if home_pred > away_pred: pred_winner = "home"
            elif away_pred > home_pred: pred_winner = "away"
            
        if goes_to_penalties:
            if pred_winner == "tie":
                if penalties_winner_pred and penalties_winner_real and penalties_winner_pred == penalties_winner_real:
                    points = 5  # Acierta empate + penales
                else:
                    points = 3  # Solo acierta empate
            else:
                points = 0  # Falla
        else:
            if pred_winner == real_winner:
                points = 3  # Acierta ganador en 90min (o empate si no hubo penales)
            else:
                points = 0

    # Multiplicador Powerup
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
        .select("id, home_goals_actual, away_goals_actual, status, goes_to_penalties, penalties_winner_real")
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
            penalties_winner_real
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

    # 5. Actualizar el total de puntos en la tabla users
    updated_users = 0
    for user_id, delta in user_points_delta.items():
        if delta != 0:
            user_res = (
                supabase.table("users").select("total_points").eq("id", user_id).single().execute()
            )
            if user_res.data:
                current_total = user_res.data.get("total_points") or 0
                supabase.table("users").update({"total_points": current_total + delta}).eq("id", user_id).execute()
                updated_users += 1

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
