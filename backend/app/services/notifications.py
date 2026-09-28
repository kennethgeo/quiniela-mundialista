import asyncio
import json
import logging
import os
import tempfile

from pywebpush import webpush, WebPushException

logger = logging.getLogger(__name__)

# La llave privada VAPID puede venir de una env var (recomendado en serverless,
# donde no hay archivos persistentes) o de un archivo local como respaldo.
_VAPID_PRIVATE_KEY_ENV = os.getenv("VAPID_PRIVATE_KEY", "").strip()
VAPID_CLAIMS = {"sub": os.getenv("VAPID_SUBJECT", "mailto:admin@quinielamundialista.com")}

_vapid_key_path_cache = None


def _get_vapid_private_key():
    """Ruta a la llave privada VAPID. Prioriza VAPID_PRIVATE_KEY (contenido PEM)."""
    global _vapid_key_path_cache
    if _VAPID_PRIVATE_KEY_ENV:
        if _vapid_key_path_cache is None:
            tf = tempfile.NamedTemporaryFile(delete=False, suffix=".pem", mode="w")
            # Las env vars suelen guardar los saltos de línea como '\n' literal
            tf.write(_VAPID_PRIVATE_KEY_ENV.replace("\\n", "\n"))
            tf.close()
            _vapid_key_path_cache = tf.name
        return _vapid_key_path_cache
    return "private_key.pem"


# Cuánto guarda el proveedor un aviso para un dispositivo desconectado. El
# valor por defecto de pywebpush es 0: si el celular no estaba en línea en ese
# instante —lo normal a las 6 am— el aviso se descartaba, y el proveedor igual
# respondía 201 y quedaba como entregado (auditoría del 28 sep 2026).
TTL_POR_DEFECTO = 6 * 60 * 60
# Sin límite, un endpoint que no responde colgaba la corrida entera y los que
# venían después no recibían nada. pywebpush trae `timeout=None`.
TIMEOUT_ENVIO = 10


def send_push_notification(subscription_info, payload_data, ttl: int = TTL_POR_DEFECTO):
    """Envía una notificación push web a una suscripción específica.

    `vapid_claims` va COPIADO en cada llamada: pywebpush le escribe `aud` y
    `exp` al diccionario que recibe si no los tiene, así que con el global
    compartido el `aud` del PRIMER proveedor quedaba fijo para todos los envíos
    siguientes del proceso. Los dispositivos de otro proveedor (Apple, WNS)
    rechazaban el JWT y no recibían nada. Reproducido con la librería real el
    28 sep 2026: tres proveedores, los tres con el `aud` de FCM.
    """
    try:
        webpush(
            subscription_info=subscription_info,
            data=json.dumps(payload_data),
            vapid_private_key=_get_vapid_private_key(),
            vapid_claims=dict(VAPID_CLAIMS),
            ttl=ttl,
            timeout=TIMEOUT_ENVIO,
        )
        return True
    except WebPushException as ex:
        # Si el endpoint ya no existe (410) o no está autorizado (404), deberíamos borrarlo
        logger.error(f"WebPush Error: {repr(ex)}")
        # `is not None`, NUNCA la verdad de la respuesta: una requests.Response
        # es FALSA cuando su estado es de error, así que `if ex.response and…`
        # no reconocía jamás un 404 ni un 410 y los endpoints muertos se
        # quedaban para siempre (cuarta auditoría, hallazgo 4).
        if ex.response is not None and ex.response.status_code in (404, 410):
            return "expired"
        return False
    except Exception as e:
        logger.error(f"Error inesperado enviando push: {e}")
        return False

