"""Alineaciones de la liga tica, desde la API de la UNAFUT.

POR QUÉ OTRA FUENTE: ESPN no tiene el once de `crc.1`. Medido el 13 sep 2026:
un partido YA TERMINADO (Escorpiones–Herediano, jornada 8) devuelve `rosters`
con cero jugadores, y otro de la misma fecha devuelve 16 y 12 nombres sin
dorsal, sin formación y todos con posición "SUB" — la lista de quienes
aparecieron en algún evento, no un once. La UNAFUT sí lo tiene completo: 11
titulares por equipo, con dorsal y posición.

CUÁNDO LO PUBLICA, Y POR QUÉ IMPORTA: **al arrancar el partido, no antes.**
Medido sobre Sporting–Saprissa: a 25 minutos del saque, cero jugadores; a un
minuto de empezado, los 22 titulares. Encaja con que el dato salga del acta
oficial, que se abre con el partido. Como las predicciones cierran 15 minutos
ANTES del saque, esta alineación **no sirve para corregir la predicción**: es
información del partido que ya empezó. Se dice así en la pantalla; prometer
otra cosa dejaría a alguien recargando hasta el saque.

LA API es pública y sin llave (`gapi.pixeles.club`, la misma que alimenta el
sitio oficial de la liga, montada sobre Genius Sports). Se la trata como lo
que es: un extra. Si falla, tarda o cambia de forma, el panel sale igual sin
alineación — nunca rompe la pantalla.
"""
import logging
import re
import unicodedata
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

BASE = "https://gapi.pixeles.club/ligas"

# Qué torneo nuestro se sirve de qué liga de la UNAFUT.
LIGAS_UNAFUT = {"crc.1": "costarica"}

# EL EMPAREJAMIENTO VA POR ID, NO POR NOMBRE, y no es una preferencia de
# estilo: «Inter San Carlos» y «A.D. San Carlos» comparten las dos palabras
# que los distinguen del resto. Un emparejamiento por texto —aunque exija que
# coincidan los dos equipos— puede cruzarlos, y cruzar dos equipos significa
# enseñar la alineación equivocada, que es peor que no enseñar ninguna.
#
# Son 10 clubes y la lista cambia una vez por temporada. Si un nombre no está
# acá no hay alineación (y queda un aviso en el log), que es el modo de fallo
# correcto: se ve el panel sin la tarjeta, no una alineación de otro equipo.
EQUIPOS = {
    "herediano": 14078,
    "puntarenas fc": 14050,
    "saprissa": 14044,
    "perez zeledon": 14103,
    "cartagines": 14057,
    "inter de san carlos": 15374,
    "sporting san jose": 14049,
    "alajuelense": 14098,
    "ad san carlos": 14124,
    "escorpiones belen": 15370,
}

# El orden de las líneas en la cancha. La API no da formación, así que las
# líneas salen de la posición de cada jugador: eso NO es inventar una
# formación, es agrupar lo que la fuente ya dice.
ORDEN = {"GOALKEEPER": 0, "DEFENDER": 1, "MIDFIELDER": 2, "FORWARD": 3}
POSICION = {"GOALKEEPER": "POR", "DEFENDER": "DEF", "MIDFIELDER": "MED", "FORWARD": "DEL"}

TITULARES_DE_UN_ONCE = 11
# Cuántos jugadores sin posición se toleran antes de renunciar al reparto.
SIN_POSICION_TOLERADOS = 2
LIMITE_SEGUNDOS = 8.0


def _norm(nombre: str) -> str:
    """Sin tildes, en minúsculas y sin puntuación: «Pérez Zeledón» -> «perez zeledon»."""
    s = unicodedata.normalize("NFKD", str(nombre or "")).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", re.sub(r"[^a-zA-Z ]", " ", s)).strip().lower()


def id_de_equipo(nombre: str) -> Optional[int]:
    return EQUIPOS.get(_norm(nombre))


