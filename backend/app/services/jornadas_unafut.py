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
    pasado de cupo. Lo que no es seguro CONSERVA la jornada guardada, la
    digan como la digan las dos fuentes, y se avisa al admin.
  · El mismo refresco compara el saque de UNAFUT con el nuestro (ESPN) y
    avisa si el nuestro es más tarde: de él cuelgan el cierre y el destape.
  · Nada de esto puede tumbar el sync: cualquier fallo de UNAFUT deja la
    jornada calculada, como antes.
"""
import asyncio
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
# Rondas que se piden juntas y cuántas peticiones abiertas a la vez como mucho
# (ver traer_jornadas). Con las 18 jornadas de la liga tica son dos tandas.
RONDAS_POR_TANDA = 10
PETICIONES_A_LA_VEZ = 5
# Tope TOTAL del refresco dentro de /sync-live (lo aplica el sync con
# asyncio.wait_for): si UNAFUT tarda más, se sigue sin él, con la jornada que
# ya estaba. pg_net corta la respuesta a los 20 s.
SEGUNDOS_PARA_REFRESCAR = 8
# Un saque nuestro (ESPN) más TARDE que el de UNAFUT por más de esto se avisa:
# el cierre de predicciones y el destape (T-15) cuelgan de nuestro horario, así
# que si el nuestro está atrasado las predicciones seguirían abiertas con el
# partido ya empezado. Más temprano no se avisa: cierra antes, no después.
MINUTOS_DE_ATRASO_PARA_AVISAR = 15


async def _traer_ronda(client, sem, slug: str, comp_id: str, r: int) -> list:
    async with sem:
        resp = await client.get(f"{UNAFUT_BASE}/{slug}/api/rounds/{r}",
                                params={"competitionId": comp_id})
    resp.raise_for_status()
    datos = resp.json()
    return datos if isinstance(datos, list) else (datos.get("matches") or [])


async def traer_jornadas(client, slug: str, comp_id: str) -> list:
    """[{local, visita, fecha, ronda}] de todas las jornadas regulares de UNAFUT.

    Se piden EN PARALELO (de a `RONDAS_POR_TANDA`, con `PETICIONES_A_LA_VEZ`
    abiertas como mucho). En serie eran ~20 peticiones de 0,75-1,3 s dentro de
    /sync-live: medido el 10 oct, la pasada subió de ~5 s a ~25 s y pg_net, que
    corta a los 20 s, perdió la respuesta. Se sigue cortando en la PRIMERA
    pareja de rondas vacías seguidas, en orden: lo que venga después en la
    misma tanda se descarta, igual que antes no se habría pedido.
    """
    sem = asyncio.Semaphore(PETICIONES_A_LA_VEZ)
    salida, vacias = [], 0
    for desde in range(1, MAXIMO_DE_RONDAS + 1, RONDAS_POR_TANDA):
        rondas = list(range(desde, min(desde + RONDAS_POR_TANDA, MAXIMO_DE_RONDAS + 1)))
        respuestas = await asyncio.gather(
            *(_traer_ronda(client, sem, slug, comp_id, r) for r in rondas), return_exceptions=True)
        for r, partidos in zip(rondas, respuestas):
            if isinstance(partidos, BaseException):
                raise partidos
            if not partidos:
                vacias += 1
                if vacias >= 2:
                    return salida
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


def _emparejar(nuestros: list, oficiales: list) -> dict:
    """{match_id: índice en `oficiales`} por par ORDENADO local/visita, uno a uno.

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
        salida[mid] = k
        usados.add(k)
    return salida


def emparejar_por_equipos(nuestros: list, oficiales: list) -> dict:
    """{match_id: ronda} (ver _emparejar)."""
    return {mid: oficiales[k]["ronda"] for mid, k in _emparejar(nuestros, oficiales).items()}


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


def saques_atrasados(nuestros: list, oficiales: list, indices: dict) -> list:
    """Partidos PENDIENTES cuyo saque nuestro es más tarde que el de UNAFUT.

    Solo avisa, no corrige `kickoff_at`: no está comprobado cuál de las dos
    fuentes acierta (medido el 11 oct: 20 de 41 pendientes difieren, en 9 la
    nuestra es más tarde; el 308, +2 h). Lo decide el admin.
    """
    salida = []
    for n in nuestros:
        k = indices.get(n["id"])
        if k is None or (n.get("status") or "pending") != "pending":
            continue
        nuestro, oficial = _parse_fecha(n.get("kickoff_at")), _parse_fecha(oficiales[k].get("fecha"))
        if not nuestro or not oficial:
            continue
        minutos = round((nuestro - oficial).total_seconds() / 60)
        if minutos > MINUTOS_DE_ATRASO_PARA_AVISAR:
            salida.append({"match_id": n["id"],
                           "partido": f"{n.get('home_team')} vs {n.get('away_team')}",
                           "nuestro": nuestro.isoformat(), "unafut": oficial.isoformat(),
                           "minutos": minutos})
    return sorted(salida, key=lambda x: x["unafut"])


