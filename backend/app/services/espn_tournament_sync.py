"""
Sync GENÉRICO de partidos desde ESPN para torneos nuevos (source='espn').

Cada evento de ESPN = un partido, identificado por su id (matches.external_id).
Así el upsert crea los fixtures y actualiza marcadores/estado sin emparejar por
nombre. Trae equipos y posiciones en español (lang=es).

El Mundial (torneo #1) NO pasa por acá — tiene su propio sync (live_sync.py).
"""

import asyncio
import logging
import re
from datetime import datetime, timedelta, timezone

import httpx

from app.services.jornadas_unafut import (
    SEGUNDOS_PARA_REFRESCAR,
    aplicar_jornada_oficial,
    firma_de_diferencias,
    firma_de_saques,
    hay_que_refrescar,
    juntar_firmas,
    partes_de_firma,
    partidos_a_mover,
    refrescar_jornadas_oficiales,
)
from app.services.notifications import broadcast_push_to_users
from app.services.scoring import calculate_and_update_scores, partidos_sin_puntuar

logger = logging.getLogger(__name__)

ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer"

# Cuánto mira hacia atrás la ventana móvil del cron. NO es solo de acá: la
# migración 81 usa el MISMO número para decidir hasta cuándo vale la pena
# insistir con un resultado que nos falta. Más atrás de esto no le
# preguntamos a ESPN, así que reintentar no rescataría nada.
DIAS_HACIA_ATRAS = 3


def _to_int(v):
    try:
        return int(v)
    except (ValueError, TypeError):
        return None


# slug de ESPN (season.slug / type) -> etiqueta de fase en español
# EL ORDEN MANDA: se devuelve la PRIMERA que aparezca en el slug, así que lo
# específico va antes que lo genérico. Comprobado contra ESPN de verdad
# (uefa.champions y crc.1, temporadas 2025 y 2026), no supuesto:
#
#   'clausura---grand-finals'     -> Gran final   (contiene "final": si "final"
#                                                  fuera antes, la gran final y
#                                                  la final serían la MISMA
#                                                  clave de cupo, y en la liga
#                                                  tica son dos series distintas)
#   'clausura---playoff-finals'   -> Final
#   'clausura---playoff-semifinals' -> Semifinal
#   'knockout-round-playoffs'     -> Repechaje    (la ronda previa a octavos de
#                                                  la Champions; con "knockout"
#                                                  antes se llamaba
#                                                  "Eliminatoria", que es el
#                                                  comodín genérico)
#   'round-of-16' / 'quarterfinals' / 'semifinals' / 'final' -> lo obvio
#   'league-phase' -> Fase de liga  ·  'apertura'/'clausura' -> None (regular)
#
# La etiqueta NO es decorativa: en las ligas es la CLAVE del cupo de ×2
# (`clave_fase`), así que cambiarla cambia a qué bolsa va un partido.
_STAGE_KEYS = [
    ("grand-final", "Gran final"), ("grand_final", "Gran final"),
    ("knockout-round-playoff", "Repechaje"), ("knockout_round_playoff", "Repechaje"),
    ("round-of-32", "Dieciseisavos"), ("round_of_32", "Dieciseisavos"),
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


# El tramo de una serie de ida y vuelta, sacado de la NOTA de ESPN. La nota no
# es una etiqueta: es una frase, y después del partido trae el resultado
# adentro. Comprobado con el scoreboard real (crc.1 y uefa.champions,
# 2024-2025): con `lang=es`, que es como lo pide el sync, llega «Ida» y «Juego
# de Vuelta - Saprissa avanza 4-2 en el global»; sin `lang`, «1st Leg» y «2nd
# Leg - Saprissa advance 4-2 on aggregate». Un partido único trae a veces
# «Portugal avanza 3-0 en tiros de penal».
#
# Antes la nota entraba CRUDA en `stage` («Semifinal · Juego de Vuelta -
# Saprissa avanza…»). Las jornadas y los chips agrupan por `stage`, así que
# cada vuelta terminada se volvía una jornada propia de un partido —con ganador
# y racha propios— y mostraba el resultado del global como spoiler. Ahora solo
# sale «Ida», «Vuelta» o nada: lo que no se reconoce NO se copia, porque
# cualquier variante nueva volvería a partir la jornada.
_IDA = re.compile(r"^\s*(1st\s+leg|(juego\s+de\s+|partido\s+de\s+)?ida)\b", re.IGNORECASE)
_VUELTA = re.compile(r"^\s*(2nd\s+leg|(juego\s+de\s+|partido\s+de\s+)?vuelta)\b", re.IGNORECASE)


def _tramo_de_la_nota(texto) -> str:
    """'Ida', 'Vuelta' o '' (nunca el texto crudo de ESPN)."""
    t = texto or ""
    if _IDA.match(t):
        return "Ida"
    if _VUELTA.match(t):
        return "Vuelta"
    return ""


def _stage_from_event(ev):
    """(stage_base, leg). stage_base es la fase (o None si es liga regular);
    leg es 'Ida', 'Vuelta' o ''."""
    slug = ((ev.get("season") or {}).get("slug") or "").lower()
    leg = ""
    for n in (ev["competitions"][0].get("notes") or []):
        leg = _tramo_de_la_nota(n.get("text"))
        if leg:
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

    home_goals, away_goals = _to_int(h.get("score")), _to_int(a.get("score"))
    ganador_penales = _ganador_de_la_tanda(
        _name, status, stage_base, home_goals, away_goals,
        [(h, h["team"].get("displayName") or h["team"].get("name")),
         (a, a["team"].get("displayName") or a["team"].get("name"))])

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
        "home_goals": home_goals,
        "away_goals": away_goals,
        "minute": minute,
        "events": events,
        "stage_base": stage_base,   # None = liga regular
        "leg": leg,                 # "Ida"/"Vuelta"/"" (dos partidos)
        # Solo True con una tanda REAL (ver _ganador_de_la_tanda). False NO
        # significa «no hubo penales»: significa «ESPN no lo dice», y por eso
        # el upsert conserva lo que ya estaba (pudo marcarlo el admin a mano).
        "goes_to_penalties": ganador_penales is not None,
        "penalties_winner_real": ganador_penales,
    }


