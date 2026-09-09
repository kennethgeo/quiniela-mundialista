"""Detalle de un partido desde ESPN: alineaciones, estadísticas, forma e historial.

QUÉ TRAE Y QUÉ NO (comprobado contra la API, no supuesto):
  · Alineaciones con formación, once, dorsal, posición y cambios. **Aparecen
    cerca de una hora antes del saque**: medido, a 87 y a 73 minutos todavía
    venían vacías. Como las predicciones cierran 15 minutos antes, queda una
    ventana real de ~45 minutos para ver el once y corregir.
  · Estadísticas de equipo (posesión, tiros, córners, tarjetas…) solo con el
    partido en marcha.
  · Forma reciente (últimos 5) e historial entre ambos: disponibles desde antes.
  · NO se expone nada de casas de apuestas, por decisión del dueño.
  · Las "noticias" de ESPN son DE LA LIGA, no del partido —en el resumen del
    Real Madrid aparecían previas de otros partidos—, así que tampoco se
    exponen: mostrarlas como noticias del partido sería mentir.

Se recorta acá y no en el navegador: el `summary` crudo pesa ~200 KB y trae
decenas de secciones que la pantalla no usa.
"""
from datetime import datetime, timezone
from typing import Optional

import httpx

ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer"

# NADA DE `lang=es&region=es`, aunque la app esté en español.
#
# Medido el 9 sep 2026 sobre Barcelona–Feyenoord y Stuttgart–Viking, a 28
# minutos del saque y con el once ya publicado: la MISMA petición devuelve
#   sin lang  -> 11 titulares y formación 4-3-3 en los dos equipos
#   lang=es   -> 0 titulares y formación None
# O sea que la edición en español no trae la alineación. Con el parámetro
# puesto, `_alineaciones` descartaba los dos equipos —hace bien: sin once no
# hay nada que mostrar— y el panel decía «todavía no se publicaron» para
# siempre. Nunca llegó a enseñar una alineación.
#
# Lo único que se pierde son las etiquetas: `gameResult` pasa a venir en
# inglés (W/L/D). Se traduce en `_forma`, que es donde ya estaba la regla de
# no fiarse del idioma de la fuente.
PARAMS_ESPN: dict = {}

# Cuánto vale una respuesta antes de volver a pedirla. Un partido en curso
# cambia todo el tiempo; uno terminado ya no cambia nunca.
TTL_EN_CURSO = 60
TTL_POR_JUGAR = 15 * 60
TTL_TERMINADO = 24 * 3600


# Cerca del saque la alineación es justo lo que está por aparecer, así que
# guardar la respuesta 15 minutos hace que se vea vieja durante 15 minutos.
TTL_CERCA_DEL_SAQUE = 3 * 60
MINUTOS_CERCA = 150


def ttl_para(status: str, minutos_al_saque: Optional[float] = None) -> int:
    if status == "in_progress":
        return TTL_EN_CURSO
    if status in ("finished", "cancelled", "postponed"):
        return TTL_TERMINADO
    if minutos_al_saque is not None and 0 <= minutos_al_saque <= MINUTOS_CERCA:
        return TTL_CERCA_DEL_SAQUE
    return TTL_POR_JUGAR


# Estadísticas que se muestran, en el orden en que se leen. ESPN mezcla
# etiquetas en español e inglés en la misma respuesta ("Fouls" junto a
# "POSESIÓN"), así que el nombre lo ponemos nosotros y no el que venga.
_STATS = [
    ("possessionPct", "Posesión", "%"),
    ("totalShots", "Tiros", ""),
    ("shotsOnTarget", "Tiros al arco", ""),
    ("wonCorners", "Tiros de esquina", ""),
    ("saves", "Atajadas", ""),
    ("foulsCommitted", "Faltas", ""),
    ("yellowCards", "Amarillas", ""),
    ("redCards", "Rojas", ""),
    ("offsides", "Fuera de juego", ""),
]


def _jugador(j: dict) -> dict:
    at = j.get("athlete") or {}
    pos = j.get("position") or {}
    return {
        "nombre": at.get("displayName") or at.get("fullName"),
        "dorsal": j.get("jersey"),
        "posicion": pos.get("abbreviation") or pos.get("displayName"),
        "entro": bool(j.get("subbedIn")),
        "salio": bool(j.get("subbedOut")),
    }


