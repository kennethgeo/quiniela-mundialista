"""
Sincronización de marcadores en vivo desde worldcup26.ir.

Usa la MISMA fuente y lógica de emparejamiento que el botón "Sincronizar API"
del panel admin, para tener una única fuente de verdad consistente y afinada
para el Mundial 2026:
  - Grupos: se emparejan por grupo + jornada + equipo (con tabla de alias).
  - Eliminatorias: se emparejan por orden de id.

Realiza UNA pasada: actualiza status/marcador de los partidos en curso o
finalizados y, en la transición a 'finished', calcula los puntos reusando
calculate_and_update_scores.

Notas de compatibilidad con el esquema:
  - `status` solo admite ('pending','in_progress','finished'); los partidos que
    aún no empiezan se quedan en 'pending' y no se tocan.
  - No se escribe ninguna columna inexistente (p. ej. events_json).
"""

import httpx

from app.services.scoring import calculate_and_update_scores

WORLDCUP_API_URL = "https://worldcup26.ir/get/games"

# Alias de nombres de la API -> nombres en nuestra BD (mismo mapa que el admin)
TEAM_ALIAS = {
    "Czech Republic": "Czechia",
    "Bosnia and Herzegovina": "Bosnia-Herzegovina",
    "Democratic Republic of the Congo": "DR Congo",
    "United States": "USA",
}


def _db_team(name):
    return TEAM_ALIAS.get(name, name)


def _to_int(value):
    """Convierte a int de forma segura; '' o None -> None."""
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (ValueError, TypeError):
        return None


def _map_status(api_game) -> str:
    """Mapea el estado de worldcup26 al enum de matches."""
    if api_game.get("finished") == "TRUE":
        return "finished"
    if api_game.get("time_elapsed") not in (None, "notstarted"):
        return "in_progress"
    return "pending"


def _minute_of(api_game, status):
    """Devuelve el reloj del partido (ej. '45') si está en vivo, si no None."""
    if status != "in_progress":
        return None
    te = api_game.get("time_elapsed")
    if te in (None, "", "notstarted", "finished"):
        return None
    return str(te)


async def sync_live_scores(supabase) -> dict:
    """Ejecuta una pasada de sincronización y devuelve un resumen."""
    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.get(WORLDCUP_API_URL)
        response.raise_for_status()
        data = response.json()

    api_games = data.get("games", [])

    # Cargar todos los partidos de la BD una sola vez
    matches = (
        supabase.table("matches")
        .select(
            "id,phase,group_name,matchday,home_team,away_team,"
            "status,home_goals_actual,away_goals_actual"
        )
        .execute()
        .data
        or []
    )

    summary = {"updated": 0, "finished_calculated": 0}
    errors = []

    async def apply_update(db_match, status, home_goals, away_goals, minute):
        changed = (
            db_match.get("status") != status
            or db_match.get("home_goals_actual") != home_goals
            or db_match.get("away_goals_actual") != away_goals
            or status == "in_progress"  # refrescar el minuto mientras está en vivo
        )
        if not changed:
            return

        payload = {"status": status}
        # Solo escribimos goles/minuto cuando el partido ya empezó
        if status != "pending":
            payload["home_goals_actual"] = home_goals
            payload["away_goals_actual"] = away_goals
            payload["minute"] = minute

        try:
            supabase.table("matches").update(payload).eq("id", db_match["id"]).execute()
        except Exception:
            # La columna 'minute' puede no existir aún: reintentar sin ella
            payload.pop("minute", None)
            supabase.table("matches").update(payload).eq("id", db_match["id"]).execute()

        summary["updated"] += 1

        # Calcular puntos solo en la transición a 'finished'
        if status == "finished" and db_match.get("status") != "finished":
            await calculate_and_update_scores(supabase, db_match["id"])
            summary["finished_calculated"] += 1

    # --- Grupos: emparejar por grupo + jornada + equipo ---
    for game in api_games:
        if game.get("type") != "group":
            continue
        try:
            api_home = _db_team(game.get("home_team_name_en"))
            api_away = _db_team(game.get("away_team_name_en"))
            api_pair = {api_home, api_away}
            # Emparejar por grupo + el PAR de equipos (robusto: no depende de la
            # jornada, que puede no coincidir con la de la fuente)
            db_match = next(
                (
                    m
                    for m in matches
                    if m.get("phase") == "groups"
                    and m.get("group_name") == game.get("group")
                    and {m.get("home_team"), m.get("away_team")} == api_pair
                ),
                None,
            )
            if not db_match:
                continue
            status = _map_status(game)
            await apply_update(
                db_match,
                status,
                _to_int(game.get("home_score")),
                _to_int(game.get("away_score")),
                _minute_of(game, status),
            )
        except Exception as exc:  # noqa: BLE001 - aislar fallos por partido
            errors.append(str(exc))

    # --- Eliminatorias: emparejar por orden de id ---
    api_ko = sorted(
        (g for g in api_games if g.get("type") != "group"),
        key=lambda g: _to_int(g.get("id")) or 0,
    )
    db_ko = sorted(
        (m for m in matches if m.get("phase") != "groups"),
        key=lambda m: m.get("id") or 0,
    )
    for api_game, db_match in zip(api_ko, db_ko):
        try:
            status = _map_status(api_game)
            await apply_update(
                db_match,
                status,
                _to_int(api_game.get("home_score")),
                _to_int(api_game.get("away_score")),
                _minute_of(api_game, status),
            )
        except Exception as exc:  # noqa: BLE001
            errors.append(str(exc))

    return {
        "status": "ok",
        "api_games": len(api_games),
        "updated": summary["updated"],
        "finished_calculated": summary["finished_calculated"],
        "errors": errors,
    }
