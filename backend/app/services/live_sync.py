"""
Sincronización de marcadores en vivo.

Fuente primaria: ESPN (rápida, con minuto real y nombres compatibles con la BD).
Respaldo: worldcup26.ir (si ESPN falla o no devuelve nada).

Realiza UNA pasada: actualiza status/marcador/minuto de los partidos en curso o
finalizados y, en la transición a 'finished', calcula los puntos reusando
calculate_and_update_scores (el motor de puntos NO se toca aquí).

Notas de esquema:
- `status` solo admite ('pending','in_progress','finished'); los partidos que
  aún no empiezan NO se tocan.
- El minuto se escribe en `matches.minute` de forma best-effort (tolera que la
  columna no exista).
"""

from datetime import datetime, timedelta, timezone

import httpx

from app.services.scoring import calculate_and_update_scores

ESPN_URL = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard"
WORLDCUP_API_URL = "https://worldcup26.ir/get/games"

# Alias de nombres de las fuentes -> nombres en la BD
TEAM_ALIAS = {
    "Czech Republic": "Czechia",
    "Bosnia and Herzegovina": "Bosnia-Herzegovina",
    "Bosnia & Herzegovina": "Bosnia-Herzegovina",
    "Democratic Republic of the Congo": "DR Congo",
    "Congo DR": "DR Congo",
    "United States": "USA",
    "Korea Republic": "South Korea",
    "Turkey": "Türkiye",
    "Turkiye": "Türkiye",
    "Curacao": "Curaçao",
    "Cote d'Ivoire": "Ivory Coast",
    "Côte d'Ivoire": "Ivory Coast",
}


def _db_team(name):
    n = (name or "").strip()
    return TEAM_ALIAS.get(n, n)


def _to_int(value):
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (ValueError, TypeError):
        return None


# ── Fuentes: devuelven una lista normalizada de "games" ──
# game = {home, away, home_score, away_score, status, minute, group}

async def _fetch_espn_games():
    """Partidos de hoy y ayer desde ESPN (rápido, con minuto real)."""
    games = []
    now = datetime.now(timezone.utc)
    # Ventana de los últimos 4 días (cubre en vivo + recién finalizados y rellena
    # goleadores). Orden viejo->nuevo para que hoy gane en el dedupe.
    dates = [now - timedelta(days=d) for d in range(3, -1, -1)]
    async with httpx.AsyncClient(timeout=15.0) as client:
        for dt in dates:
            try:
                resp = await client.get(ESPN_URL, params={"dates": dt.strftime("%Y%m%d")})
                resp.raise_for_status()
                data = resp.json()
            except Exception:
                continue
            for ev in data.get("events", []):
                try:
                    comp = ev["competitions"][0]
                    competitors = comp["competitors"]
                    h = next(c for c in competitors if c.get("homeAway") == "home")
                    a = next(c for c in competitors if c.get("homeAway") == "away")
                    state = ev["status"]["type"]["state"]
                    status = {"in": "in_progress", "post": "finished"}.get(state, "pending")
                    minute = None
                    if status == "in_progress":
                        minute = (ev["status"].get("displayClock") or "").strip() or None

                    # Goleadores (lado relativo al local/visitante de ESPN)
                    home_id = str(h["team"].get("id"))
                    events = []
                    for det in comp.get("details", []):
                        if not det.get("scoringPlay"):
                            continue
                        athletes = det.get("athletesInvolved") or []
                        events.append({
                            "side": "home" if str((det.get("team") or {}).get("id")) == home_id else "away",
                            "player": athletes[0].get("displayName") if athletes else None,
                            "minute": (det.get("clock") or {}).get("displayValue"),
                            "penalty": bool(det.get("penaltyKick")),
                            "own_goal": bool(det.get("ownGoal")),
                        })

                    games.append({
                        "home": _db_team(h["team"].get("displayName") or h["team"].get("name")),
                        "away": _db_team(a["team"].get("displayName") or a["team"].get("name")),
                        "home_score": _to_int(h.get("score")),
                        "away_score": _to_int(a.get("score")),
                        "status": status,
                        "minute": minute,
                        "group": None,
                        "events": events,
                    })
                except Exception:
                    continue
    # Dedupe por par de equipos (hoy gana sobre ayer)
    deduped = {}
    for g in games:
        deduped[frozenset((g["home"], g["away"]))] = g
    return list(deduped.values())


