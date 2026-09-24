"""
Motor de puntuación de la Quiniela Mundialista.

Reglas (Modalidad Marcador):
- Marcador exacto (incluye empate exacto) → 3 pts.
- Aciertas quién gana o que es empate, pero no el marcador → 1 pt.
- Fallas el resultado (quién gana / empate) → 0 pts.
- Penales: si predijiste un ganador pero el partido fue a penales (empate en
  90'), 0 pts. Si predijiste empate y aciertas el ganador de penales, conservas
  el punto; si lo fallas, 0.

Modalidad Solo_Ganador:
- Aciertas el resultado → 1 pt; fallas → 0.

Modificador: comodín x2 → duplica los puntos ganados (1→2, 3→6).

Es el ÚNICO motor de puntaje: la copia en JS (lib/scoring.js) se borró el
21 sep 2026. Los casos que lo fijan están en shared/scoring_cases.json.
"""

import logging

from app.services.notifications import broadcast_push_to_users


def evaluate_prediction(
    pred: dict,
    home_actual: int,
    away_actual: int,
    goes_to_penalties: bool,
    penalties_winner_real: str,
    home_team: str = None,
    away_team: str = None,
    config: dict = None,
) -> int:

    # Puntajes configurables por quiniela (config del league). Por defecto 3/1.
    cfg = config or {}
    P_EXACT = cfg.get("points_exact", 3) if cfg.get("points_exact") is not None else 3
    P_CORRECT = cfg.get("points_correct", 1) if cfg.get("points_correct") is not None else 1

    pred_type = pred.get("prediction_type", "Marcador")
    home_pred = pred.get("home_goals_pred")
    away_pred = pred.get("away_goals_pred")
    penalties_winner_pred = pred.get("penalties_winner_pred")
    use_powerup = pred.get("use_powerup_x2", False)

    # Ganador real en tiempo regular
    if home_actual > away_actual:
        real_winner = "home"
    elif away_actual > home_actual:
        real_winner = "away"
    else:
        real_winner = "tie"

    points = 0

    if pred_type == "Marcador":
        if home_pred is None or away_pred is None:
            return 0

        if home_pred > away_pred:
            pred_winner = "home"
        elif away_pred > home_pred:
            pred_winner = "away"
        else:
            pred_winner = "tie"

        # Predijo un ganador y el partido se fue a penales (empate en 90'/120').
        # Si el equipo que eligió ganador es el que avanzó en penales, 1 punto
        # (acertó quién pasa). Si no, 0.
        if goes_to_penalties and pred_winner != "tie":
            pred_team = home_team if pred_winner == "home" else away_team
            points = P_CORRECT if (penalties_winner_real and pred_team and pred_team == penalties_winner_real) else 0
        else:
            if real_winner == "tie":
                if home_pred == home_actual and away_pred == away_actual:
                    points = P_EXACT  # empate exacto
                elif pred_winner == "tie":
                    points = P_CORRECT  # acierta empate, no el marcador
                else:
                    points = 0
                # Penales: el marcador del empate vale igual (3/1) aunque se
                # falle el penal. Acertar quién pasa suma +1 a la base, así el
                # comodín x2 también lo duplica.
                if (goes_to_penalties and pred_winner == "tie"
                        and penalties_winner_pred and penalties_winner_real
                        and penalties_winner_pred == penalties_winner_real):
                    points += 1
            else:
                if home_pred == home_actual and away_pred == away_actual:
                    points = P_EXACT  # marcador exacto
                elif pred_winner == real_winner:
                    points = P_CORRECT  # acierta el ganador, no el marcador
                else:
                    points = 0

    elif pred_type == "Solo_Ganador":
        pred_winner = "tie"
        if home_pred is not None and away_pred is not None:
            if home_pred > away_pred:
                pred_winner = "home"
            elif away_pred > home_pred:
                pred_winner = "away"

        if goes_to_penalties:
            if pred_winner == "tie":
                if penalties_winner_pred and penalties_winner_real and penalties_winner_pred == penalties_winner_real:
                    points = P_CORRECT
                else:
                    points = 0
            else:
                points = 0
        else:
            points = P_CORRECT if pred_winner == real_winner else 0

    # Comodín x2: duplica los puntos ganados (incluido el +1 de penales).
    if use_powerup:
        points *= 2

    return points


_log = logging.getLogger(__name__)


def firma_resultado(match: dict) -> str:
    """El resultado que se puntuó, en una cadena comparable.

    Goles, si se fue a penales y quién pasó: todo lo que el motor usa para
    decidir cuántos puntos da. Si cualquiera de las tres cosas cambia —una
    corrección del admin, el ganador de penales que llega después—, la firma
    guardada deja de coincidir y el partido se vuelve a puntuar.
    """
    return "{h}-{a}|{p}|{w}".format(
        h=match.get("home_goals_actual"),
        a=match.get("away_goals_actual"),
        p=1 if match.get("goes_to_penalties") else 0,
        w=match.get("penalties_winner_real") or "",
    )