def _ganador_de_la_tanda(status_name, status, stage_base, home_goals, away_goals, competidores):
    """El equipo que pasó por penales, o None si no hubo una tanda que contar.

    POR QUÉ: la detección automática de penales vivía solo en `live_sync`, que
    lee únicamente el Mundial. En la liga tica y en la Champions nadie marcaba
    `goes_to_penalties`, y si el admin se olvidaba de hacerlo a mano en una
    semifinal o una final, quien predijo empate y acertó el pase perdía su +1
    (2 con ×2), y quien predijo ganador perdía el punto por el equipo que pasa.

    Hacen falta las TRES cosas, y cada una tiene un partido real detrás:
      · Una tanda de verdad: estado `STATUS_FINAL_PEN` o un `shootoutScore`.
      · Empate en el partido (90/120). La etiqueta de ESPN miente a veces:
        Alajuelense–Puntarenas (735711, semifinal del Clausura 2025) viene
        «FT-Pens» y fue un 1-0 REAL con gol en la prórroga. Y una vuelta
        Liverpool 0-1 PSG (733605) se definió por penales en el GLOBAL, no en
        ese partido. Ninguno de los dos se marca, y los goles NUNCA se tocan:
        restarle la tanda o sumar periodos convertía el 1-0 real en un 0-0.
      · Eliminatoria: en la fase regular no hay penales.
    Y el partido tiene que haber terminado con un ganador marcado
    (`winner=true`): a mitad de la tanda, o sin ganador, no se marca nada y
    queda el respaldo manual del admin.

    El nombre es el MISMO que se guarda en home_team/away_team, que es contra
    lo que compara el motor la elección de quién pasa.
    """
    if status != "finished" or not _es_eliminatoria(stage_base):
        return None
    if home_goals is None or home_goals != away_goals:
        return None
    hubo_tanda = (status_name == "STATUS_FINAL_PEN"
                  or any(c.get("shootoutScore") is not None for c, _ in competidores))
    if not hubo_tanda:
        return None
    ganadores = [nombre for c, nombre in competidores if c.get("winner") is True and nombre]
    return ganadores[0] if len(ganadores) == 1 else None


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
    def _entrada(x):
        return {"external_id": x["external_id"], "kickoff_at": x["kickoff_at"],
                "equipos": {e for e in (x.get("home_team"), x.get("away_team")) if e}}

    hist_entries = [
        _entrada(h)
        for h in (history or [])
        if h.get("kickoff_at") and h.get("external_id") not in new_ids
    ]
    combined = sorted(
        [_entrada(p) for p in new_regular] + hist_entries,
        key=lambda x: x["kickoff_at"] or "",
    )

    # Umbral de separación entre jornadas: una jornada real puede repartirse
    # entre viernes y lunes (hasta ~28h de hueco interno visto en producción,
    # por husos horarios), mientras que el salto a la siguiente jornada es de
    # varios días (mínimo ~72h visto en producción). 48h queda cómodo en el
    # medio. Se compara SIEMPRE contra el partido anterior (no contra el
    # primero de la jornada) para no perder el hueco si la jornada se estira.
    #
    # EL HUECO SOLO NO ALCANZA (auditoría del 28 sep 2026): la liga tica metió
    # una jornada entre semana (14-16 oct) pegada a la del fin de semana (18-20
    # oct), con exactamente 48 h de hueco, y las dos quedaron como UNA
    # «Jornada 11» de 10 partidos. Como el cupo del ×2 es por jornada, quien
    # gastó sus dos ×2 entre semana se quedaba sin ninguno el fin de semana.
    # Regla que no depende del calendario: **cada equipo juega una vez por
    # jornada**. Si un equipo ya jugó en la jornada abierta, empieza otra.
    # Límite, dicho: un partido pospuesto y jugado semanas después cae en la
    # jornada de esa fecha (y puede abrir una de más); lo corrige el admin, y
    # `verificar_estado.sql` §23 lista las jornadas con un tamaño raro.
    GAP_THRESHOLD_HOURS = 48
    md_by_id = {}
    md = 0
    prev_date = None
    equipos_de_la_jornada = set()
    for e in combined:
        d = _parse(e["kickoff_at"])
        repite = bool(e["equipos"] & equipos_de_la_jornada)
        if prev_date is None or repite or (d and (d - prev_date).total_seconds() > GAP_THRESHOLD_HOURS * 3600):
            md += 1
            equipos_de_la_jornada = set()
        if d:
            prev_date = d
        equipos_de_la_jornada |= e["equipos"]
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