async def _fetch_worldcup26_games():
    """Respaldo: todos los partidos desde worldcup26.ir (lento, sin minuto real)."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(WORLDCUP_API_URL)
        resp.raise_for_status()
        data = resp.json()

    games = []
    for g in data.get("games", []):
        if g.get("finished") == "TRUE":
            status = "finished"
        elif g.get("time_elapsed") not in (None, "notstarted"):
            status = "in_progress"
        else:
            status = "pending"
        games.append({
            "home": _db_team(g.get("home_team_name_en")),
            "away": _db_team(g.get("away_team_name_en")),
            "home_score": _to_int(g.get("home_score")),
            "away_score": _to_int(g.get("away_score")),
            "status": status,
            "minute": None,  # worldcup26 no expone minuto real
            "group": g.get("group") if g.get("type") == "group" else None,
            "events": [],
        })
    return games


async def _get_games():
    """ESPN primero; si falla o no trae nada, worldcup26."""
    try:
        espn = await _fetch_espn_games()
        if espn:
            return espn, "espn"
    except Exception:
        pass
    try:
        return await _fetch_worldcup26_games(), "worldcup26"
    except Exception:
        return [], "none"


def _find_db_match(matches, game):
    """Empareja por el par de equipos; desempata por grupo o por no-finalizado."""
    pair = frozenset((game["home"], game["away"]))
    candidates = [
        m for m in matches
        if frozenset((m.get("home_team"), m.get("away_team"))) == pair
    ]
    if not candidates:
        return None
    if len(candidates) == 1:
        return candidates[0]
    if game.get("group"):
        for m in candidates:
            if m.get("group_name") == game["group"]:
                return m
    for m in candidates:
        if m.get("status") != "finished":
            return m
    return candidates[0]


async def sync_live_scores(supabase) -> dict:
    """Ejecuta una pasada de sincronización y devuelve un resumen."""
    games, source = await _get_games()

    base_cols = (
        "id,phase,group_name,matchday,home_team,away_team,"
        "status,home_goals_actual,away_goals_actual"
    )
    try:
        matches = supabase.table("matches").select(base_cols + ",events_json").execute().data or []
    except Exception:
        # La columna events_json puede no existir aún
        matches = supabase.table("matches").select(base_cols).execute().data or []

    summary = {"updated": 0, "finished_calculated": 0}
    errors = []
    unmatched = []
    flipped = []

    async def apply_update(db_match, status, home_goals, away_goals, minute, events):
        changed = (
            db_match.get("status") != status
            or db_match.get("home_goals_actual") != home_goals
            or db_match.get("away_goals_actual") != away_goals
            or status == "in_progress"  # refrescar el minuto/goles en vivo
            or (events and not db_match.get("events_json"))  # rellenar goleadores faltantes
        )
        if not changed:
            return

        payload = {
            "status": status,
            "home_goals_actual": home_goals,
            "away_goals_actual": away_goals,
            "minute": minute,
            "events_json": events,
        }
        try:
            supabase.table("matches").update(payload).eq("id", db_match["id"]).execute()
        except Exception:
            # Columnas opcionales (minute / events_json) pueden no existir aún
            payload.pop("minute", None)
            payload.pop("events_json", None)
            supabase.table("matches").update(payload).eq("id", db_match["id"]).execute()

        summary["updated"] += 1

        if status == "finished" and db_match.get("status") != "finished":
            await calculate_and_update_scores(supabase, db_match["id"])
            summary["finished_calculated"] += 1

    for game in games:
        if game["status"] == "pending":
            continue  # no tocar los que no empezaron
        try:
            db_match = _find_db_match(matches, game)
            if not db_match:
                unmatched.append(f"{game['home']} vs {game['away']}")
                continue
            events = game.get("events") or []
            # Asignar goles/goleadores según la orientación local/visitante de la BD
            if db_match.get("home_team") == game["home"]:
                home_goals, away_goals = game["home_score"], game["away_score"]
            else:
                home_goals, away_goals = game["away_score"], game["home_score"]
                flipped.append(f"{db_match.get('home_team')} vs {db_match.get('away_team')}")
                events = [
                    {**e, "side": ("away" if e.get("side") == "home" else "home")}
                    for e in events
                ]
            await apply_update(db_match, game["status"], home_goals, away_goals, game["minute"], events)
        except Exception as exc:  # noqa: BLE001
            errors.append(str(exc))

    return {
        "status": "ok",
        "source": source,
        "games": len(games),
        "updated": summary["updated"],
        "finished_calculated": summary["finished_calculated"],
        "flipped": flipped,
        "unmatched": unmatched,
        "errors": errors,
    }