def partidos_sin_puntuar(supabase, match_ids) -> set:
    """De los partidos TERMINADOS dados, los que el motor no terminó de puntuar.

    EL FALLO QUE ESTO ARREGLA: el puntaje no se reintentaba NUNCA. El sync solo
    llamaba al motor cuando el partido TRANSICIONABA a `finished`, y envolvía
    la llamada en un `except Exception: pass`. Si fallaba a mitad, la pasada
    siguiente veía el partido ya terminado y sin cambios → `changed = False` →
    esas predicciones se quedaban sin sus puntos para siempre, sin un error en
    ningún log.

    LA PRIMERA VERSIÓN DE ESTE ARREGLO NO PODÍA DISPARARSE NUNCA. Buscaba
    `points_earned IS NULL`, pero la columna nace en 0: medido el 22 sep 2026,
    **0 NULL en toda la tabla** y las 249 predicciones de partidos por jugar en
    0. Un puntaje que falla deja ceros que no se distinguen de un cero legítimo.
    Sus pruebas pasaban porque los datos de prueba usaban `None`, que la base
    real no produce — lo cazó la segunda auditoría de Astra.

    Ahora se compara la FIRMA del resultado que se puntuó (`matches.puntuado_con`,
    migración 88) contra el resultado actual. Así el cero sigue siendo un
    puntaje válido y la marca queda atada al resultado. Desde la migración 90
    la firma se escribe en la MISMA transacción que los puntos
    (`aplicar_puntaje`), así que no puede certificar una mezcla de dos
    recálculos.

    Si la columna no existe todavía (código desplegado antes que la migración)
    no revienta: devuelve vacío y lo dice en el log. La regla del proyecto:
    o sale la migración primero, o el código aguanta sin ella.
    """
    ids = [m for m in (match_ids or []) if m is not None]
    if not ids:
        return set()
    try:
        filas = (supabase.table("matches")
                 .select("id, status, home_goals_actual, away_goals_actual, "
                         "goes_to_penalties, penalties_winner_real, puntuado_con")
                 .in_("id", ids)
                 .execute().data or [])
    except Exception:  # noqa: BLE001
        _log.exception("No se pudo leer puntuado_con: sin reintento de puntaje en esta pasada")
        return set()
    return {f["id"] for f in filas
            if f.get("status") == "finished"
            and f.get("puntuado_con") != firma_resultado(f)}


PAGINA_PREDICCIONES = 1000


def _todas_las_predicciones(supabase, match_id: int) -> list:
    filas, desde = [], 0
    while True:
        pagina = (supabase.table("predictions").select("*")
                  .eq("match_id", match_id).order("id")
                  .range(desde, desde + PAGINA_PREDICCIONES - 1)
                  .execute().data or [])
        filas.extend(pagina)
        if len(pagina) < PAGINA_PREDICCIONES:
            return filas
        desde += PAGINA_PREDICCIONES


# Los mismos 3 días que `DIAS_HACIA_ATRAS` del sync y que
# `hay_puntajes_pendientes()` (migración 91). Más atrás es trabajo del admin.
DIAS_DE_RECUPERACION = 3


async def puntuar_pendientes(supabase) -> dict:
    """Puntúa los partidos que esperan puntaje, mirando la BASE.

    EL FALLO QUE ESTO ARREGLA (quinta auditoría, hallazgo 1): el reintento por
    firma vivía dentro del sync de ESPN, y a ese sync solo se llegaba si ESPN
    devolvía eventos y si alguna puerta del cron se abría. Un partido YA
    terminado cuyo puntaje falló no abría ninguna.

    Desde la migración 92 la lista sale de UNA función SQL,
    `partidos_pendientes_de_puntaje()`, la misma que usa la puerta del cron:
    terminados sin firma, cancelados/pospuestos sin anular, y partidos con una
    predicción agregada o corregida después de firmar; los 3 días se cuentan
    desde que el partido QUEDÓ pendiente, no desde su saque (sexta auditoría).

    Cada resultado se clasifica: `ok` es puntuado; `stale` queda pendiente y
    se reintenta; cualquier otra cosa es un ERROR, no un éxito (antes un
    `status: error` se contaba entre los puntuados).
    """
    try:
        filas = supabase.rpc("partidos_pendientes_de_puntaje", {}).execute().data or []
    except Exception as exc:  # noqa: BLE001 - p. ej. código desplegado antes que la 92
        _log.exception("No se pudo leer la lista de puntajes pendientes")
        return {"pendientes": 0, "puntuados": [], "reintentar": [],
                "errores": [{"match_id": None, "error": f"{type(exc).__name__}: {exc}"}]}
    pendientes = sorted({f if isinstance(f, int) else next(iter(f.values())) for f in filas})
    puntuados, reintentar, errores = [], [], []
    for mid in pendientes:
        try:
            r = await calculate_and_update_scores(supabase, mid)
        except Exception as exc:  # noqa: BLE001 - un partido no tapa a los demás
            _log.exception("Falló el puntaje pendiente del partido %s", mid)
            errores.append({"match_id": mid, "error": f"{type(exc).__name__}: {exc}"})
            continue
        estado = (r or {}).get("status")
        if estado == "ok":
            puntuados.append({"match_id": mid, "status": estado})
        elif estado == "stale":
            reintentar.append({"match_id": mid, "status": estado})
        else:
            errores.append({"match_id": mid, "error": (r or {}).get("message") or str(estado)})
    return {"pendientes": len(pendientes), "puntuados": puntuados,
            "reintentar": reintentar, "errores": errores}


