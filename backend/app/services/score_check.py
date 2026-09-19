"""Cruce de dos fuentes de marcador: ESPN (la que usa el sync) vs UNAFUT.

POR QUÉ: ESPN ya se contradijo consigo misma en este torneo — su scoreboard
reportaba un partido como SUSPENDED mientras su propio endpoint de summary lo
daba por FULL_TIME. Con una sola fuente, un dato malo se descubre cuando alguien
reclama por WhatsApp. UNAFUT ya está conectado (se usa para goleadores y
asistencias), así que comparar sale casi gratis.

Esto NO corrige nada solo: reporta las discrepancias para que el admin decida.
Corregir automáticamente sería peor que el problema — significaría que dos
fuentes en desacuerdo se pisan entre ellas en cada pasada.

EL PROBLEMA DIFÍCIL es emparejar los partidos: los nombres no coinciden entre
fuentes ("C.S. Cartaginés" vs "Cartaginés", "Inter San Carlos" vs "Inter de San
Carlos"). Y hay una trampa concreta en esta liga: "A.D. San Carlos" e "Inter de
San Carlos" comparten tokens, así que comparar por contención los confunde. Por
eso se empareja el PARTIDO COMPLETO: tienen que calzar LOS DOS equipos y la
fecha. Con un solo equipo, "San Carlos" es ambiguo; con el cruce entero, el
otro equipo lo desambigua.
"""
import logging
import re
import unicodedata
from datetime import datetime, timedelta, timezone

import httpx

logger = logging.getLogger(__name__)

UNAFUT_BASE = "https://gapi.pixeles.club/ligas"

# Cuánto puede tardar un partido en tener resultado antes de que la falta
# sea sospechosa. Es el mismo umbral que usa la pantalla para dejar de
# decir «en juego» (`MINUTOS_MAXIMOS_DE_PARTIDO`).
HORAS_PARA_SOSPECHAR = 4

# Ruido que aparece en una fuente y no en la otra. Se saca de los dos lados por
# igual, así que nunca inclina el emparejamiento hacia un equipo u otro.
_RUIDO = {"fc", "cs", "ld", "ad", "sc", "cd", "club", "deportivo", "municipal", "f", "c", "d", "a", "de"}


def _tokens(nombre: str) -> set:
    s = unicodedata.normalize("NFD", nombre or "")
    s = "".join(c for c in s if unicodedata.category(c) != "Mn").lower()
    s = re.sub(r"[^a-z0-9\s]", " ", s)
    # Los tokens de UNA letra siempre son ruido acá: al sacar la puntuación,
    # "L.D." queda como "l" + "d" y "F.C." como "f" + "c".
    return {t for t in s.split() if len(t) > 1 and t not in _RUIDO}


def _similitud(a: str, b: str) -> float:
    """Coeficiente de solapamiento: intersección sobre el conjunto MÁS CHICO.

    No se usa Jaccard porque una fuente suele agregar palabras que la otra no
    tiene ("Escorpiones Belén" vs "Escorpiones F.C.", "Sporting San José" vs
    "Sporting F.C."), y Jaccard castiga eso hasta el punto de no emparejarlos.
    El solapamiento sí los reconoce, y la ambigüedad que introduce
    ("San Carlos" contra "Inter San Carlos" da 1.0) la resuelve el emparejado a
    nivel PARTIDO: el otro equipo del cruce no calza y el min() lo descarta."""
    ta, tb = _tokens(a), _tokens(b)
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / min(len(ta), len(tb))


def _parse_fecha(s):
    if not s:
        return None
    try:
        txt = s.replace("Z", "+00:00")
        if " " in txt and "+" not in txt and "T" not in txt:
            txt = txt.replace(" ", "T") + "+00:00"
        d = datetime.fromisoformat(txt)
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    except Exception:  # noqa: BLE001
        return None


async def _traer_rondas(client, slug: str, comp_id: str, rondas):
    """Devuelve los partidos de UNAFUT de las rondas pedidas."""
    salida = []
    for r in sorted(rondas):
        try:
            resp = await client.get(f"{UNAFUT_BASE}/{slug}/api/rounds/{r}",
                                    params={"competitionId": comp_id})
            resp.raise_for_status()
            datos = resp.json()
        except Exception:  # noqa: BLE001
            continue
        for m in (datos if isinstance(datos, list) else datos.get("matches") or []):
            comps = m.get("competitors") or []
            if len(comps) < 2:
                continue
            salida.append({
                "local": comps[0].get("competitorName"),
                "visita": comps[1].get("competitorName"),
                "goles_local": comps[0].get("scoreString"),
                "goles_visita": comps[1].get("scoreString"),
                "estado": m.get("matchStatus"),
                "fecha": _parse_fecha(m.get("matchTimeUTC")),
                "ronda": r,
            })
    return salida


