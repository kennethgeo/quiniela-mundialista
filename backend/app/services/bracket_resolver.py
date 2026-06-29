"""Resuelve los equipos de eliminatoria y los persiste en la BD.

El live-sync empareja los partidos de ESPN con la BD POR NOMBRE de equipo. Pero
los partidos de eliminatoria se guardan con códigos de slot ("2A", "3C/E/F/H/I",
"W74", ...), así que nunca cuadran y no se actualizan ni puntúan.

Este módulo replica la lógica del resolver del frontend (bracketResolver.js):
calcula las posiciones de grupo, los mejores terceros (con la asignación oficial
de FIFA 2026) y los ganadores/perdedores de llaves ya jugadas, y ESCRIBE los
nombres+códigos reales en los partidos de eliminatoria cuyos equipos ya están
definidos. Es idempotente: solo toca filas que siguen con un código de slot.
"""

import re

# Asignación oficial FIFA 2026 de terceros por slot (grupos clasificados como
# mejores terceros: B, D, E, F, I, J, K, L). Igual que en el frontend.
FIFA_2026_THIRD_SLOT_GROUP = {
    "3A/B/C/D/F": "D",
    "3C/D/F/G/H": "F",
    "3C/E/F/H/I": "E",
    "3E/H/I/J/K": "K",
    "3B/E/F/I/J": "B",
    "3A/E/H/I/J": "I",
    "3E/F/G/I/J": "J",
    "3D/E/I/J/L": "L",
}
FIFA_2026_THIRD_GROUPS = ["B", "D", "E", "F", "I", "J", "K", "L"]

_GROUP_RE = re.compile(r"^([12])([A-L])$")
_THIRD_RE = re.compile(r"^3[A-L].*/")
_WL_RE = re.compile(r"^([WL])(\d+)$")
_CODE_RE = re.compile(r"^[123WL]")  # cualquier código de slot sin resolver


def _match_thirds_bipartite(thirds, slot_codes):
    """Emparejamiento 1-a-1 (Kuhn) de terceros a slots por grupos candidatos."""
    slots = [{"code": c, "groups": set(re.findall(r"[A-L]", c))} for c in slot_codes]
    slot_match = [-1] * len(slots)

    def try_assign(ti, visited):
        for s in range(len(slots)):
            if not visited[s] and thirds[ti]["group"] in slots[s]["groups"]:
                visited[s] = True
                if slot_match[s] == -1 or try_assign(slot_match[s], visited):
                    slot_match[s] = ti
                    return True
        return False

    for t in range(len(thirds)):
        try_assign(t, [False] * len(slots))

    out = {}
    for s, sl in enumerate(slots):
        if slot_match[s] != -1:
            out[sl["code"]] = thirds[slot_match[s]]
    return out


