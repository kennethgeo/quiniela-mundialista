"""Resumen de los partidos del día: el texto y a quién le toca.

Se separa del endpoint para poder probarlo sin base de datos ni push de por
medio. Lo que se puede equivocar en silencio acá es a quién se le manda y qué
dice, no la cañería.
"""

from datetime import datetime, timedelta, timezone

# Costa Rica es UTC-6 todo el año: no hay horario de verano, así que no hace
# falta una librería de zonas ni preocuparse por el cambio de hora.
UTC_CR = timezone(timedelta(hours=-6))


def ventana_del_dia(ahora_utc: datetime) -> tuple[datetime, datetime]:
    """El día natural de Costa Rica que contiene a `ahora_utc`.

    Sin esto, "los partidos de hoy" a las 6am usaría el día UTC, que a esa hora
    ya cambió: un partido de las 8pm de ayer en Costa Rica aparecería como de
    hoy.
    """
    local = ahora_utc.astimezone(UTC_CR)
    inicio_local = local.replace(hour=0, minute=0, second=0, microsecond=0)
    return inicio_local.astimezone(timezone.utc), (inicio_local + timedelta(days=1)).astimezone(timezone.utc)


def _hora_cr(kickoff: str) -> str:
    """'20:00' en hora de Costa Rica. El sync a veces guarda la fecha sin sufijo
    de zona, así que se asume UTC cuando falta — igual que hace el frontend."""
    texto = kickoff if (kickoff.endswith("Z") or "+" in kickoff[10:]) else f"{kickoff}Z"
    dt = datetime.fromisoformat(texto.replace("Z", "+00:00"))
    return dt.astimezone(UTC_CR).strftime("%H:%M")


def armar_mensajes(partidos, membresias, predicciones):
    """Qué push le toca a cada persona.

    partidos:    [{id, tournament_id, home_team, away_team, kickoff_at}]
    membresias:  [{league_id, user_id, tournament_id}]
    predicciones: [{user_id, league_id, match_id}]

    Devuelve {user_id: {"title", "body", "url"}}.

    Se avisa a TODO el que juegue una quiniela de ese torneo, haya predicho o
    no: esto es "hoy se juega", no un recordatorio. Pero el texto distingue,
    porque un aviso que ignora que ya hiciste la tarea es el que se termina
    silenciando.
    """
    if not partidos:
        return {}

    por_torneo = {}
    for p in partidos:
        por_torneo.setdefault(p["tournament_id"], []).append(p)
    for lista in por_torneo.values():
        lista.sort(key=lambda p: p["kickoff_at"])

    ya_predijo = {(x["league_id"], x["match_id"], x["user_id"]) for x in predicciones}

    # user_id -> set(match_id) pendientes. Se cuenta por PAR (quiniela, partido):
    # estar en dos quinielas del mismo torneo y haber predicho solo en una deja
    # el partido pendiente igual.
    pendientes = {}
    involucrados = {}
    for m in membresias:
        del_torneo = por_torneo.get(m["tournament_id"])
        if not del_torneo:
            continue
        involucrados.setdefault(m["user_id"], set()).update(p["id"] for p in del_torneo)
        for p in del_torneo:
            if (m["league_id"], p["id"], m["user_id"]) not in ya_predijo:
                pendientes.setdefault(m["user_id"], set()).add(p["id"])

    mensajes = {}
    for user_id, ids in involucrados.items():
        # Los partidos de hoy de los torneos donde esta persona juega.
        suyos = sorted(
            (p for lista in por_torneo.values() for p in lista if p["id"] in ids),
            key=lambda p: p["kickoff_at"],
        )
        if not suyos:
            continue
        n = len(suyos)
        faltan = len(pendientes.get(user_id, ()))
        primero = suyos[0]

        cabeza = "⚽ Hoy hay 1 partido" if n == 1 else f"⚽ Hoy hay {n} partidos"
        detalle = f"{_hora_cr(primero['kickoff_at'])} {primero['home_team']} vs {primero['away_team']}"
        if n > 1:
            detalle += f" · y {n - 1} más"

        if faltan == 0:
            cola = "Ya predijiste todo 👌"
        elif faltan == 1:
            cola = "Te falta 1 por predecir"
        else:
            cola = f"Te faltan {faltan} por predecir"

        mensajes[user_id] = {
            "title": f"{cabeza} · {cola}",
            "body": detalle,
            "url": "/",
        }

    return mensajes