def _titulo(s: str) -> str:
    """«BRYAN ANDRES SEGURA CRUZ» -> «Bryan Andres Segura Cruz».

    La fuente mezcla mayúsculas: el mismo partido trae unos nombres en caja
    normal y otros gritados. Solo se toca cuando viene TODO en mayúsculas,
    para no estropear un «McCarthy» o un «de la Cruz».
    """
    s = str(s or "").strip()
    return s.title() if s and s == s.upper() else s


def _nombres(p: dict) -> tuple:
    """(nombre completo, apellido para la ficha de la cancha).

    `personName` NO sirve: viene en `None` en los partidos en vivo (medido en
    Sporting–Saprissa con el partido en marcha), justo cuando esto se usa.
    `firstName` y `familyName` están siempre y en caja normal.

    El corto es el PRIMER apellido, no el último: en Costa Rica los dos
    apellidos van juntos («Segura Cruz») y quedarse con el último dejaría
    «Cruz» en la ficha, que no es como se le conoce.
    """
    nombre = " ".join(x for x in (_titulo(p.get("firstName")), _titulo(p.get("familyName"))) if x)
    nombre = nombre or _titulo(p.get("nickName") or p.get("personName"))
    apellidos = _titulo(p.get("familyName")).split()
    return nombre, (apellidos[0] if apellidos else None)


def _jugador(p: dict, entraron: set, salieron: set) -> dict:
    nombre, corto = _nombres(p)
    return {
        "nombre": nombre,
        # La cancha lo prefiere si viene; para ESPN no existe y sigue sacando
        # el apellido del nombre como siempre.
        "corto": corto,
        "dorsal": p.get("shirtNumber"),
        "posicion": POSICION.get(p.get("playingPosition"), p.get("playingPosition") or None),
        "entro": p.get("personId") in entraron,
        "salio": p.get("personId") in salieron,
    }


def _lineas(titulares: list) -> Optional[list]:
    """Cuántos jugadores van en cada línea de la cancha, según sus posiciones.

    NO es una formación declarada —la fuente no da ninguna— sino el recuento
    de lo que ella misma dice de cada jugador.

    A ALGUNOS LES FALTA LA POSICIÓN, y cuántos cambia por partido (medido el
    13 sep 2026 contra la API): en Sporting–Saprissa en marcha faltaban 1 y 3;
    en Escorpiones–Herediano, ya terminado, venía la del ARQUERO Y NADA MÁS.
    Con uno o dos huecos se los manda a la última línea y el resto del reparto
    sigue valiendo. Con más, no: diez jugadores en una fila no es una cancha,
    es una pantalla que parece rota. Ahí se devuelve None y la cancha usa su
    4-4-2 de respaldo, que es lo que ya hace con cualquier equipo sin
    formación.

    Sin un arquero identificado tampoco se reparte nada: la primera línea es el
    arco, y ahí un defensa dibujado de portero es un error que se ve.
    """
    if len([p for p in titulares if p.get("playingPosition") == "GOALKEEPER"]) != 1:
        return None
    lineas = [1]
    for pos in ("DEFENDER", "MIDFIELDER", "FORWARD"):
        cuantos = len([p for p in titulares if p.get("playingPosition") == pos])
        if cuantos:
            lineas.append(cuantos)
    sobran = len(titulares) - sum(lineas)
    if sobran > SIN_POSICION_TOLERADOS:
        return None
    if sobran > 0:
        lineas[-1] += sobran
    return lineas if sum(lineas) == len(titulares) else None