def _a_int(v):
    try:
        return int(str(v).strip())
    except (TypeError, ValueError):
        return None


def emparejar(nuestro, candidatos, umbral=0.6):
    """El candidato de UNAFUT que mejor calza con un partido nuestro.

    Se exige que calcen LOS DOS equipos y que la fecha esté cerca: con un solo
    equipo la ambigüedad de 'San Carlos' vuelve."""
    fecha_n = _parse_fecha(nuestro.get("kickoff_at"))
    mejor, mejor_puntaje = None, 0.0
    for c in candidatos:
        if fecha_n and c["fecha"] and abs((c["fecha"] - fecha_n).total_seconds()) > 36 * 3600:
            continue
        s_local = _similitud(nuestro.get("home_team"), c["local"])
        s_visita = _similitud(nuestro.get("away_team"), c["visita"])
        # El más flojo manda: si un lado no calza, el partido no es.
        puntaje = min(s_local, s_visita)
        if puntaje > mejor_puntaje:
            mejor, mejor_puntaje = c, puntaje
    return (mejor, mejor_puntaje) if mejor_puntaje >= umbral else (None, mejor_puntaje)


def clasificar(nuestros, candidatos):
    """Cruza nuestros partidos con los de UNAFUT y los reparte en tres montones.

    Va aparte de la petición para poder fijarlo en una prueba sin red ni base,
    como el resto de la lógica del backend.

    `faltantes` es el montón que ESTE archivo no tenía y que costó tres días de
    silencio: partidos que la fuente oficial YA DIO POR TERMINADOS y que
    nosotros seguimos teniendo en `pending`. No es un desacuerdo entre fuentes
    —no hay dos marcadores que comparar—, es un HUECO nuestro. Antes la
    consulta pedía solo `status = 'finished'`, así que un partido que el sync
    nunca escribió ni entraba en la comparación: la alarma existía y miraba
    justo al lado del incendio.
    """
    discrepancias, faltantes, sin_pareja, comparados = [], [], [], 0
    for m in nuestros:
        pareja, _ = emparejar(m, candidatos)
        if not pareja:
            sin_pareja.append({"match_id": m["id"], "partido": f"{m['home_team']} vs {m['away_team']}"})
            continue

        gl, gv = _a_int(pareja["goles_local"]), _a_int(pareja["goles_visita"])
        cerrado_alla = pareja["estado"] == "COMPLETE" and gl is not None and gv is not None
        cerrado_aca = m.get("status") == "finished" and m.get("home_goals_actual") is not None

        if not cerrado_alla:
            # Si UNAFUT todavía no lo cerró, su marcador no es comparable.
            continue

        if not cerrado_aca:
            faltantes.append({
                "match_id": m["id"],
                "partido": f"{m['home_team']} vs {m['away_team']}",
                "jornada": m.get("matchday"),
                "nuestro_estado": m.get("status"),
                "unafut": f"{gl}-{gv}",
            })
            continue

        comparados += 1
        if gl != m["home_goals_actual"] or gv != m["away_goals_actual"]:
            discrepancias.append({
                "match_id": m["id"],
                "partido": f"{m['home_team']} vs {m['away_team']}",
                "jornada": m.get("matchday"),
                "nuestro": f"{m['home_goals_actual']}-{m['away_goals_actual']}",
                "unafut": f"{gl}-{gv}",
                # Un partido fijado a mano se espera que difiera: es una
                # corrección deliberada (sanción, walkover), no un error.
                "esperado": bool(m.get("score_locked")),
            })

    return discrepancias, faltantes, sin_pareja, comparados