def _ventanas(now, full):
    """Los MESES (YYYYMM) que hay que consultarle al scoreboard.

    NUNCA UN RANGO `YYYYMMDD-YYYYMMDD`: ESPN devuelve **cero eventos** para
    cualquier rango, y sin un solo error — la respuesta es un 200 con
    `events: []`. Medido el 19 sep 2026 en crc.1, uefa.champions, esp.1 y
    eng.1, y hasta con un rango de un solo día (`20260918-20260918`). El mismo
    mes pedido como `202609` devuelve 15, 18, 39 y 30 eventos.

    Así estaba escrito el sync, así que **cada corrida del cron traía una lista
    vacía y no escribía nada**: el partido Pérez Zeledón–Sporting del 18 de
    septiembre siguió en `pending` doce horas después de terminar, mientras
    ESPN lo daba por FT 1-2. Lo reportó el dueño («¿por qué sigue en proceso?»).

    Un mes por petición es además menos tráfico que la ventana anterior: la
    móvil (3 días atrás, 21 adelante) toca uno o dos meses.
    """
    if not full:
        return _meses(now - timedelta(days=DIAS_HACIA_ATRAS), now + timedelta(days=21))
    # Temporada completa: de ~10 meses atrás a ~5 adelante.
    return _meses(now - timedelta(days=300), now + timedelta(days=150))


