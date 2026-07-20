"""
Sync GENÉRICO de partidos desde ESPN para torneos nuevos (source='espn').

Cada evento de ESPN = un partido, identificado por su id (matches.external_id).
Así el upsert crea los fixtures y actualiza marcadores/estado sin emparejar por
nombre. Trae equipos y posiciones en español (lang=es).

El Mundial (torneo #1) NO pasa por acá — tiene su propio sync (live_sync.py).
"""

from datetime import datetime, timedelta, timezone

import httpx

from app.services.scoring import calculate_and_update_scores

ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer"


def _to_int(v):
    try:
        return int(v)
    except (ValueError, TypeError):
        return None


def _parse_event(ev):
    comp = ev["competitions"][0]
    cs = comp["competitors"]
    h = next(c for c in cs if c.get("homeAway") == "home")
    a = next(c for c in cs if c.get("homeAway") == "away")
    state = ev["status"]["type"]["state"]
    status = {"in": "in_progress", "post": "finished"}.get(state, "pending")
    minute = None
    if status == "in_progress":
        minute = (ev["status"].get("displayClock") or "").strip() or None

    home_id = str(h["team"].get("id"))
    events = []
    for det in comp.get("details", []):
        if not det.get("scoringPlay"):
            continue
        ath = det.get("athletesInvolved") or []
        events.append({
            "side": "home" if str((det.get("team") or {}).get("id")) == home_id else "away",
            "player": ath[0].get("displayName") if ath else None,
            "minute": (det.get("clock") or {}).get("displayValue"),
            "type": "goal",
            "penalty": bool(det.get("penaltyKick")),
            "own_goal": bool(det.get("ownGoal")),
        })

    return {
        "external_id": str(ev.get("id")),
        "home_team": h["team"].get("displayName") or h["team"].get("name") or "?",
        "away_team": a["team"].get("displayName") or a["team"].get("name") or "?",
        "home_flag_url": h["team"].get("logo"),
        "away_flag_url": a["team"].get("logo"),
        "kickoff_at": ev.get("date"),
        "status": status,
        "home_goals": _to_int(h.get("score")),
        "away_goals": _to_int(a.get("score")),
        "minute": minute,
        "events": events,
    }


async def sync_espn_tournament(supabase, tournament) -> dict:
    """Sincroniza un torneo ESPN (fixtures + resultados) en una ventana de fechas."""
    tid = tournament["id"]
    league = (tournament.get("external_ref") or "").strip()
    if not league:
        return {"tournament_id": tid, "error": "sin external_ref"}

    now = datetime.now(timezone.utc)
    start = (now - timedelta(days=3)).strftime("%Y%m%d")
    end = (now + timedelta(days=21)).strftime("%Y%m%d")
    async with httpx.AsyncClient(timeout=25.0) as client:
        r = await client.get(
            f"{ESPN_BASE}/{league}/scoreboard",
            params={"dates": f"{start}-{end}", "lang": "es", "region": "es"},
        )
        r.raise_for_status()
        events = r.json().get("events", [])

    parsed = []
    for ev in events:
        try:
            parsed.append(_parse_event(ev))
        except Exception:  # noqa: BLE001
            continue
    if not parsed:
        return {"tournament_id": tid, "matches": 0, "scored": 0}

    # Snapshot de lo existente (para saber qué cambió y re-puntuar).
    existing = (supabase.table("matches")
                .select("id, external_id, status, home_goals_actual, away_goals_actual")
                .eq("tournament_id", tid).execute().data or [])
    snap = {m["external_id"]: m for m in existing if m.get("external_id")}

    rows = [{
        "tournament_id": tid,
        "external_id": p["external_id"],
        "home_team": p["home_team"],
        "away_team": p["away_team"],
        "home_team_code": "xx",
        "away_team_code": "xx",
        "home_flag_url": p["home_flag_url"],
        "away_flag_url": p["away_flag_url"],
        "kickoff_at": p["kickoff_at"],
        "status": p["status"],
        "home_goals_actual": p["home_goals"] if p["status"] != "pending" else None,
        "away_goals_actual": p["away_goals"] if p["status"] != "pending" else None,
        "minute": p["minute"],
        "phase": "groups",
        "events_json": p["events"],
    } for p in parsed]

    supabase.table("matches").upsert(rows, on_conflict="tournament_id,external_id").execute()

    # id por external_id (para puntuar los finalizados que cambiaron).
    idmap = {m["external_id"]: m["id"] for m in (
        supabase.table("matches").select("id, external_id").eq("tournament_id", tid).execute().data or []
    ) if m.get("external_id")}

    scored = 0
    for p in parsed:
        if p["status"] != "finished":
            continue
        old = snap.get(p["external_id"])
        changed = (
            old is None
            or old.get("status") != "finished"
            or old.get("home_goals_actual") != p["home_goals"]
            or old.get("away_goals_actual") != p["away_goals"]
        )
        mid = idmap.get(p["external_id"])
        if changed and mid:
            try:
                await calculate_and_update_scores(supabase, mid)
                scored += 1
            except Exception:  # noqa: BLE001
                pass

    return {"tournament_id": tid, "matches": len(rows), "scored": scored}


async def sync_all_espn_tournaments(supabase) -> dict:
    """Sincroniza todos los torneos ESPN activos (menos el Mundial #1)."""
    tours = (supabase.table("tournaments")
             .select("id, external_ref, source, status")
             .eq("source", "espn")
             .in_("status", ["upcoming", "active"]).execute().data or [])
    results = []
    for t in tours:
        if t["id"] == 1:
            continue  # el Mundial tiene su propio sync
        try:
            results.append(await sync_espn_tournament(supabase, t))
        except Exception as exc:  # noqa: BLE001
            results.append({"tournament_id": t["id"], "error": str(exc)})
    return {"tournaments": len(results), "results": results}