async def comparar_con_unafut(supabase, tournament_id: int) -> dict:
    """Compara nuestros marcadores contra los de UNAFUT.

    Mira los terminados (¿coincide el marcador?) Y los que deberían estarlo
    (¿nos falta el resultado?)."""
    t = (supabase.table("tournaments")
         .select("unafut_league_slug, unafut_competition_id")
         .eq("id", tournament_id).single().execute().data) or {}
    slug, comp_id = t.get("unafut_league_slug"), t.get("unafut_competition_id")
    if not slug or not comp_id:
        return {"tournament_id": tournament_id, "fuente": None,
                "mensaje": "El torneo no tiene configurada la fuente de UNAFUT",
                "discrepancias": [], "faltantes": [], "comparados": 0}

    # Los TERMINADOS y también los que ya deberían haberse jugado: sin estos
    # últimos, un partido que el sync nunca escribió no entra en la comparación
    # y el hueco pasa desapercibido. Cancelados y pospuestos quedan fuera a
    # propósito: son decisiones del admin, no huecos.
    limite = (datetime.now(timezone.utc) - timedelta(hours=HORAS_PARA_SOSPECHAR)).isoformat()
    nuestros = (supabase.table("matches")
                .select("id, home_team, away_team, home_goals_actual, away_goals_actual, "
                        "status, matchday, kickoff_at, score_locked")
                .eq("tournament_id", tournament_id)
                .in_("status", ["finished", "pending", "in_progress"])
                .lt("kickoff_at", limite).execute().data or [])
    if not nuestros:
        return {"tournament_id": tournament_id, "fuente": "unafut",
                "discrepancias": [], "faltantes": [], "comparados": 0, "sin_pareja": []}

    rondas = {m["matchday"] for m in nuestros if m.get("matchday")}
    async with httpx.AsyncClient(timeout=20.0) as client:
        candidatos = await _traer_rondas(client, slug, comp_id, rondas)

    discrepancias, faltantes, sin_pareja, comparados = clasificar(nuestros, candidatos)
    return {
        "tournament_id": tournament_id,
        "fuente": "unafut",
        "comparados": comparados,
        "discrepancias": discrepancias,
        "faltantes": faltantes,
        "sin_pareja": sin_pareja,
    }


def sospechosos(supabase, ahora=None) -> dict:
    """Torneos con partidos que ya deberían tener resultado y no lo tienen.

    Es una consulta a NUESTRA base, sin red: sirve para no llamar a UNAFUT en
    cada pasada del cron. El vigilante solo descuelga el teléfono cuando
    nuestros propios datos ya huelen a hueco.

    El umbral es el mismo que usa la pantalla para dejar de decir «en juego»
    (`MINUTOS_MAXIMOS_DE_PARTIDO`, 4 horas): si allá se admite que no tenemos
    el dato, acá se sale a buscarlo.
    """
    ahora = ahora or datetime.now(timezone.utc)
    limite = (ahora - timedelta(hours=HORAS_PARA_SOSPECHAR)).isoformat()
    filas = (supabase.table("matches")
             .select("tournament_id")
             .in_("status", ["pending", "in_progress"])
             .lt("kickoff_at", limite).execute().data or [])
    cuenta = {}
    for f in filas:
        cuenta[f["tournament_id"]] = cuenta.get(f["tournament_id"], 0) + 1
    return cuenta


async def vigilar_resultados(supabase) -> dict:
    """Avisa si la fuente oficial tiene resultados que a nosotros nos faltan.

    NO CORRIGE NADA, igual que el cruce manual: dos fuentes que se pisan entre
    sí en cada pasada es peor que el problema. Lo que hace es que un sync mudo
    deje de ser invisible — el caso real fueron tres días sin escribir nada y
    ningún error en ningún log.
    """
    pendientes = sospechosos(supabase)
    if not pendientes:
        return {"revisados": 0, "faltantes": []}

    torneos = (supabase.table("tournaments")
               .select("id, name, unafut_league_slug")
               .in_("id", list(pendientes.keys())).execute().data or [])

    faltantes, revisados = [], 0
    for t in torneos:
        if not t.get("unafut_league_slug"):
            continue  # sin segunda fuente no hay con qué comparar
        revisados += 1
        try:
            informe = await comparar_con_unafut(supabase, t["id"])
        except Exception as exc:  # noqa: BLE001 - vigilar nunca rompe el sync
            logger.warning("No se pudo cruzar con UNAFUT el torneo %s: %s", t["id"], exc)
            continue
        for f in informe.get("faltantes") or []:
            faltantes.append({**f, "torneo": t.get("name")})

    if faltantes:
        logger.warning(
            "UNAFUT ya tiene %d resultado(s) que a nosotros nos faltan: %s",
            len(faltantes),
            "; ".join(f"{f['partido']} ({f['unafut']})" for f in faltantes[:5]),
        )
    return {"revisados": revisados, "faltantes": faltantes}