async def broadcast_push_to_users(supabase, user_ids: list, title: str, body: str, url: str = "/"):
    """Envía un push a todos los dispositivos de los usuarios especificados."""
    if not user_ids:
        return

    # Obtener suscripciones de la BD
    response = supabase.table("push_subscriptions").select("*").in_("user_id", user_ids).execute()
    subs = response.data
    
    if not subs:
        return
        
    payload = {
        "title": title,
        "body": body,
        "url": url
    }
    
    expired_endpoints = []
    success_count = 0
    
    for sub in subs:
        sub_info = {
            "endpoint": sub["endpoint"],
            "keys": {
                "p256dh": sub["p256dh"],
                "auth": sub["auth"]
            }
        }
        
        # En un hilo: `webpush` es síncrono y el backend corre con un solo
        # worker; un proveedor lento congelaba sync, puntaje y API a la vez.
        result = await asyncio.to_thread(send_push_notification, sub_info, payload)
        if result == "expired":
            expired_endpoints.append(sub["endpoint"])
        elif result is True:
            success_count += 1
            
    # Limpiar endpoints expirados
    if expired_endpoints:
        supabase.table("push_subscriptions").delete().in_("endpoint", expired_endpoints).execute()
        
    return success_count


async def enviar_push_personalizado(supabase, mensajes: dict, detallado: bool = False,
                                    ttl: int = TTL_POR_DEFECTO):
    """Manda un push DISTINTO a cada persona.

    broadcast_push_to_users manda el mismo texto a todos, y para el resumen
    diario eso no sirve: a quien le faltan tres predicciones hay que decirle
    otra cosa que a quien ya las hizo todas. Las suscripciones se leen UNA vez
    para todos, no una por persona.

    mensajes: {user_id: {"title": str, "body": str, "url": str}}

    Con ``detallado=True`` agrega ``por_usuario``: qué le pasó a CADA persona.
    Lo necesita la bitácora de entregas (migración 82) para cerrar el reclamo
    con un estado cierto — el total agregado no sirve, porque un envío puede
    haber salido para unos y no para otros.
    """
    if not mensajes:
        vacio = {"enviados": 0, "sin_dispositivo": 0}
        return {**vacio, "por_usuario": {}} if detallado else vacio

    ids = list(mensajes.keys())
    subs = (
        supabase.table("push_subscriptions").select("*").in_("user_id", ids).execute().data
        or []
    )

    por_usuario = {}
    for s in subs:
        por_usuario.setdefault(s["user_id"], []).append(s)

    enviados = 0
    expirados = []
    detalle = {}
    for user_id, payload in mensajes.items():
        suscripciones = por_usuario.get(user_id, [])
        suyo = {"enviados": 0, "fallidos": 0, "expirados": 0,
                "sin_dispositivo": not suscripciones}
        for sub in suscripciones:
            info = {
                "endpoint": sub["endpoint"],
                "keys": {"p256dh": sub["p256dh"], "auth": sub["auth"]},
            }
            resultado = await asyncio.to_thread(send_push_notification, info, payload, ttl=ttl)
            if resultado == "expired":
                expirados.append(sub["endpoint"])
                suyo["expirados"] += 1
            elif resultado is True:
                enviados += 1
                suyo["enviados"] += 1
            else:
                suyo["fallidos"] += 1
        detalle[user_id] = suyo

    # La limpieza de endpoints muertos es MANTENIMIENTO, no parte del envío.
    # Si fallaba, la excepción se llevaba puesto `por_usuario` y el endpoint no
    # llegaba a cerrar los reclamos: a los 5 minutos se reenviaba el aviso
    # también a quien SÍ lo recibió (quinta auditoría, hallazgo 4). Se deja
    # rastro y se sigue; la próxima vez que falle ese endpoint se reintenta.
    if expirados:
        try:
            supabase.table("push_subscriptions").delete().in_("endpoint", expirados).execute()
        except Exception:  # noqa: BLE001
            logger.exception("No se pudieron borrar %d suscripciones vencidas", len(expirados))

    salida = {
        "enviados": enviados,
        "sin_dispositivo": len([u for u in ids if u not in por_usuario]),
    }
    if detallado:
        salida["por_usuario"] = detalle
    return salida
