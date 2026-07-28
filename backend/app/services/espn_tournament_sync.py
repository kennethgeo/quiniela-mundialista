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


# slug de ESPN (season.slug / type) -> etiqueta de fase en español
_STAGE_KEYS = [
    ("round-of-16", "Octavos"), ("round_of_16", "Octavos"),
    ("quarter", "Cuartos"), ("semi", "Semifinal"),
    ("third", "Tercer puesto"), ("final", "Final"),
    ("knockout", "Eliminatoria"), ("playoff", "Repechaje"),
    ("liguilla", "Liguilla"), ("group", "Fase de grupos"),
    ("league-phase", "Fase de liga"), ("league_phase", "Fase de liga"),
]


def _stage_from_event(ev):
    """(stage_base, leg). stage_base es la fase (o None si es liga regular)."""
    slug = ((ev.get("season") or {}).get("slug") or "").lower()
    leg = ""
    for n in (ev["competitions"][0].get("notes") or []):
        t = (n.get("text") or "").strip()
        if t:
            leg = t
            break
    base = None
    for key, lbl in _STAGE_KEYS:
        if key in slug:
            base = lbl
            break
    return base, leg


def _parse_event(ev):
    comp = ev["competitions"][0]
    cs = comp["competitors"]
    h = next(c for c in cs if c.get("homeAway") == "home")
    a = next(c for c in cs if c.get("homeAway") == "away")
    stage_base, leg = _stage_from_event(ev)
    st = (ev.get("status") or {}).get("type") or {}
    _name = (st.get("name") or "").upper()
    if any(k in _name for k in ("CANCEL", "POSTPON", "ABANDON", "SUSPEND", "FORFEIT")):
        status = "cancelled"
    else:
        status = {"in": "in_progress", "post": "finished"}.get(st.get("state"), "pending")
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
        "stage_base": stage_base,   # None = liga regular
        "leg": leg,                 # "Ida"/"Vuelta"/"" (dos partidos)
    }


def _assign_stages(parsed):
    """Calcula stage + matchday: por fase real, o 'Jornada N' en liga regular
    (agrupando por fin de semana, ya que ESPN no expone el número de jornada)."""
    # Liga regular (sin fase): ordenar por fecha y agrupar en rondas semanales.
    regular = sorted((p for p in parsed if not p["stage_base"]), key=lambda p: p["kickoff_at"] or "")
    from datetime import datetime as _dt
    md = 0
    cluster_start = None
    for p in regular:
        try:
            d = _dt.fromisoformat((p["kickoff_at"] or "").replace("Z", "+00:00"))
        except Exception:  # noqa: BLE001
            d = None
        if cluster_start is None or (d and (d - cluster_start).days > 4):
            md += 1
            cluster_start = d
        p["matchday"] = md
        p["stage"] = f"Jornada {md}"
    # Fases (copas): la etiqueta ya es la fase (+ leg).
    for p in parsed:
        if p["stage_base"]:
            p["stage"] = " · ".join(x for x in (p["stage_base"], p["leg"]) if x)
            p["matchday"] = None
    return parsed


def _date_ranges(now, full):
    """Ventanas de fechas a consultar. full=True → toda la temporada (por trozos);
    full=False → ventana móvil (reciente + próximas 3 semanas)."""
    if not full:
        return [((now - timedelta(days=3)), (now + timedelta(days=21)))]
    # Temporada completa: de ~10 meses atrás a ~5 adelante, en trozos de 30 días.
    # (Fallback si ESPN no expone los límites de la temporada actual.)
    return _chunks(now - timedelta(days=300), now + timedelta(days=150))


def _chunks(lo, hi):
    """Divide [lo, hi] en ventanas de 30 días para consultar el scoreboard."""
    out, cur = [], lo
    while cur < hi:
        nxt = min(cur + timedelta(days=30), hi)
        out.append((cur, nxt))
        cur = nxt + timedelta(days=1)
    return out


def _parse_iso(s):
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")) if s else None
    except Exception:  # noqa: BLE001
        return None


async def _season_window(client, league, now):
    """Ventana [inicio, fin] de la temporada ACTUAL de ESPN (para no arrastrar
    torneos anteriores, p. ej. la Clausura pasada en ligas de dos semestres).
    Devuelve None si ESPN no lo expone."""
    try:
        r = await client.get(f"{ESPN_BASE}/{league}/scoreboard", params={"lang": "es", "region": "es"})
        r.raise_for_status()
        lg = (r.json().get("leagues") or [{}])[0]
        se = lg.get("season") or {}
        cal = [c for c in (lg.get("calendar") or []) if isinstance(c, str)]
        start = _parse_iso(se.get("startDate")) or (_parse_iso(min(cal)) if cal else None)
        if not start:
            return None
        end = _parse_iso(se.get("endDate"))
        if cal:  # el calendario acota mejor el segmento actual (Apertura/Clausura)
            cmax = _parse_iso(max(cal))
            if cmax:
                end = min(end, cmax + timedelta(days=10)) if end else cmax + timedelta(days=10)
        end = min(end or (now + timedelta(days=150)), now + timedelta(days=150))
        if end <= start:
            end = start + timedelta(days=30)
        return (start, end)
    except Exception:  # noqa: BLE001
        return None