def _aplicar_puntaje(supabase, match: dict, puntos: list) -> str:
    # `match` tiene que ser la foto con la que se CALCULARON los puntos: la base
    # compara ese resultado con el vigente. Releer el partido acá anularía todo
    # el control (hay una prueba que lo afirma).
    """Escribe los puntos Y la firma en UNA transacción (migración 90).

    Antes eran pasos sueltos —un UPDATE por predicción y después la firma— y
    dos recálculos cruzados podían dejar puntos calculados con un resultado
    viejo bajo la firma del nuevo: la firma certificaba una mezcla y el
    reintento dejaba de verla (cuarta auditoría, hallazgo 3).

    `aplicar_puntaje` bloquea el partido y SOLO escribe si el resultado con el
    que se calculó sigue siendo el suyo. Si no, responde «desactualizado» y no
    toca nada: sin firma, la pasada siguiente lo recalcula con el resultado
    nuevo. La firma se arma acá y la base compara columnas, para no escribir
    la misma fórmula dos veces.
    """
    r = supabase.rpc("aplicar_puntaje", {
        "p_match_id": match["id"],
        "p_home": match.get("home_goals_actual"),
        "p_away": match.get("away_goals_actual"),
        "p_penales": bool(match.get("goes_to_penalties")),
        "p_ganador_penales": match.get("penalties_winner_real"),
        "p_firma": firma_resultado(match),
        "p_puntos": puntos,
    }).execute()
    return r.data if isinstance(r.data, str) else str(r.data)


