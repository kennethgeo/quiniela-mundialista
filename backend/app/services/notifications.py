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


def send_push_notification(subscription_info, payload_data):
    """Envía una notificación push web a una suscripción específica."""
    try:
        webpush(
            subscription_info=subscription_info,
            data=json.dumps(payload_data),
            vapid_private_key=_get_vapid_private_key(),
            vapid_claims=VAPID_CLAIMS
        )
        return True
    except WebPushException as ex:
        # Si el endpoint ya no existe (410) o no está autorizado (404), deberíamos borrarlo
        logger.error(f"WebPush Error: {repr(ex)}")
        if ex.response and ex.response.status_code in [404, 410]:
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
        
        result = send_push_notification(sub_info, payload)
        if result == "expired":
            expired_endpoints.append(sub["endpoint"])
        elif result is True:
            success_count += 1
            
    # Limpiar endpoints expirados
    if expired_endpoints:
        supabase.table("push_subscriptions").delete().in_("endpoint", expired_endpoints).execute()
        
    return success_count


async def enviar_push_personalizado(supabase, mensajes: dict, detallado: bool = False):
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
            resultado = send_push_notification(info, payload)
            if resultado == "expired":
                expirados.append(sub["endpoint"])
                suyo["expirados"] += 1
            elif resultado is True:
                enviados += 1
                suyo["enviados"] += 1
            else:
                suyo["fallidos"] += 1
        detalle[user_id] = suyo

    if expirados:
        supabase.table("push_subscriptions").delete().in_("endpoint", expirados).execute()

    salida = {
        "enviados": enviados,
        "sin_dispositivo": len([u for u in ids if u not in por_usuario]),
    }
    if detallado:
        salida["por_usuario"] = detalle
    return salida
