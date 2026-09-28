"""La jornada OFICIAL sale de UNAFUT, no de las fechas de ESPN.

POR QUÉ: la jornada la calculaba el sync agrupando partidos por fecha y por
equipo repetido (`_assign_stages`). Casi siempre acierta, pero un partido
pospuesto y reprogramado, o dos jornadas pegadas, la hacen fallar; y el cupo
del ×2 es POR JORNADA, así que un número mal puesto le quita o le regala un
comodín a alguien. El dueño pidió (28 sep 2026) que la jornada venga del
calendario oficial y que se le avise si no coincide.

CÓMO:
  · Cada `HORAS_ENTRE_REFRESCOS` se bajan las jornadas de UNAFUT
    (`/api/rounds/{n}`) y se guarda en cada partido su `jornada_oficial`.
  · Se empareja por el PAR ORDENADO (local, visita), sin mirar la fecha: en la
    fase regular cada par ordenado se juega una sola vez, y las fechas de las
    dos fuentes a veces difieren días (ESPN pone horarios provisorios).
  · En cada pasada el sync usa la jornada oficial en vez de la calculada, pero
    SOLO si es seguro: el partido todavía no empezó y nadie le puso un ×2.
    Mover un ×2 de jornada lo cambiaría de bolsa y podría dejar a alguien
    pasado de cupo. Lo que no es seguro no se toca: se avisa al admin.
  · Nada de esto puede tumbar el sync: cualquier fallo de UNAFUT deja la
    jornada calculada, como antes.
"""
import logging
from datetime import datetime, timedelta, timezone

from app.services.score_check import UNAFUT_BASE, _parse_fecha, _similitud, _tokens

_log = logging.getLogger(__name__)

HORAS_ENTRE_REFRESCOS = 6
UMBRAL = 0.6
# Después de la última jornada conocida se piden unas pocas más; se corta al
# encontrar dos vacías seguidas.
MAXIMO_DE_RONDAS = 60
# Las fechas de ESPN y UNAFUT difieren a veces días (horarios provisorios);
# más de esto ya no es el mismo partido, o es uno reprogramado lejos: queda sin
# jornada oficial y se usa la calculada. Sin este tope, «AD San Carlos–
# Escorpiones» (anulado, que UNAFUT no lista) se emparejaba con «Inter San
# Carlos–Escorpiones» de tres meses después: los tokens de «AD San Carlos»
# están contenidos en los de «Inter San Carlos».
DIAS_DE_TOLERANCIA = 21


async def traer_jornadas(client, slug: str, comp_id: str) -> list:
    """[{local, visita, ronda}] de todas las jornadas regulares de UNAFUT."""
    salida, vacias = [], 0
    for r in range(1, MAXIMO_DE_RONDAS + 1):
        resp = await client.get(f"{UNAFUT_BASE}/{slug}/api/rounds/{r}",
                                params={"competitionId": comp_id})
        resp.raise_for_status()
        datos = resp.json()
        partidos = datos if isinstance(datos, list) else (datos.get("matches") or [])
        if not partidos:
            vacias += 1
            if vacias >= 2:
                break
            continue
        vacias = 0
        for m in partidos:
            comps = m.get("competitors") or []
            if len(comps) < 2:
                continue
            salida.append({"local": comps[0].get("competitorName"),
                           "visita": comps[1].get("competitorName"),
                           "fecha": m.get("matchTimeUTC"),
                           "ronda": m.get("roundNumber") or r})
    return salida


def _exactitud(a: str, b: str) -> float:
    """Jaccard de tokens: desempata cuando el solapamiento da 1 para dos clubes
    («AD San Carlos» y «Inter de San Carlos» contra «Inter San Carlos»)."""
    ta, tb = _tokens(a), _tokens(b)
    return len(ta & tb) / len(ta | tb) if (ta or tb) else 0.0