def _meses(lo, hi):
    """Los meses YYYYMM entre dos fechas, inclusive."""
    out, y, m = [], lo.year, lo.month
    while (y, m) <= (hi.year, hi.month):
        out.append(f"{y:04d}{m:02d}")
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
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


def _columnas_de_penales(p: dict, guardado) -> dict:
    """Lo que el upsert escribe en `goes_to_penalties`/`penalties_winner_real`.

    Una tanda real detectada manda. Si ESPN no dice nada, se reescribe lo que
    YA estaba: el form de admin es el respaldo manual y no pone `score_locked`,
    así que escribir False en cada pasada le borraría al minuto una tanda
    marcada a mano. Va en TODAS las filas (y no solo en las que tienen tanda)
    porque en un upsert en lote las filas tienen que traer las mismas columnas:
    postgrest-py manda `default_to_null=True`, y una columna que a una fila le
    falta se escribe NULL. Los congelados (`score_locked`) ni siquiera llegan acá.
    """
    if p.get("goes_to_penalties"):
        return {"goes_to_penalties": True, "penalties_winner_real": p.get("penalties_winner_real")}
    g = guardado or {}
    return {"goes_to_penalties": bool(g.get("goes_to_penalties")),
            "penalties_winner_real": g.get("penalties_winner_real")}


def _penales_cambiaron(p: dict, guardado) -> bool:
    """¿La tanda que trae ESPN es distinta de la guardada? Dispara el re-puntaje."""
    if not p.get("goes_to_penalties"):
        return False
    g = guardado or {}
    return (not g.get("goes_to_penalties")
            or (g.get("penalties_winner_real") or None) != p.get("penalties_winner_real"))


def congelados_terminados(snap: dict, frozen_ids: set) -> list:
    """Los partidos que el admin CONGELÓ (score_locked) y ya terminaron.

    Congelado significa «ESPN no los pisa», no «no se puntúan». Son justo los
    que el admin corrigió a mano: el panel escribe el resultado y DESPUÉS pide
    el re-puntaje en otra petición. Si esa segunda falla, sin esto nadie los
    volvía a mirar, porque el sync salta los congelados. Medido el 22 sep 2026:
    2 partidos terminados y congelados en la liga tica.
    """
    return [m["id"] for eid, m in snap.items()
            if eid in frozen_ids and m.get("status") == "finished" and m.get("id")]


def partidos_sin_predicciones(supabase, match_ids) -> list:
    """De los partidos dados, los que NO tienen ni una predicción.

    Se pregunta partido por partido CONTANDO, y es a propósito: pedir de una
    vez «todas las predicciones de estos partidos» choca con el tope de 1.000
    filas de PostgREST. Una temporada de la liga tica son ~90 partidos × 17
    personas ≈ 1.500 predicciones: la lista vendría cortada y un partido CON
    predicciones parecería vacío. Como `predictions` cae en CASCADA al borrar
    un partido, ese error borraría justo lo que esta función existe para
    proteger.
    """
    vacios = []
    for mid in match_ids or []:
        r = (supabase.table("predictions").select("id", count="exact")
             .eq("match_id", mid).limit(1).execute())
        if (r.count or 0) == 0:
            vacios.append(mid)
    return vacios


def _usar_jornada_oficial(supabase, parsed, snap) -> list:
    """Aplica la jornada de UNAFUT donde es seguro (ver jornadas_unafut).

    Los ×2 se buscan en los partidos que se MOVERÍAN respecto de la jornada
    guardada, no solo donde la oficial difiere de la calculada: si las dos
    fuentes se movían a la vez, el ×2 cambiaba de bolsa sin que nadie mirara."""
    candidatos = partidos_a_mover(parsed, snap)
    con_x2 = set()
    if candidatos:
        try:
            filas = (supabase.table("predictions").select("match_id")
                     .in_("match_id", candidatos).eq("use_powerup_x2", True).execute().data or [])
            con_x2 = {f["match_id"] for f in filas}
        except Exception:  # noqa: BLE001 - sin saber si hay ×2, nada es seguro
            con_x2 = set(candidatos)
    return aplicar_jornada_oficial(parsed, snap, con_x2)


