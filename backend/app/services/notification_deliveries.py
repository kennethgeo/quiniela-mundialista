"""Reclamación persistente de recordatorios push.

La base arbitra quién puede enviar cada unidad. El backend solo manda lo que
la RPC devuelve en ``RETURNING``. Los errores guardados son categorías cerradas:
nunca se persiste el texto crudo de Web Push, que puede incluir endpoints o
detalles del dispositivo.
"""

import logging
from datetime import datetime, timedelta, timezone
from uuid import uuid4

logger = logging.getLogger(__name__)


TIPO_RECORDATORIO_SAQUE = "kickoff-45m"
# «Mandar el push a la quiniela» del panel de admin (vigésima auditoría): una
# vez por persona, quiniela y partido, la toque quien la toque y las veces que
# sea. La puerta del cron (`hay_avisos_por_reintentar`) filtra por el tipo del
# recordatorio, así que estas filas no la abren.
TIPO_RESUMEN_MANUAL = "resumen-manual"
MINUTOS_PARA_RECLAMO_VENCIDO = 5
HORAS_DE_REINTENTO = 2


class DeduplicacionNoDisponible(RuntimeError):
    """La migración 82 todavía no está aplicada o no llegó al schema cache."""


def _es_objeto_ausente(exc: Exception) -> bool:
    texto = str(exc).lower()
    return any(codigo in texto for codigo in (
        "pgrst202",       # función fuera del schema cache
        "pgrst205",       # tabla fuera del schema cache
        "42p01",          # undefined_table
        "42883",          # undefined_function
        "could not find the function",
        "could not find the table",
        'relation "public.notification_deliveries" does not exist',
    ))


def clave_entrega(entrega: dict) -> tuple[str, str, int]:
    return (str(entrega["user_id"]), str(entrega["league_id"]), int(entrega["match_id"]))


def seleccionar_candidatas(
    entregas: list[dict],
    ids_frescos: set[int],
    claves_reintento: set[tuple[str, str, int]],
) -> list[dict]:
    """No convierte un reintento puntual en un aviso nuevo para toda la liga."""
    return [
        entrega
        for entrega in entregas
        if int(entrega["match_id"]) in ids_frescos
        or clave_entrega(entrega) in claves_reintento
    ]


def reintentos_pendientes(supabase, ahora: datetime | None = None) -> set[tuple[str, str, int]]:
    """Claves fallidas o abandonadas que aún deben volver a competir.

    La RPC vuelve a validar membresía, predicción y cierre; esta lectura solo
    amplía la selección más allá de la ventana inicial.

    SOLO LAS DE LAS ÚLTIMAS ``HORAS_DE_REINTENTO`` y las más nuevas primero
    (vigésima auditoría). Las fallidas no se borran nunca, y la lectura las
    traía TODAS, sin orden y cortadas en 1000: el día que la historia pasara de
    1000 (con un VAPID roto son 8 por partido de Bundestica, una temporada), el
    corte podía dejar afuera justo las de hoy, sin ningún aviso. Un reintento
    solo sirve hasta 15 min antes del saque, y la fila nace entre 60 y 45 min
    antes, así que nada útil tiene más de una hora sin tocarse.
    """
    ahora = ahora or datetime.now(timezone.utc)
    vencido_antes = ahora - timedelta(minutes=MINUTOS_PARA_RECLAMO_VENCIDO)
    desde = ahora - timedelta(hours=HORAS_DE_REINTENTO)
    try:
        filas = (
            supabase.table("notification_deliveries")
            .select("user_id,league_id,match_id,status,claimed_at")
            .eq("tipo", TIPO_RECORDATORIO_SAQUE)
            .or_(f"status.eq.failed,and(status.eq.claimed,claimed_at.lt.{vencido_antes.isoformat()})")
            .gt("updated_at", desde.isoformat())
            .order("updated_at", desc=True)
            .limit(1000)
            .execute()
            .data
            or []
        )
    except Exception as exc:  # el despliegue puede preceder a la migración
        if _es_objeto_ausente(exc):
            raise DeduplicacionNoDisponible from exc
        raise

    return {
        (str(f["user_id"]), str(f["league_id"]), int(f["match_id"]))
        for f in filas
    }