def emparejar_por_equipos(nuestros: list, oficiales: list) -> dict:
    """{match_id: ronda} por par ORDENADO local/visita, uno a uno.

    Tienen que calzar los DOS equipos (el más flojo manda, igual que el
    vigilante) y la fecha estar a menos de `DIAS_DE_TOLERANCIA`. Como «San
    Carlos» calza con dos clubes, cada partido de UNAFUT se asigna a UN solo
    partido nuestro: el de mejor puntaje, después el nombre más exacto y, al
    final, la fecha más cercana. Lo que no calza queda sin jornada oficial (se usa la calculada)."""
    pares = []
    for n in nuestros:
        fn = _parse_fecha(n.get("kickoff_at"))
        for k, o in enumerate(oficiales):
            p = min(_similitud(n.get("home_team"), o["local"]),
                    _similitud(n.get("away_team"), o["visita"]))
            if p < UMBRAL:
                continue
            fo = _parse_fecha(o.get("fecha"))
            dias = abs((fo - fn).total_seconds()) / 86400 if (fn and fo) else None
            if dias is not None and dias > DIAS_DE_TOLERANCIA:
                continue
            exacto = (_exactitud(n.get("home_team"), o["local"])
                      + _exactitud(n.get("away_team"), o["visita"]))
            pares.append((-p, -exacto, dias if dias is not None else DIAS_DE_TOLERANCIA, n["id"], k))
    pares.sort()
    salida, usados = {}, set()
    for _, _, _, mid, k in pares:
        if mid in salida or k in usados:
            continue
        salida[mid] = oficiales[k]["ronda"]
        usados.add(k)
    return salida


def hay_que_refrescar(tournament: dict, ahora=None) -> bool:
    if not tournament.get("unafut_league_slug") or not tournament.get("unafut_competition_id"):
        return False
    ultimo = tournament.get("unafut_jornadas_at")
    if not ultimo:
        return True
    try:
        t = datetime.fromisoformat(str(ultimo).replace("Z", "+00:00"))
    except ValueError:
        return True
    ahora = ahora or datetime.now(timezone.utc)
    return ahora - t >= timedelta(hours=HORAS_ENTRE_REFRESCOS)


async def refrescar_jornadas_oficiales(supabase, client, tournament: dict) -> dict:
    """Guarda `matches.jornada_oficial` desde UNAFUT. Nunca lanza."""
    tid = tournament["id"]
    try:
        oficiales = await traer_jornadas(client, tournament["unafut_league_slug"],
                                         str(tournament["unafut_competition_id"]))
        nuestros = (supabase.table("matches")
                    .select("id, home_team, away_team, kickoff_at, jornada_oficial")
                    .eq("tournament_id", tid).eq("phase", "groups").execute().data or [])
        mapa = emparejar_por_equipos(nuestros, oficiales)
        cambiados = 0
        for m in nuestros:
            nueva = mapa.get(m["id"])
            if nueva is not None and nueva != m.get("jornada_oficial"):
                supabase.table("matches").update({"jornada_oficial": nueva}).eq("id", m["id"]).execute()
                cambiados += 1
        supabase.table("tournaments").update(
            {"unafut_jornadas_at": datetime.now(timezone.utc).isoformat()}).eq("id", tid).execute()
        return {"oficiales": len(oficiales), "emparejados": len(mapa),
                "sin_pareja": len(nuestros) - len(mapa), "actualizados": cambiados}
    except Exception as exc:  # noqa: BLE001 - UNAFUT nunca tumba el sync
        _log.warning("No se pudieron traer las jornadas de UNAFUT (torneo %s): %s", tid, exc)
        return {"error": f"{type(exc).__name__}: {exc}"}


def aplicar_jornada_oficial(parsed: list, snap: dict, con_x2: set) -> list:
    """Reemplaza la jornada calculada por la oficial cuando es SEGURO.

    `snap`: {external_id: fila guardada} (con id, status, matchday, jornada_oficial).
    `con_x2`: ids de partidos con algún ×2 puesto.
    Devuelve las diferencias [{match_id, partido, calculada, oficial, aplicada}].
    Si no es seguro, el partido CONSERVA la jornada que ya tenía guardada: ni la
    calculada ni la oficial, para no mover nada hasta que el admin decida.
    """
    diferencias = []
    for p in parsed:
        if p.get("matchday") is None:
            continue  # eliminatoria: no lleva jornada
        guardado = snap.get(p["external_id"]) or {}
        oficial = guardado.get("jornada_oficial")
        if oficial is None or oficial == p["matchday"]:
            continue
        seguro = (p.get("status") == "pending" and guardado.get("status", "pending") == "pending"
                  and guardado.get("id") not in con_x2)
        diferencias.append({"match_id": guardado.get("id"),
                            "partido": f"{p.get('home_team')} vs {p.get('away_team')}",
                            "calculada": p["matchday"], "oficial": oficial,
                            "aplicada": seguro})
        if seguro:
            p["matchday"] = oficial
        elif guardado.get("matchday") is not None:
            p["matchday"] = guardado["matchday"]
        p["stage"] = f"Jornada {p['matchday']}"
    return diferencias


def firma_de_diferencias(diferencias: list) -> str:
    """Para no repetir el mismo aviso: cambia solo si cambian las diferencias."""
    return "|".join(sorted(f"{d['match_id']}:{d['calculada']}>{d['oficial']}:{int(d['aplicada'])}"
                           for d in diferencias))