def _alineaciones(summary: dict) -> Optional[list]:
    salida = []
    for eq in summary.get("rosters") or []:
        jugadores = eq.get("roster") or []
        titulares = [_jugador(j) for j in jugadores if j.get("starter")]
        # Sin once no hay alineación que mostrar: ESPN devuelve el plantel
        # completo con `starter: false` hasta que publica el equipo.
        if not titulares:
            continue
        salida.append({
            "equipo": (eq.get("team") or {}).get("displayName"),
            "escudo": (eq.get("team") or {}).get("logo"),
            "esLocal": eq.get("homeAway") == "home",
            "formacion": eq.get("formation"),
            "titulares": titulares,
            "suplentes": [_jugador(j) for j in jugadores if not j.get("starter")],
        })
    return salida or None


def _estadisticas(summary: dict) -> Optional[list]:
    salida = []
    for t in ((summary.get("boxscore") or {}).get("teams") or []):
        por_nombre = {s.get("name"): s for s in (t.get("statistics") or [])}
        valores = []
        for clave, etiqueta, sufijo in _STATS:
            s = por_nombre.get(clave)
            if not s:
                continue
            valores.append({"etiqueta": etiqueta,
                            "valor": f"{s.get('displayValue')}{sufijo}"})
        if valores:
            salida.append({"equipo": (t.get("team") or {}).get("displayName"),
                           "esLocal": t.get("homeAway") == "home",
                           "valores": valores})
    return salida or None


# ESPN escribe el resultado en el idioma de la respuesta: W/L/D en inglés,
# G/P/E en español. Se normaliza acá, por lo mismo que las etiquetas de las
# estadísticas: la pantalla no puede depender de qué idioma devolvió la fuente
# —pinta un punto gris para lo que no reconoce— y el idioma es justo lo que
# cambió al dejar de pedir la edición en español.
_RESULTADO = {"W": "G", "L": "P", "D": "E", "G": "G", "P": "P", "E": "E"}


def _forma(summary: dict) -> Optional[list]:
    salida = []
    for t in summary.get("lastFiveGames") or []:
        partidos = []
        for e in (t.get("events") or [])[:5]:
            partidos.append({
                "fecha": (e.get("gameDate") or "")[:10],
                "rival": (e.get("opponent") or {}).get("abbreviation")
                         or (e.get("opponent") or {}).get("displayName"),
                "marcador": e.get("score"),
                # Siempre G / P / E, venga como venga (ver _RESULTADO).
                "resultado": _RESULTADO.get(e.get("gameResult")),
                "torneo": e.get("leagueAbbreviation"),
            })
        if partidos:
            salida.append({"equipo": (t.get("team") or {}).get("displayName"),
                           "partidos": partidos})
    return salida or None


def _historial(summary: dict) -> Optional[dict]:
    """Enfrentamientos anteriores, CON el marcador.

    La primera versión leía `summary`/`shortName` del evento y esos campos NO
    existen en `seasonseries`: la pantalla mostraba la fecha y nada más. El
    marcador está en `competitors`, uno por equipo, con su `score`.
    """
    for ss in summary.get("seasonseries") or []:
        eventos = ss.get("events") or []
        if not eventos:
            continue
        partidos = []
        for e in eventos[:5]:
            equipos = []
            for c in (e.get("competitors") or []):
                t = c.get("team") or {}
                equipos.append({
                    "equipo": t.get("abbreviation") or t.get("displayName"),
                    "goles": c.get("score"),
                    "gano": bool(c.get("winner")),
                })
            # Sin los dos equipos no hay marcador que mostrar; se omite la fila
            # en vez de pintar una fecha suelta, que es lo que pasaba antes.
            if len(equipos) != 2:
                continue
            partidos.append({
                "fecha": (e.get("date") or "")[:10],
                "equipos": equipos,
                "torneo": e.get("competitionName"),
            })
        if not partidos:
            continue
        return {"resumen": ss.get("summary"), "partidos": partidos}
    return None


def recortar(summary: dict) -> dict:
    """Deja solo lo que la pantalla dibuja."""
    gi = summary.get("gameInfo") or {}
    venue = gi.get("venue") or {}
    return {
        "actualizado": datetime.now(timezone.utc).isoformat(),
        "estadio": venue.get("fullName"),
        "ciudad": ((venue.get("address") or {}).get("city")),
        "alineaciones": _alineaciones(summary),
        "estadisticas": _estadisticas(summary),
        "forma": _forma(summary),
        "historial": _historial(summary),
    }


async def traer_detalle(liga: str, external_id: str) -> dict:
    """Pide el resumen a ESPN y lo recorta. Lanza si la petición falla: quien
    llama decide si sirve una copia vieja de la caché."""
    async with httpx.AsyncClient(timeout=15.0) as client:
        r = await client.get(
            f"{ESPN_BASE}/{liga}/summary",
            params={"event": external_id, **PARAMS_ESPN},
        )
        r.raise_for_status()
        return recortar(r.json())