def _equipo(competitor: dict, nombre_nuestro: str, entraron: set, salieron: set) -> Optional[dict]:
    jugadores = competitor.get("players") or []
    titulares = [p for p in jugadores if p.get("isStarter")]
    if len(titulares) < TITULARES_DE_UN_ONCE:
        return None

    titulares.sort(key=lambda p: ORDEN.get(p.get("playingPosition"), 9))
    lineas = _lineas(titulares)

    return {
        # El nombre es el NUESTRO: el encabezado de la pantalla dice «Sporting
        # San José» y la pestaña diría «Sporting F.C.» — la misma persona en
        # dos renglones, que se lee como un fallo.
        "equipo": nombre_nuestro,
        "escudo": None,
        "esLocal": None,  # lo pone quien llama, que sabe quién es local
        # La fuente NO declara formación, así que no se muestra ninguna. Las
        # líneas son otra cosa: son las posiciones que la propia fuente da.
        "formacion": None,
        "lineas": lineas,
        "titulares": [_jugador(p, entraron, salieron) for p in titulares],
        "suplentes": [_jugador(p, entraron, salieron) for p in jugadores if not p.get("isStarter")],
    }


def _cambios(detalle: dict) -> tuple:
    entraron, salieron = set(), set()
    for a in detalle.get("actions") or []:
        if a.get("action") != "substitution":
            continue
        (entraron if a.get("subType") == "in" else salieron).add(a.get("personId"))
    return entraron, salieron


async def alineaciones(liga: str, matchday, home: str, away: str) -> Optional[list]:
    """El once de un partido de la liga tica, o None si todavía no está.

    NUNCA LANZA: es un extra sobre el panel de ESPN. Un fallo acá deja la
    pantalla como estaba, no la rompe.
    """
    slug = LIGAS_UNAFUT.get(liga)
    id_local, id_visita = id_de_equipo(home), id_de_equipo(away)
    if not slug or matchday is None or not id_local or not id_visita:
        if slug and (not id_local or not id_visita):
            logger.warning("UNAFUT: equipo sin id en el mapa (%s vs %s)", home, away)
        return None

    try:
        async with httpx.AsyncClient(timeout=LIMITE_SEGUNDOS) as client:
            r = await client.get(f"{BASE}/{slug}/api/rounds/{int(matchday)}")
            r.raise_for_status()

            partido = buscar_partido(r.json(), id_local, id_visita)
            if not partido:
                return None

            d = await client.get(f"{BASE}/{slug}/api/match/{partido['matchId']}")
            d.raise_for_status()
            detalle = d.json()
    except Exception as exc:  # noqa: BLE001 - es un extra, no una dependencia
        logger.warning("UNAFUT no respondió (%s vs %s): %s", home, away, exc)
        return None

    return armar(detalle, id_local, home, away)


def armar(detalle: dict, id_local: int, home: str, away: str) -> Optional[list]:
    """De la respuesta de la UNAFUT al formato que dibuja la cancha.

    Va aparte de la petición para poder fijarlo con una respuesta real en una
    prueba, sin red.
    """
    entraron, salieron = _cambios(detalle)
    salida = []
    for c in detalle.get("competitors") or []:
        es_local = c.get("competitorId") == id_local
        eq = _equipo(c, home if es_local else away, entraron, salieron)
        if eq is None:
            # Con un solo equipo publicado no se dibuja media alineación: se
            # lee como que el otro no presentó equipo.
            return None
        eq["esLocal"] = es_local
        salida.append(eq)

    salida.sort(key=lambda e: not e["esLocal"])
    return salida or None


def buscar_partido(ronda: list, id_local: int, id_visita: int) -> Optional[dict]:
    """El partido de la jornada cuyos DOS equipos son los que buscamos.

    Cada equipo juega una vez por jornada, así que el par de ids es único. Se
    exige el par COMPLETO a propósito: con «Inter San Carlos» y «A.D. San
    Carlos» en la misma liga, conformarse con uno solo devolvería el partido
    equivocado.
    """
    buscado = {id_local, id_visita}
    return next(
        (m for m in (ronda or [])
         if {c.get("competitorId") for c in (m.get("competitors") or [])} == buscado),
        None,
    )