async def _aviso_con_firma(supabase, tournament, cual: str, firma: str, titulo: str, cuerpo: str) -> str:
    """Push al admin global, sin repetirlo mientras la firma no cambie. Nunca lanza.

    `cual` es 'jornadas' o 'saques': las dos firmas viven juntas en
    `unafut_aviso_firma` (ver jornadas_unafut.juntar_firmas).

    · La firma se guarda SOLO si salió al menos un push. Antes se guardaba en
      cuanto volvía la llamada, y `broadcast_push_to_users` no lanza: con la
      llave VAPID rota (hasta el 11 oct) o el admin sin dispositivo, el aviso
      quedaba «dado» sin haber llegado y no se intentaba nunca más.
    · Sin diferencias, la firma se LIMPIA (''): si después vuelven las mismas,
      se vuelve a avisar.
    Devuelve 'sin-cambios', 'enviado', 'limpiada', 'sin-envio' o 'error'.
    """
    jornadas, saques = partes_de_firma(tournament.get("unafut_aviso_firma"))
    if firma == (jornadas if cual == "jornadas" else saques):
        return "sin-cambios"
    nueva = juntar_firmas(firma, saques) if cual == "jornadas" else juntar_firmas(jornadas, firma)
    try:
        if firma:
            logger.warning(cuerpo)
            admins = [u["id"] for u in (supabase.table("users").select("id")
                                        .eq("is_admin", True).execute().data or [])]
            enviados = await broadcast_push_to_users(supabase, admins, titulo, cuerpo, url="/admin")
            if not enviados:
                logger.warning("El aviso «%s» no le llegó a ningún dispositivo del admin: "
                               "se reintenta en la próxima pasada", titulo)
                return "sin-envio"
        supabase.table("tournaments").update({"unafut_aviso_firma": nueva}).eq("id", tournament["id"]).execute()
        tournament["unafut_aviso_firma"] = nueva
        return "enviado" if firma else "limpiada"
    except Exception:  # noqa: BLE001
        logger.exception("No se pudo avisar al admin (%s)", titulo)
        return "error"


async def _avisar_jornadas(supabase, tournament, diferencias) -> str:
    """Push al admin global cuando cambian las diferencias con UNAFUT."""
    aplicadas = [d for d in diferencias if d["aplicada"]]
    trabadas = [d for d in diferencias if not d["aplicada"]]
    partes = []
    if aplicadas:
        partes.append(f"{len(aplicadas)} corregida(s) a la jornada oficial")
    if trabadas:
        def _tramo(d):
            origen = d["guardada"] if d.get("guardada") is not None else d["calculada"]
            destino = d["oficial"] if d.get("oficial") is not None else d["calculada"]
            return f"{d['partido']} J{origen}→J{destino}"
        partes.append(f"{len(trabadas)} SIN tocar (ya empezó o tiene ×2): "
                      + ", ".join(_tramo(d) for d in trabadas[:3]))
    cuerpo = "Jornadas distintas de UNAFUT: " + "; ".join(partes) + "."
    return await _aviso_con_firma(supabase, tournament, "jornadas", firma_de_diferencias(diferencias),
                                  "📅 Jornadas vs UNAFUT", cuerpo)


async def _avisar_saques(supabase, tournament, atrasados) -> str:
    """Push al admin global si un saque nuestro es más tarde que el de UNAFUT.

    Con el nuestro atrasado, el cierre de predicciones y el destape (T-15)
    llegarían tarde: las predicciones seguirían abiertas con el partido ya
    empezado. No se toca `kickoff_at`: no se sabe qué fuente acierta."""
    detalle = ", ".join(f"{a['partido']} (+{a['minutos']} min)" for a in atrasados[:3])
    cuerpo = (f"{len(atrasados)} partido(s) con el saque de ESPN más tarde que el de UNAFUT: "
              f"{detalle}. Las predicciones cierran con el de ESPN.")
    return await _aviso_con_firma(supabase, tournament, "saques", firma_de_saques(atrasados),
                                  "⏰ Saques vs UNAFUT", cuerpo)