def resolve_knockout(matches):
    """Devuelve {match_id: {home_team, home_team_code, away_team, away_team_code}}
    para los partidos de eliminatoria cuyos equipos ya se pueden determinar."""
    groups = [m for m in matches if m.get("phase") == "groups"]
    knockouts = [m for m in matches if m.get("phase") != "groups"]

    # 1) Tabla de cada grupo
    standings = {}

    def init_team(g, name, code):
        standings.setdefault(g, {})
        if name not in standings[g]:
            standings[g][name] = {"name": name, "code": code, "pts": 0, "gd": 0, "gf": 0, "pld": 0}

    for m in groups:
        g = m.get("group_name")
        if not g:
            continue
        init_team(g, m["home_team"], m.get("home_team_code"))
        init_team(g, m["away_team"], m.get("away_team_code"))
        if m.get("status") == "finished" and m.get("home_goals_actual") is not None and m.get("away_goals_actual") is not None:
            h = standings[g][m["home_team"]]
            a = standings[g][m["away_team"]]
            hg, ag = m["home_goals_actual"], m["away_goals_actual"]
            h["pld"] += 1
            a["pld"] += 1
            h["gf"] += hg
            a["gf"] += ag
            h["gd"] += hg - ag
            a["gd"] += ag - hg
            if hg > ag:
                h["pts"] += 3
            elif hg < ag:
                a["pts"] += 3
            else:
                h["pts"] += 1
                a["pts"] += 1

    sorted_groups = {}
    all_thirds = []
    for g, teams_map in standings.items():
        teams = sorted(teams_map.values(), key=lambda t: (-t["pts"], -t["gd"], -t["gf"], t["name"]))
        sorted_groups[g] = teams
        if len(teams) >= 3 and teams[2]["pld"] > 0:
            third = dict(teams[2])
            third["group"] = g
            all_thirds.append(third)

    num_groups = len(sorted_groups)
    group_complete = num_groups >= 12 and all(
        len(t) >= 4 and all(x["pld"] >= 3 for x in t) for t in sorted_groups.values()
    )
    all_thirds.sort(key=lambda t: (-t["pts"], -t["gd"], -t["gf"], t["name"]))
    best_thirds = all_thirds[:8]

    # 2) Slots de tercero presentes y su asignación
    slot_codes = set()
    for m in knockouts:
        for c in (m.get("home_team"), m.get("away_team")):
            if isinstance(c, str) and c.startswith("3") and "/" in c:
                slot_codes.add(c)

    third_by_slot = {}
    if group_complete and len(best_thirds) == 8:
        third_by_group = {t["group"]: t for t in best_thirds}
        qualifying = {t["group"] for t in best_thirds}
        if all(g in qualifying for g in FIFA_2026_THIRD_GROUPS):
            for code, grp in FIFA_2026_THIRD_SLOT_GROUP.items():
                if grp in third_by_group:
                    third_by_slot[code] = third_by_group[grp]
        else:
            third_by_slot = _match_thirds_bipartite(best_thirds, list(slot_codes))

    # 3) Ganadores/perdedores de llaves ya jugadas
    match_results = {}
    for m in knockouts:
        if m.get("status") == "finished" and m.get("home_goals_actual") is not None:
            if m.get("goes_to_penalties") and m.get("penalties_winner_real"):
                home_wins = m["penalties_winner_real"] == m["home_team"]
            else:
                home_wins = m["home_goals_actual"] > m["away_goals_actual"]
            win = ("home_team", "home_team_code") if home_wins else ("away_team", "away_team_code")
            los = ("away_team", "away_team_code") if home_wins else ("home_team", "home_team_code")
            match_results["W%s" % m["id"]] = (m.get(win[0]), m.get(win[1]))
            match_results["L%s" % m["id"]] = (m.get(los[0]), m.get(los[1]))

    def resolve_code(code):
        """Devuelve (name, code) si se puede resolver, o None."""
        if not code:
            return None
        gm = _GROUP_RE.match(code)
        if gm:
            pos = int(gm.group(1)) - 1
            g = gm.group(2)
            teams = sorted_groups.get(g)
            if teams and len(teams) > pos and teams[pos]["pld"] >= 3:
                t = teams[pos]
                return (t["name"], t["code"])
            return None
        if code.startswith("3") and "/" in code:
            t = third_by_slot.get(code)
            if t:
                return (t["name"], t["code"])
            return None
        if code.startswith("W") or code.startswith("L"):
            return match_results.get(code)
        return None

    resolved = {}
    for m in knockouts:
        h = resolve_code(m.get("home_team"))
        a = resolve_code(m.get("away_team"))
        entry = {}
        if h:
            entry["home_team"], entry["home_team_code"] = h
        if a:
            entry["away_team"], entry["away_team_code"] = a
        if entry:
            resolved[m["id"]] = entry
    return resolved


def persist_resolved_knockouts(supabase):
    """Escribe los nombres reales en los partidos de eliminatoria que siguen con
    código de slot. Idempotente. Devuelve cuántas filas actualizó."""
    cols = (
        "id,phase,group_name,home_team,away_team,home_team_code,away_team_code,"
        "status,home_goals_actual,away_goals_actual,goes_to_penalties,penalties_winner_real"
    )
    try:
        matches = supabase.table("matches").select(cols).execute().data or []
    except Exception:
        # goes_to_penalties / penalties_winner_real podrían no existir
        cols2 = "id,phase,group_name,home_team,away_team,home_team_code,away_team_code,status,home_goals_actual,away_goals_actual"
        matches = supabase.table("matches").select(cols2).execute().data or []

    resolved = resolve_knockout(matches)
    by_id = {m["id"]: m for m in matches}
    updated = 0

    for mid, entry in resolved.items():
        m = by_id.get(mid)
        if not m:
            continue
        payload = {}
        # Solo escribir si el valor guardado sigue siendo un código de slot.
        if "home_team" in entry and _CODE_RE.match(str(m.get("home_team") or "")):
            payload["home_team"] = entry["home_team"]
            if entry.get("home_team_code"):
                payload["home_team_code"] = entry["home_team_code"]
        if "away_team" in entry and _CODE_RE.match(str(m.get("away_team") or "")):
            payload["away_team"] = entry["away_team"]
            if entry.get("away_team_code"):
                payload["away_team_code"] = entry["away_team_code"]
        if payload:
            try:
                supabase.table("matches").update(payload).eq("id", mid).execute()
                updated += 1
            except Exception:
                pass
    return updated
