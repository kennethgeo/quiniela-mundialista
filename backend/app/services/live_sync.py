"""
Sincronización de marcadores en vivo desde la API pública de ESPN.

Realiza UNA pasada: obtiene los partidos del scoreboard de ESPN, actualiza el
marcador y el estado de los partidos correspondientes en Supabase y, cuando un
partido pasa a 'finished', calcula los puntos de las predicciones.

Diseñado para ser invocado por un scheduler (GitHub Actions / Vercel Cron) a
través del endpoint protegido POST /api/matches/sync-live.

Notas de compatibilidad con el esquema:
- La columna `status` solo admite ('pending','in_progress','finished'); por eso
  los partidos que aún no empiezan (estado ESPN 'pre') NO se tocan.
- El esquema no tiene columna `events_json`, así que no se escribe.
"""

import httpx

from app.services.scoring import calculate_and_update_scores

# API pública de ESPN para la Copa del Mundo (sin API key)
ESPN_API_URL = (
    "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard"
)


def _map_status(espn_state: str) -> str:
    """Mapea el estado de ESPN al enum de la tabla matches."""
    if espn_state == "in":
        return "in_progress"
    if espn_state == "post":
        return "finished"
    return "pending"


async def sync_live_scores(supabase) -> dict:
    """Ejecuta una pasada de sincronización y devuelve un resumen."""
    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.get(ESPN_API_URL)
        response.raise_for_status()
        data = response.json()

    events = data.get("events", [])

    updated = 0
    finished_calculated = 0
    errors = []

    for event in events:
        try:
            competition = event["competitions"][0]
            competitors = competition["competitors"]

            home_comp = next(
                (c for c in competitors if c.get("homeAway") == "home"), None
            )
            away_comp = next(
                (c for c in competitors if c.get("homeAway") == "away"), None
            )
            if not home_comp or not away_comp:
                continue

            home_team = home_comp["team"]["name"]
            away_team = away_comp["team"]["name"]

            espn_state = event["status"]["type"]["state"]
            status = _map_status(espn_state)

            # No tocamos partidos que aún no empiezan (evita churn y respeta el enum)
            if status == "pending":
                continue

            # Localizar el partido en nuestra BD por nombres de equipo
            query = (
                supabase.table("matches")
                .select("id, status, home_goals_actual, away_goals_actual")
                .ilike("home_team", f"%{home_team}%")
                .ilike("away_team", f"%{away_team}%")
                .execute()
            )
            if not query.data:
                continue

            db_match = query.data[0]
            match_id = db_match["id"]

            home_goals = int(home_comp.get("score", 0) or 0)
            away_goals = int(away_comp.get("score", 0) or 0)

            payload = {
                "status": status,
                "home_goals_actual": home_goals,
                "away_goals_actual": away_goals,
            }

            changed = (
                db_match.get("status") != status
                or db_match.get("home_goals_actual") != home_goals
                or db_match.get("away_goals_actual") != away_goals
            )

            if changed:
                supabase.table("matches").update(payload).eq("id", match_id).execute()
                updated += 1

            # Calcular puntos solo en la transición a 'finished'
            if status == "finished" and db_match.get("status") != "finished":
                await calculate_and_update_scores(supabase, match_id)
                finished_calculated += 1

        except Exception as exc:  # noqa: BLE001 - aislar fallos por partido
            errors.append(str(exc))
            continue

    return {
        "status": "ok",
        "events_seen": len(events),
        "updated": updated,
        "finished_calculated": finished_calculated,
        "errors": errors,
    }
