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

# Cuánto vale una respuesta antes de volver a pedirla. Un partido en curso
# cambia todo el tiempo; uno terminado ya no cambia nunca.
TTL_EN_CURSO = 60
TTL_POR_JUGAR = 15 * 60
TTL_TERMINADO = 24 * 3600


def ttl_para(status: str) -> int:
    if status == "in_progress":
        return TTL_EN_CURSO
    if status in ("finished", "cancelled", "postponed"):
        return TTL_TERMINADO
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
                # G / P / E tal como los manda ESPN.
                "resultado": e.get("gameResult"),
                "torneo": e.get("leagueAbbreviation"),
            })
        if partidos:
            salida.append({"equipo": (t.get("team") or {}).get("displayName"),
                           "partidos": partidos})
    return salida or None


def _historial(summary: dict) -> Optional[dict]:
    for ss in summary.get("seasonseries") or []:
        eventos = ss.get("events") or []
        if not eventos:
            continue
        return {
            "resumen": ss.get("summary"),
            "partidos": [{"fecha": (e.get("date") or "")[:10],
                          "detalle": e.get("summary") or e.get("shortName")}
                         for e in eventos[:5]],
        }
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
            params={"event": external_id, "lang": "es", "region": "es"},
        )
        r.raise_for_status()
        return recortar(r.json())