def reclamar_entregas(
    supabase, entregas: list[dict], tipo: str = TIPO_RECORDATORIO_SAQUE,
) -> tuple[list[dict], dict[str, str]]:
    """Reclama en una sola transacción y devuelve solo las filas ganadas.

    EL TOKEN ES POR PERSONA, no por unidad, y es deliberado: el push sale UNO
    por persona aunque le falten tres partidos, así que el cierre tiene que
    poder marcar sus tres filas juntas con el resultado de ese único envío.
    """
    if not entregas:
        return [], {}

    tokens_por_usuario: dict[str, str] = {}
    payload = []
    por_clave = {}
    for entrega in entregas:
        uid = str(entrega["user_id"])
        token = tokens_por_usuario.setdefault(uid, str(uuid4()))
        payload.append({
            "user_id": uid,
            "league_id": str(entrega["league_id"]),
            "match_id": int(entrega["match_id"]),
            "claim_token": token,
        })
        por_clave[clave_entrega(entrega)] = entrega

    # UNA sola llamada, a propósito (revisión del 11 oct 2026): partir el lote
    # dejaba, si fallaba la segunda parte, los reclamos de la primera abiertos
    # y reenviados a los 5 minutos. Con ~24 personas no se llega al tope de
    # 1000 de la base; si algún día se llega, la llamada falla y el endpoint
    # cae al envío sin deduplicar, que es la decisión ya tomada para ese caso.
    try:
        respuesta = supabase.rpc("claim_notification_deliveries", {
            "p_entregas": payload,
            "p_tipo": tipo,
        }).execute()
    except Exception as exc:
        if _es_objeto_ausente(exc):
            raise DeduplicacionNoDisponible from exc
        raise

    reclamadas = []
    for fila in respuesta.data or []:
        clave = (
            str(fila["claimed_user_id"]),
            str(fila["claimed_league_id"]),
            int(fila["claimed_match_id"]),
        )
        entrega = por_clave.get(clave)
        if entrega is not None:
            reclamadas.append(entrega)

    usuarios_reclamados = {str(e["user_id"]) for e in reclamadas}
    return reclamadas, {
        uid: token for uid, token in tokens_por_usuario.items() if uid in usuarios_reclamados
    }


def finalizar_reclamo(
    supabase,
    claim_token: str,
    *,
    entregado: bool,
    error: str | None = None,
    ahora: datetime | None = None,
) -> None:
    """Cierra solo las filas que todavía pertenecen a este trabajador."""
    ahora = ahora or datetime.now(timezone.utc)
    cambios = {
        "status": "delivered" if entregado else "failed",
        "delivered_at": ahora.isoformat() if entregado else None,
        "last_error": error,
        "updated_at": ahora.isoformat(),
    }
    (
        supabase.table("notification_deliveries")
        .update(cambios)
        .eq("claim_token", claim_token)
        .eq("status", "claimed")
        .execute()
    )


def resultado_de_entrega(estado: dict | None) -> tuple[bool, str | None]:
    """Traduce resultados por dispositivo a un estado persistible y acotado.

    ACEPTA None Y {} A PROPÓSITO. Si el envío no dejó detalle para esa persona
    —porque el reparto cambió, o porque falló antes de registrarlo— hay que
    poder cerrar la fila igual. Dar por bueno lo contrario dejaría el reclamo
    abierto, vencería a los 5 minutos y el aviso saldría DOS veces, que es
    justo lo que esta bitácora existe para evitar.
    """
    estado = estado or {}
    # Un dispositivo suscrito con la llave vieja se BORRA igual que uno vencido
    # (vigésima auditoría): cuenta como dispositivo perdido, no como fallo a
    # reintentar. Si era el único, «sin-dispositivo-vigente».
    perdidos = estado.get("expirados", 0) + estado.get("llave_vieja", 0)
    if estado.get("enviados", 0) > 0:
        if estado.get("fallidos", 0) or perdidos:
            return True, "entrega-parcial"
        return True, None
    if estado.get("fallidos", 0):
        # Le queda al menos un dispositivo que falló por otra causa: ese sí
        # merece el reintento.
        return False, "push-fallido"
    if estado.get("sin_dispositivo") or perdidos:
        return False, "sin-dispositivo-vigente"
    return False, "push-fallido"


def cerrar_reclamos(
    supabase,
    tokens: dict[str, str],
    por_usuario: dict | None,
    ahora: datetime | None = None,
) -> dict[str, int]:
    """Cierra el reclamo de cada persona con lo que de verdad le pasó.

    ESTO NO ES OPCIONAL Y POR ESO VIVE ACÁ, probado. Si el cierre revienta
    después de que el push salió, las filas quedan `claimed`, vencen a los
    cinco minutos y el aviso se manda OTRA VEZ: exactamente el duplicado que
    esta bitácora existe para evitar. Dos defensas, las dos con prueba:

      · `por_usuario` se lee con `.get()`. Una persona sin detalle —porque el
        envío no lo registró, o porque el reparto cambió— no puede tumbar el
        cierre con un KeyError.
      · cada persona va en su propio `try`. El fallo de una no deja abiertas
        las de las demás.

    Nunca se afirma que algo NO salió: si el cierre falla, el push pudo haber
    salido igual, así que solo se registra.
    """
    por_usuario = por_usuario or {}
    cerrados, fallidos = 0, 0
    for user_id, token in tokens.items():
        try:
            entregado, error = resultado_de_entrega(por_usuario.get(user_id))
            finalizar_reclamo(supabase, token, entregado=entregado, error=error, ahora=ahora)
            cerrados += 1
        except Exception:
            fallidos += 1
            logger.exception("No se pudo cerrar un reclamo de notificación")
    return {"cerrados": cerrados, "sin_cerrar": fallidos}
