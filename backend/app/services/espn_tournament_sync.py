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


# Fases que NO son eliminatoria: se juegan como una liga, con jornadas y sin
# penales. Acá cae la FASE DE LIGA de la Champions — ESPN manda
# season.slug = 'league-phase' en sus 100 partidos — y cualquier fase de grupos.
#
# Distinguirlas importa por tres cosas: sin esto quedan con matchday NULL (o
# sea, sin jornada, y el cupo de comodines ×2 es por fase+jornada, así que
# darían UN comodín para toda la fase), y además live_sync marca como
# "definido por penales" cualquier empate cuyo phase != 'groups'.
_FASES_REGULARES = {"Fase de grupos", "Fase de liga"}


def _es_eliminatoria(stage_base):
    """True solo para fases a partido único/eliminación (octavos, semis, final…)."""
    return bool(stage_base) and stage_base not in _FASES_REGULARES


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
    # Solo estos son finales: el partido NO se va a jugar.
    if any(k in _name for k in ("CANCEL", "POSTPON", "FORFEIT")):
        status = "cancelled"
    elif any(k in _name for k in ("SUSPEND", "ABANDON")):
        # Una suspensión (lluvia, neblina) es TRANSITORIA: casi siempre se
        # reanuda y termina. Marcarla como 'cancelled' disparaba
        # void_cancelled_match, que anula puntos y comodines — y eso después no
        # se deshace solo. Se deja 'in_progress' y no se destruye nada: cuando
        # ESPN confirme el final, el partido se cierra y puntúa normalmente.
        # Si de verdad quedó abandonado, lo marca el admin desde el panel.
        status = "in_progress"
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
        # Nombre del estadio. Se guarda para poder ponerle la foto de fondo a la
        # tarjeta que se manda al grupo (frontend/src/lib/estadios.js). ESPN da
        # el nombre, nunca una foto, y a veces no lo trae: entonces queda None y
        # la tarjeta se dibuja con el fondo de siempre.
        "venue": ((comp.get("venue") or {}).get("fullName")) or None,
        "kickoff_at": ev.get("date"),
        "status": status,
        "home_goals": _to_int(h.get("score")),
        "away_goals": _to_int(a.get("score")),
        "minute": minute,
        "events": events,
        "stage_base": stage_base,   # None = liga regular
        "leg": leg,                 # "Ida"/"Vuelta"/"" (dos partidos)
    }