async def refrescar_jornadas_oficiales(supabase, client, tournament: dict) -> dict:
    """Guarda `matches.jornada_oficial` desde UNAFUT. Nunca lanza.

    Devuelve los conteos (o `error`) y `saques_atrasados`: el sync los pone en
    su respuesta, que queda en `net._http_response`, y avisa de los atrasos."""
    tid = tournament["id"]
    try:
        oficiales = await traer_jornadas(client, tournament["unafut_league_slug"],
                                         str(tournament["unafut_competition_id"]))
        nuestros = (supabase.table("matches")
                    .select("id, home_team, away_team, kickoff_at, status, jornada_oficial")
                    .eq("tournament_id", tid).eq("phase", "groups").execute().data or [])
        indices = _emparejar(nuestros, oficiales)
        cambiados = 0
        for m in nuestros:
            k = indices.get(m["id"])
            nueva = oficiales[k]["ronda"] if k is not None else None
            if nueva is not None and nueva != m.get("jornada_oficial"):
                supabase.table("matches").update({"jornada_oficial": nueva}).eq("id", m["id"]).execute()
                cambiados += 1
        supabase.table("tournaments").update(
            {"unafut_jornadas_at": datetime.now(timezone.utc).isoformat()}).eq("id", tid).execute()
        return {"oficiales": len(oficiales), "emparejados": len(indices),
                "sin_pareja": len(nuestros) - len(indices), "actualizados": cambiados,
                "saques_atrasados": saques_atrasados(nuestros, oficiales, indices)}
    except Exception as exc:  # noqa: BLE001 - UNAFUT nunca tumba el sync
        _log.warning("No se pudieron traer las jornadas de UNAFUT (torneo %s): %s", tid, exc)
        return {"error": f"{type(exc).__name__}: {exc}"}


def aplicar_jornada_oficial(parsed: list, snap: dict, con_x2: set) -> list:
    """Reemplaza la jornada calculada por la oficial cuando es SEGURO.

    `snap`: {external_id: fila guardada} (con id, status, matchday, jornada_oficial).
    `con_x2`: ids de partidos con algún ×2 puesto.
    Devuelve las diferencias
    [{match_id, partido, guardada, calculada, oficial, aplicada}].

    SE DECIDE CONTRA LA JORNADA GUARDADA, no contra la calculada (vigésima
    auditoría). El destino es la oficial o, sin oficial, la calculada. Antes la
    guarda solo actuaba cuando oficial ≠ calculada, y quedaban tres huecos por
    los que un ×2 cambiaba de bolsa sin aviso: que UNAFUT y ESPN se movieran a
    la vez (la calculada ya igual a la nueva oficial), que no hubiera oficial y
    ESPN moviera la fecha, y un partido ya jugado en esas mismas condiciones.
    Ahora un partido que no es seguro (empezó o tiene un ×2) CONSERVA SIEMPRE la
    guardada, y si el destino es otro se reporta como trabado para que el admin
    lo vea. Lo que ya está en la oficial no se reporta: no hay nada que tocar.

    `con_x2` solo tiene que traer los partidos cuyo destino difiere de la
    guardada (`partidos_a_mover`): en los demás no se mueve nada.
    """
    diferencias = []
    for p in parsed:
        if p.get("matchday") is None:
            continue  # eliminatoria: no lleva jornada
        guardado = snap.get(p["external_id"]) or {}
        oficial = guardado.get("jornada_oficial")
        guardada = guardado.get("matchday")
        calculada = p["matchday"]
        if guardado.get("score_locked"):
            # Congelado por el admin: el sync no lo escribe, no hay nada que avisar.
            if guardada is not None:
                p["matchday"] = guardada
            p["stage"] = f"Jornada {p['matchday']}"
            continue
        destino = oficial if oficial is not None else calculada
        seguro = (p.get("status") == "pending" and guardado.get("status", "pending") == "pending"
                  and guardado.get("id") not in con_x2)
        dif = {"match_id": guardado.get("id"),
               "partido": f"{p.get('home_team')} vs {p.get('away_team')}",
               "guardada": guardada, "calculada": calculada, "oficial": oficial,
               "aplicada": seguro}
        if seguro:
            p["matchday"] = destino
            # Solo se cuenta como «corregida» lo que la oficial cambió de verdad.
            if oficial is not None and oficial != calculada and oficial != guardada:
                diferencias.append(dif)
        else:
            if guardada is not None:
                p["matchday"] = guardada
                if destino != guardada:
                    diferencias.append(dif)
        p["stage"] = f"Jornada {p['matchday']}"
    return diferencias


def partidos_a_mover(parsed: list, snap: dict) -> list:
    """Ids de los partidos cuyo destino (oficial, o la calculada) difiere de la
    jornada GUARDADA: son los únicos donde hace falta saber si hay un ×2."""
    ids = []
    for p in parsed:
        guardado = snap.get(p.get("external_id"))
        if p.get("matchday") is None or not guardado or guardado.get("id") is None:
            continue
        oficial = guardado.get("jornada_oficial")
        destino = oficial if oficial is not None else p["matchday"]
        if destino != guardado.get("matchday"):
            ids.append(guardado["id"])
    return ids


def firma_de_diferencias(diferencias: list) -> str:
    """Para no repetir el mismo aviso: cambia solo si cambian las diferencias."""
    return "|".join(sorted(
        f"{d['match_id']}:{d.get('guardada')}:{d['calculada']}>{d['oficial']}:{int(d['aplicada'])}"
        for d in diferencias))


def firma_de_saques(atrasados: list) -> str:
    """Igual, para los saques atrasados contra UNAFUT."""
    return "|".join(sorted(f"{a['match_id']}:{a['nuestro']}>{a['unafut']}" for a in atrasados))


# `tournaments.unafut_aviso_firma` guarda las DOS firmas (jornadas y saques)
# separadas por esto, para no agregar una columna. Un valor viejo, sin
# separador, es solo la de jornadas.
_SEPARADOR_DE_FIRMAS = " #saques# "


def partes_de_firma(guardada) -> tuple:
    """(firma de jornadas, firma de saques) desde `unafut_aviso_firma`."""
    jornadas, _, saques = (guardada or "").partition(_SEPARADOR_DE_FIRMAS)
    return jornadas, saques


def juntar_firmas(jornadas: str, saques: str) -> str:
    return f"{jornadas}{_SEPARADOR_DE_FIRMAS}{saques}" if saques else jornadas