async def sync_espn_tournament(supabase, tournament, full=False) -> dict:
    """Sincroniza un torneo ESPN (fixtures + resultados).

    full=False (cron): ventana móvil. full=True (botón admin): toda la temporada."""
    tid = tournament["id"]
    league = (tournament.get("external_ref") or "").strip()
    if not league:
        return {"tournament_id": tid, "error": "sin external_ref"}

    now = datetime.now(timezone.utc)
    events_by_id = {}
    season_start = None
    async with httpx.AsyncClient(timeout=25.0) as client:
        if full:
            win = await _season_window(client, league, now)
            if win:
                season_start, ranges = win[0], _chunks(win[0], win[1])
            else:
                ranges = _date_ranges(now, True)
        else:
            ranges = _date_ranges(now, False)
        for (s, e) in ranges:
            try:
                r = await client.get(
                    f"{ESPN_BASE}/{league}/scoreboard",
                    params={"dates": f"{s.strftime('%Y%m%d')}-{e.strftime('%Y%m%d')}", "lang": "es", "region": "es"},
                )
                r.raise_for_status()
                for ev in r.json().get("events", []):
                    events_by_id[str(ev.get("id"))] = ev  # dedupe por id
            except Exception:  # noqa: BLE001
                continue

    parsed = []
    for ev in events_by_id.values():
        try:
            parsed.append(_parse_event(ev))
        except Exception:  # noqa: BLE001
            continue
    if not parsed:
        return {"tournament_id": tid, "matches": 0, "scored": 0}

    _assign_stages(parsed)

    # Snapshot de lo existente (para saber qué cambió y re-puntuar). score_locked
    # es una columna nueva; si la migración que la crea todavía no corrió, cae a
    # la versión anterior en vez de romper el sync de este torneo.
    try:
        existing = (supabase.table("matches")
                    .select("id, external_id, status, home_goals_actual, away_goals_actual, score_locked")
                    .eq("tournament_id", tid).execute().data or [])
    except Exception:  # noqa: BLE001
        existing = (supabase.table("matches")
                    .select("id, external_id, status, home_goals_actual, away_goals_actual")
                    .eq("tournament_id", tid).execute().data or [])
    snap = {m["external_id"]: m for m in existing if m.get("external_id")}
    # Partidos que un admin marcó a mano como no disputados (suspendido/pospuesto/
    # cancelado sin que ESPN lo refleje, p. ej. un walkover que ESPN sigue mostrando
    # como jugado), o cuyo marcador se corrigió a mano por un fallo oficial que la
    # fuente no refleja (score_locked). El sync automático NO debe pisarlos.
    frozen_ids = {eid for eid, m in snap.items()
                  if m.get("status") in ("cancelled", "postponed") or m.get("score_locked")}

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
        "matchday": p.get("matchday"),
        # La postemporada de una liga (semis/final/liguilla) puntúa como
        # ELIMINATORIA (reglas de penales), igual que la fase final de una copa.
        # La fase regular queda como 'groups' (marcador exacto / resultado).
        "phase": "knockout" if p.get("stage_base") else "groups",
        "stage": p.get("stage"),
        "events_json": p["events"],
    } for p in parsed if p["external_id"] not in frozen_ids]

    if rows:
        supabase.table("matches").upsert(rows, on_conflict="tournament_id,external_id").execute()
        # Fixtures nuevos pueden resolver créditos de arrastre que quedaron
        # "pendientes" (se cancelaron antes de que existiera la próxima jornada).
        try:
            supabase.rpc("resolve_pending_powerup_credits", {"p_tournament_id": tid}).execute()
        except Exception:  # noqa: BLE001
            pass

    # id por external_id (para puntuar los finalizados que cambiaron).
    idmap = {m["external_id"]: m["id"] for m in (
        supabase.table("matches").select("id, external_id").eq("tournament_id", tid).execute().data or []
    ) if m.get("external_id")}

    scored = 0
    for p in parsed:
        if p["external_id"] in frozen_ids:
            continue  # no disputado (marcado a mano); no se re-puntúa desde ESPN
        mid = idmap.get(p["external_id"])
        if not mid:
            continue
        old = snap.get(p["external_id"])
        st = p["status"]
        if st == "finished":
            changed = (
                old is None
                or old.get("status") != "finished"
                or old.get("home_goals_actual") != p["home_goals"]
                or old.get("away_goals_actual") != p["away_goals"]
            )
        elif st == "cancelled":
            # Transición a cancelado → anular puntos del partido (idempotente).
            changed = old is None or old.get("status") != "cancelled"
        else:
            continue
        if changed:
            try:
                await calculate_and_update_scores(supabase, mid)
                scored += 1
            except Exception:  # noqa: BLE001
                pass

    # Recalcular medallas de las quinielas de este torneo si hubo puntaje nuevo.
    if scored:
        for lg in (supabase.table("leagues").select("id").eq("tournament_id", tid).execute().data or []):
            try:
                supabase.rpc("recompute_league_badges", {"p_league_id": lg["id"]}).execute()
            except Exception:  # noqa: BLE001
                pass

    # Limpieza: si acotamos a la temporada actual, quitar los partidos de
    # temporadas anteriores que hubieran quedado cargados (p. ej. la Clausura pasada).
    removed = 0
    if full and season_start is not None:
        try:
            cutoff = season_start.isoformat()
            old = (supabase.table("matches").select("id")
                   .eq("tournament_id", tid).lt("kickoff_at", cutoff).execute().data or [])
            old_ids = [m["id"] for m in old]
            if old_ids:
                supabase.table("predictions").delete().in_("match_id", old_ids).execute()
                supabase.table("matches").delete().in_("id", old_ids).execute()
                removed = len(old_ids)
        except Exception:  # noqa: BLE001
            pass

    return {"tournament_id": tid, "matches": len(rows), "scored": scored, "removed_old": removed}


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