async def calculate_and_update_scores(supabase, match_id: int) -> dict:
    """
    Obtiene el resultado del partido, evalúa todas las predicciones
    usando las nuevas reglas y actualiza los puntos de los usuarios.
    """
    # 1. Obtener resultado real del partido
    match_response = (
        supabase.table("matches")
        .select("id, home_team, away_team, home_goals_actual, away_goals_actual, status, goes_to_penalties, penalties_winner_real")
        .eq("id", match_id)
        .single()
        .execute()
    )
    match = match_response.data

    if not match:
        return {"status": "error", "message": "Partido no encontrado"}

    # Partido no disputado (suspendido/cancelado/pospuesto): NO cuenta para el
    # puntaje. void_cancelled_match (SQL, SECURITY DEFINER) anula los puntos,
    # devuelve el comodín ×2 si lo usaron, y otorga un crédito de arrastre para
    # usarlo en la jornada/fase siguiente del torneo (decisión del grupo).
    if match.get("status") in ("cancelled", "postponed"):
        result = supabase.rpc("void_cancelled_match", {"p_match_id": match_id}).execute()
        data = result.data or {}
        return {
            "status": data.get("status", "ok"),
            "message": "Partido no disputado; puntos anulados y comodines devueltos/arrastrados",
            "predictions_zeroed": data.get("zeroed", 0),
            "powerups_refunded": data.get("refunded", 0),
        }

    if match.get("status") != "finished":
        return {"status": "error", "message": "Partido no finalizado o no encontrado"}

    # La FOTO del resultado con la que se calcula, y la MISMA que se manda a la
    # base para comprobar que no cambió mientras tanto (migración 90).
    match = dict(match)
    home_actual = match["home_goals_actual"]
    away_actual = match["away_goals_actual"]
    goes_to_penalties = match.get("goes_to_penalties", False)
    penalties_winner_real = match.get("penalties_winner_real")

    if home_actual is None or away_actual is None:
        return {"status": "error", "message": "El partido no tiene resultado válido"}

    # 2. Obtener TODAS las predicciones para este partido, paginando: PostgREST
    #    corta en 1.000 filas y la base ahora rechaza un lote incompleto.
    predictions = _todas_las_predicciones(supabase, match_id)

    if not predictions:
        # Se firma igual (por la misma vía atómica): si no, se reintentaría
        # en cada pasada del cron para siempre.
        resultado = _aplicar_puntaje(supabase, match, [])
        if resultado == "desactualizado":
            return {"status": "stale", "message": "El resultado cambió durante el cálculo"}
        if not str(resultado).startswith("ok:"):
            # Otra respuesta (p. ej. `incompleto` porque entró una predicción
            # entre la lectura y la escritura) NO es un éxito: sin firma, se
            # reintenta (sexta auditoría).
            raise RuntimeError(f"aplicar_puntaje({match_id}) respondió {resultado!r}")
        return {"status": "ok", "message": "No hay predicciones para este partido"}

    # 2b. Config de puntaje por quiniela (cada predicción pertenece a un league).
    league_ids = list({p.get("league_id") for p in predictions if p.get("league_id")})
    configs = {}
    if league_ids:
        lrows = (supabase.table("leagues")
                 .select("id, points_exact, points_correct")
                 .in_("id", league_ids).execute().data or [])
        configs = {r["id"]: r for r in lrows}

    puntos = []
    user_points_delta = {}

    # 3. Evaluar cada predicción con la config de su quiniela. Se mandan TODOS
    #    los puntos (absolutos, no diferencias): así no depende de lo que otra
    #    ejecución haya escrito mientras tanto. La base solo toca los que cambian.
    for pred in predictions:
        pts = evaluate_prediction(
            pred,
            home_actual,
            away_actual,
            goes_to_penalties,
            penalties_winner_real,
            match.get("home_team"),
            match.get("away_team"),
            config=configs.get(pred.get("league_id")),
        )
        # Con el marcador que se usó: la base comprueba que siga siendo el de la
        # predicción, igual que con el resultado del partido (migración 92).
        puntos.append({"id": pred["id"], "puntos": pts,
                       "h": pred.get("home_goals_pred"), "a": pred.get("away_goals_pred"),
                       "pw": pred.get("penalties_winner_pred"),
                       "x2": bool(pred.get("use_powerup_x2")),
                       # El tipo también cambia los puntos (migración 93).
                       "t": pred.get("prediction_type")})
        delta = pts - (pred.get("points_earned") or 0)
        if delta != 0:
            user_id = pred["user_id"]
            user_points_delta[user_id] = user_points_delta.get(user_id, 0) + delta

    # 4. Puntos y firma en UNA transacción, y solo si el resultado sigue siendo
    #    el que se usó para calcular (migración 90).
    resultado = _aplicar_puntaje(supabase, match, puntos)
    if resultado != "desactualizado" and not str(resultado).startswith("ok:"):
        # `incompleto` o `sin-partido`: no se escribió nada. Se lanza para que
        # quien llamó lo registre; sin firma, la pasada siguiente lo reintenta.
        raise RuntimeError(f"aplicar_puntaje({match_id}) respondió {resultado!r}")
    if resultado == "desactualizado":
        # El resultado cambió mientras se calculaba: no se escribió nada, y la
        # pasada siguiente lo recalcula con el nuevo. Tampoco se avisa a nadie.
        return {"status": "stale", "message": "El resultado cambió durante el cálculo; se recalcula en la próxima pasada"}
    try:
        actualizadas = int(str(resultado).split(":", 1)[1])
    except (IndexError, ValueError):
        actualizadas = 0

    # 5. users.total_points lo mantiene SOLA la base de datos (trigger
    #    recompute_user_total). Ya no lo tocamos aquí con deltas: ese patrón
    #    (leer-sumar-escribir) se pisaba con el sync del frontend bajo
    #    concurrencia ("lost update") y descuadraba los totales.
    updated_users = sum(1 for d in user_points_delta.values() if d != 0)

    # 6. Enviar notificaciones push a los usuarios que ganaron puntos
    users_with_positive_delta = [u for u, d in user_points_delta.items() if d > 0]
    if users_with_positive_delta:
        # Enviar push en background para no bloquear
        # Usamos await porque la función es async, pero idealmente se usaría BackgroundTasks en FastAPI
        # Para simplicidad lo haremos await
        await broadcast_push_to_users(
            supabase, 
            users_with_positive_delta, 
            title="¡Tus puntos se han actualizado!", 
            body=f"El partido {match_id} ha finalizado. Revisa tu posición en el ranking.",
            url="/ranking"
        )

    return {
        "status": "ok",
        "predictions_evaluated": len(predictions),
        "predictions_updated": actualizadas,
        "users_updated": updated_users,
    }