def _assign_stages(parsed, history=None):
    """Calcula stage + matchday: por fase real, o 'Jornada N' en liga regular
    (agrupando por fecha, ya que ESPN no expone el número de jornada).

    `history` (opcional): partidos de liga regular YA guardados en la BD, fuera
    de la ventana móvil de este sync (id externo + kickoff_at). El cron corre
    con una ventana móvil (± unas semanas), así que si solo agrupáramos lo
    recién traído, cada corrida numeraría desde 1 sobre un subconjunto distinto
    y la jornada de un mismo partido podría cambiar de una corrida a otra. Al
    incluir el historial como contexto de fechas (sin reescribirlo) la
    numeración queda estable entre corridas."""
    from datetime import datetime as _dt

    def _parse(dt_str):
        try:
            return _dt.fromisoformat((dt_str or "").replace("Z", "+00:00"))
        except Exception:  # noqa: BLE001
            return None

    new_regular = [p for p in parsed if not _es_eliminatoria(p["stage_base"])]
    new_ids = {p["external_id"] for p in new_regular}
    hist_entries = [
        {"external_id": h["external_id"], "kickoff_at": h["kickoff_at"]}
        for h in (history or [])
        if h.get("kickoff_at") and h.get("external_id") not in new_ids
    ]
    combined = sorted(
        [{"external_id": p["external_id"], "kickoff_at": p["kickoff_at"]} for p in new_regular] + hist_entries,
        key=lambda x: x["kickoff_at"] or "",
    )

    # Umbral de separación entre jornadas: una jornada real puede repartirse
    # entre viernes y lunes (hasta ~28h de hueco interno visto en producción,
    # por husos horarios), mientras que el salto a la siguiente jornada es de
    # varios días (mínimo ~72h visto en producción). 48h queda cómodo en el
    # medio. Se compara SIEMPRE contra el partido anterior (no contra el
    # primero de la jornada) para no perder el hueco si la jornada se estira.
    GAP_THRESHOLD_HOURS = 48
    md_by_id = {}
    md = 0
    prev_date = None
    for e in combined:
        d = _parse(e["kickoff_at"])
        if prev_date is None or (d and (d - prev_date).total_seconds() > GAP_THRESHOLD_HOURS * 3600):
            md += 1
        if d:
            prev_date = d
        md_by_id[e["external_id"]] = md

    for p in parsed:
        if _es_eliminatoria(p["stage_base"]):
            p["stage"] = " · ".join(x for x in (p["stage_base"], p["leg"]) if x)
            p["matchday"] = None
        else:
            # Fase regular, de grupos o de liga: lleva jornada. La numeración
            # sale del hueco entre fechas, que en la fase de liga de la
            # Champions es de semanas entre jornadas y de un día dentro de una.
            p["matchday"] = md_by_id.get(p["external_id"])
            p["stage"] = f"Jornada {p['matchday']}"
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

    # Snapshot de lo existente (para saber qué cambió y re-puntuar, y como
    # contexto de fechas para que la numeración de jornada no cambie entre
    # corridas parciales — ver _assign_stages). score_locked es una columna
    # nueva; si la migración que la crea todavía no corrió, cae a la versión
    # anterior en vez de romper el sync de este torneo.
    try:
        existing = (supabase.table("matches")
                    .select("id, external_id, status, home_goals_actual, away_goals_actual, "
                            "score_locked, kickoff_at, phase")
                    .eq("tournament_id", tid).execute().data or [])
    except Exception:  # noqa: BLE001
        existing = (supabase.table("matches")
                    .select("id, external_id, status, home_goals_actual, away_goals_actual, "
                            "kickoff_at, phase")
                    .eq("tournament_id", tid).execute().data or [])
    snap = {m["external_id"]: m for m in existing if m.get("external_id")}

    history = [m for m in existing if m.get("phase") == "groups"]
    _assign_stages(parsed, history)
    # Lo que el admin fijó a mano manda sobre la fuente: un walkover que ESPN
    # sigue mostrando como jugado, o un marcador cambiado por un fallo oficial
    # (alineación indebida) que ESPN nunca va a reflejar.
    #
    # ANTES esto también congelaba por status ('cancelled'/'postponed'), y ahí
    # estaba el bug: un partido suspendido por clima quedaba cancelado para
    # siempre, porque el sync no lo volvía a mirar ni cuando ESPN reportaba que
    # había terminado. Ahora el congelado depende SOLO de score_locked, o sea de
    # una decisión explícita del admin; lo que el sync dedujo puede corregirse
    # solo. Por eso el panel de admin activa score_locked al marcar un partido
    # como no disputado (y la migración 56 blindó los que ya estaban cancelados).
    frozen_ids = {eid for eid, m in snap.items() if m.get("score_locked")}

    rows = [{
        "tournament_id": tid,
        "external_id": p["external_id"],
        "home_team": p["home_team"],
        "away_team": p["away_team"],
        "home_team_code": "xx",
        "away_team_code": "xx",
        "home_flag_url": p["home_flag_url"],
        "away_flag_url": p["away_flag_url"],
        "venue": p.get("venue"),
        "kickoff_at": p["kickoff_at"],
        "status": p["status"],
        "home_goals_actual": p["home_goals"] if p["status"] != "pending" else None,
        "away_goals_actual": p["away_goals"] if p["status"] != "pending" else None,
        "minute": p["minute"],
        "matchday": p.get("matchday"),
        # La postemporada de una liga (semis/final/liguilla) puntúa como
        # ELIMINATORIA (reglas de penales), igual que la fase final de una copa.
        # La fase regular queda como 'groups' (marcador exacto / resultado).
        "phase": "knockout" if _es_eliminatoria(p.get("stage_base")) else "groups",
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
    """Sincroniza los torneos ESPN que ALGUIEN ESTÁ JUGANDO (menos el Mundial #1).

    Un torneo puede estar activo en la tabla pero no tener ninguna quiniela: así
    quedaron LaLiga, Premier y Champions, que el cron sincronizaba cada ~5 min
    contra ESPN para nada — gastando llamadas y llenando la tabla de partidos que
    nadie mira. Como una quiniela no tiene estado propio (su vigencia sale del
    estado del torneo, que ya se filtra arriba), alcanza con exigir que el torneo
    tenga al menos una quiniela.

    OJO: este filtro es SOLO del cron. El botón "Sincronizar" del panel de admin
    (POST /admin/sync-espn) sigue funcionando para cualquier torneo, porque hace
    falta poder cargar los partidos ANTES de crear la quiniela — si no, no habría
    forma de arrancar un torneo nuevo.
    """
    tours = (supabase.table("tournaments")
             .select("id, external_ref, source, status")
             .eq("source", "espn")
             .in_("status", ["upcoming", "active"]).execute().data or [])

    ligas = supabase.table("leagues").select("tournament_id").execute().data or []
    en_uso = {l["tournament_id"] for l in ligas if l.get("tournament_id") is not None}

    results, omitidos = [], []
    for t in tours:
        if t["id"] == 1:
            continue  # el Mundial tiene su propio sync
        if t["id"] not in en_uso:
            omitidos.append(t["id"])
            continue
        try:
            results.append(await sync_espn_tournament(supabase, t))
        except Exception as exc:  # noqa: BLE001
            results.append({"tournament_id": t["id"], "error": str(exc)})
    return {"tournaments": len(results), "results": results, "sin_quiniela": omitidos}