async def _refrescar_unafut(supabase, tournament):
    """El refresco de UNAFUT con un tope TOTAL: si tarda, se sigue sin él."""
    try:
        async with httpx.AsyncClient(timeout=20.0) as client_unafut:
            return await asyncio.wait_for(
                refrescar_jornadas_oficiales(supabase, client_unafut, tournament),
                timeout=SEGUNDOS_PARA_REFRESCAR)
    except asyncio.TimeoutError:
        logger.warning("UNAFUT tardó más de %s s (torneo %s): se sigue sin el refresco",
                       SEGUNDOS_PARA_REFRESCAR, tournament.get("id"))
        return {"error": f"UNAFUT tardó más de {SEGUNDOS_PARA_REFRESCAR} s"}
    except Exception as exc:  # noqa: BLE001 - UNAFUT nunca tumba el sync
        return {"error": f"{type(exc).__name__}: {exc}"}


def _completar_datos_unafut(supabase, tournament: dict) -> dict:
    """El botón «Sync partidos» del panel manda el torneo con solo id, fuente y
    liga: sin esto no refrescaba UNAFUT nunca y, sin la firma guardada, repetía
    el aviso al admin en cada pulsación."""
    if "unafut_aviso_firma" in tournament:
        return tournament
    try:
        filas = (supabase.table("tournaments")
                 .select("unafut_league_slug, unafut_competition_id, unafut_jornadas_at, unafut_aviso_firma")
                 .eq("id", tournament["id"]).execute().data or [])
        if filas and isinstance(filas[0], dict):
            return {**tournament, **filas[0]}
    except Exception:  # noqa: BLE001 - sin esos datos, se sigue sin UNAFUT
        pass
    return tournament


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
                season_start, meses = win[0], _meses(win[0], win[1])
            else:
                meses = _ventanas(now, True)
        else:
            meses = _ventanas(now, False)
        for mes in meses:
            try:
                r = await client.get(
                    f"{ESPN_BASE}/{league}/scoreboard",
                    params={"dates": mes, "lang": "es", "region": "es"},
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
    # La jornada OFICIAL de UNAFUT, refrescada cada 6 h (ver jornadas_unafut).
    tournament = _completar_datos_unafut(supabase, tournament)
    info_unafut = None
    if hay_que_refrescar(tournament):
        info_unafut = await _refrescar_unafut(supabase, tournament)

    try:
        existing = (supabase.table("matches")
                    .select("id, external_id, status, home_goals_actual, away_goals_actual, "
                            "score_locked, kickoff_at, phase, home_team, away_team, "
                            "matchday, jornada_oficial, goes_to_penalties, penalties_winner_real")
                    .eq("tournament_id", tid).execute().data or [])
    except Exception:  # noqa: BLE001
        existing = (supabase.table("matches")
                    .select("id, external_id, status, home_goals_actual, away_goals_actual, "
                            "kickoff_at, phase, home_team, away_team")
                    .eq("tournament_id", tid).execute().data or [])
    snap = {m["external_id"]: m for m in existing if m.get("external_id")}

    history = [m for m in existing if m.get("phase") == "groups"]
    _assign_stages(parsed, history)
    diferencias_jornada = []
    avisos_unafut = {}
    if any(m.get("jornada_oficial") is not None for m in existing):
        diferencias_jornada = _usar_jornada_oficial(supabase, parsed, snap)
        # También sin diferencias: así se limpia la firma y, si vuelven, se avisa.
        avisos_unafut["jornadas"] = await _avisar_jornadas(supabase, tournament, diferencias_jornada)
    if info_unafut and "saques_atrasados" in info_unafut:
        avisos_unafut["saques"] = await _avisar_saques(supabase, tournament, info_unafut["saques_atrasados"])
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
        **_columnas_de_penales(p, snap.get(p["external_id"])),
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

    # Los terminados de esta tanda cuyas predicciones siguen SIN puntuar. Sin
    # esto, un puntaje que falla una vez no se reintenta jamás: la pasada
    # siguiente ve el partido ya `finished` y sin cambios, y lo salta.
    finalizados = [idmap[p["external_id"]] for p in parsed
                   if p["status"] == "finished"
                   and p["external_id"] not in frozen_ids
                   and idmap.get(p["external_id"])]
    congelados = congelados_terminados(snap, frozen_ids)
    pendientes = partidos_sin_puntuar(supabase, finalizados + congelados)

    scored = 0
    fallos = []
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
                # …o ESPN acaba de decir quién pasó por penales.
                or _penales_cambiaron(p, old)
                # …o quedó a medio puntuar en una corrida anterior.
                or mid in pendientes
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
            except Exception as exc:  # noqa: BLE001
                # NO se traga. Tragárselo fue lo que volvió invisible el fallo
                # durante meses; ahora sale en la respuesta del sync y el
                # partido se reintenta solo en la pasada siguiente, porque sus
                # predicciones siguen sin puntuar.
                fallos.append(f"match {mid}: {exc}")

    # Los congelados no pasan por el bucle de arriba (ESPN no los pisa), pero si
    # su puntaje quedó a medias se completa acá, con el mismo motor.
    for mid in sorted(set(congelados) & pendientes):
        try:
            await calculate_and_update_scores(supabase, mid)
            scored += 1
        except Exception as exc:  # noqa: BLE001
            fallos.append(f"match {mid}: {exc}")

    # Recalcular medallas de las quinielas de este torneo si hubo puntaje nuevo.
    if scored:
        for lg in (supabase.table("leagues").select("id").eq("tournament_id", tid).execute().data or []):
            try:
                supabase.rpc("recompute_league_badges", {"p_league_id": lg["id"]}).execute()
            except Exception:  # noqa: BLE001
                pass

    # Limpieza: si acotamos a la temporada actual, quitar los partidos de
    # temporadas anteriores que hubieran quedado cargados (p. ej. la Clausura pasada).
    #
    # SOLO LOS QUE NADIE PREDIJO (B11). Antes borraba TODO lo anterior a
    # `season_start` y además las predicciones a mano. La liga tica corre
    # temporada tras temporada sobre el MISMO `tournament_id`: el día que ESPN
    # cambie de temporada (medido: la actual va de julio 2026 a julio 2027),
    # pulsar «Sync partidos» habría borrado la temporada entera con todas sus
    # predicciones — el historial, las medallas y los puntos de una quiniela
    # por plata. Un partido con predicciones es historia, no basura. Hoy borraría
    # 0 (comprobado); esto es para julio de 2027.
    removed, kept = 0, 0
    limpieza_error = None
    if full and season_start is not None:
        try:
            cutoff = season_start.isoformat()
            old = (supabase.table("matches").select("id")
                   .eq("tournament_id", tid).lt("kickoff_at", cutoff).execute().data or [])
            old_ids = [m["id"] for m in old]
            borrables = partidos_sin_predicciones(supabase, old_ids)
            if borrables:
                supabase.table("matches").delete().in_("id", borrables).execute()
            removed, kept = len(borrables), len(old_ids) - len(borrables)
        except Exception as exc:  # noqa: BLE001
            limpieza_error = str(exc)

    salida = {"tournament_id": tid, "matches": len(rows), "scored": scored,
              "removed_old": removed, "kept_old_with_predictions": kept,
              "cleanup_error": limpieza_error, "scoring_errors": fallos}
    # Lo de UNAFUT va en la respuesta, que queda en net._http_response: los
    # registros de Vercel duran una hora y era el único rastro de un refresco
    # que fallaba o de un aviso que no salía.
    if info_unafut is not None:
        salida["unafut"] = info_unafut
    if diferencias_jornada:
        salida["jornadas_vs_unafut"] = diferencias_jornada
    if avisos_unafut:
        salida["avisos_unafut"] = avisos_unafut
    return salida


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
             .select("id, external_ref, source, status, unafut_league_slug, "
                     "unafut_competition_id, unafut_jornadas_at, unafut_aviso_firma")
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
