import asyncio
import base64
import json
import logging
import os
import re

from pywebpush import webpush, WebPushException

logger = logging.getLogger(__name__)

# La llave privada VAPID viene de una env var (recomendado en serverless, donde
# no hay archivos persistentes) o de un archivo local como respaldo.
_VAPID_PRIVATE_KEY_ENV = os.getenv("VAPID_PRIVATE_KEY", "").strip()
VAPID_CLAIMS = {"sub": os.getenv("VAPID_SUBJECT", "mailto:admin@quinielamundialista.com")}

# La llave PÚBLICA con la que el navegador se suscribe. Tiene que ser la misma
# que `VAPID_PUBLIC_KEY` de `frontend/src/lib/notificaciones.js` (lo ata una
# prueba): si la privada del backend no es su pareja, el proveedor rechaza cada
# envío aunque la llave se lea bien.
VAPID_PUBLIC_KEY_ESPERADA = (
    "BEZacx8-hHDBW6kekpy-K-ZBU4LRHttGOK32Bm5IsAGCkt_lhSGKaXpmhRJCQh3voZnWCHS7gv52_jCqkgP_4DQ"
)

_vapid_cache = None
_vapid_estado = None


def cargar_vapid(texto: str):
    """Lee la llave privada en CUALQUIERA de los formatos en que suele copiarse.

    POR QUÉ (11 oct 2026): el backend escribía la variable a un archivo y se lo
    pasaba a pywebpush, que desde un archivo solo entiende PEM o DER. En
    producción la variable tiene otro formato (casi seguro la llave «cruda» de
    32 bytes en base64url que genera `web-push`, la misma que usaba la edge
    function vieja) y CADA envío fallaba con «Could not deserialize key data»:
    el resumen de las 6 am del 11 oct salió para 17 personas con
    `enviados: 0`. Acepta:
      · PEM, con saltos reales, con «\\n» literales o aplastado en una línea;
      · la llave cruda de 32 bytes (base64url, como la da `web-push`);
      · DER en base64 o base64url.
    Lanza si no es ninguna.
    """
    from py_vapid import Vapid  # aquí: algunos entornos de prueba no lo traen

    k = (texto or "").strip().strip('"').strip("'")
    k = k.replace("\\r", "").replace("\\n", "\n").strip()
    if "-----BEGIN" in k:
        # El bloque de la LLAVE PRIVADA, no el primero: `openssl ecparam -genkey`
        # escribe antes un bloque «EC PARAMETERS» (revisión del 11 oct 2026).
        m = re.search(r"-----BEGIN ((?:EC |ENCRYPTED )?PRIVATE KEY)-----(.*?)-----END \1-----", k, re.S)
        if m:
            cuerpo = re.sub(r"\s+", "", m.group(2))
            lineas = "\n".join(cuerpo[i:i + 64] for i in range(0, len(cuerpo), 64))
            k = f"-----BEGIN {m.group(1)}-----\n{lineas}\n-----END {m.group(1)}-----\n"
        return Vapid.from_pem(k.encode())
    return Vapid.from_string(re.sub(r"\s+", "", k))


def publica_de(vapid) -> str:
    from cryptography.hazmat.primitives import serialization
    crudo = vapid.public_key.public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    return base64.urlsafe_b64encode(crudo).rstrip(b"=").decode()


def _get_vapid_private_key():
    """La llave para pywebpush (una instancia de Vapid), o None si no se puede.

    Se carga UNA vez por proceso. Si no se puede leer, cada envío falla igual
    que antes, pero ahora `estado_vapid()` lo dice con una palabra y el log
    lo anota una sola vez."""
    global _vapid_cache, _vapid_estado
    if _vapid_estado is not None:
        return _vapid_cache
    try:
        if _VAPID_PRIVATE_KEY_ENV:
            _vapid_cache = cargar_vapid(_VAPID_PRIVATE_KEY_ENV)
        elif os.path.isfile("private_key.pem"):
            from py_vapid import Vapid
            _vapid_cache = Vapid.from_file("private_key.pem")
        else:
            _vapid_estado = "sin-llave"
            logger.error("VAPID: falta VAPID_PRIVATE_KEY; ningún push puede salir")
            return None
    except Exception as exc:  # noqa: BLE001
        _vapid_cache, _vapid_estado = None, "ilegible"
        # Solo el TIPO de error: el mensaje podría traer un pedazo de la llave.
        logger.error("VAPID: VAPID_PRIVATE_KEY no se pudo leer (%s); ningún push puede salir",
                     type(exc).__name__)
        return None
    if publica_de(_vapid_cache) != VAPID_PUBLIC_KEY_ESPERADA:
        _vapid_estado = "no-coincide"
        logger.error("VAPID: la llave privada no es pareja de la pública del frontend; "
                     "los proveedores van a rechazar los envíos")
    else:
        _vapid_estado = "ok"
    return _vapid_cache


def estado_vapid() -> str:
    """'ok' | 'sin-llave' | 'ilegible' | 'no-coincide'. Nunca la llave."""
    _get_vapid_private_key()
    return _vapid_estado


# Cuánto guarda el proveedor un aviso para un dispositivo desconectado. El
# valor por defecto de pywebpush es 0: si el celular no estaba en línea en ese
# instante —lo normal a las 6 am— el aviso se descartaba, y el proveedor igual
# respondía 201 y quedaba como entregado (auditoría del 28 sep 2026).
TTL_POR_DEFECTO = 6 * 60 * 60
# Sin límite, un endpoint que no responde colgaba la corrida entera y los que
# venían después no recibían nada. pywebpush trae `timeout=None`.
TIMEOUT_ENVIO = 10


class FalloDePush:
    """Un envío que no salió, con su causa en una categoría CERRADA.

    POR QUÉ (revisión de Codex, 12 oct 2026): todo lo que no era 404/410 o
    llave vieja volvía como `False`, y la bitácora guardaba «push-fallido».
    Con una persona a la que el recordatorio no le llega, eso no decía si era
    Apple o Windows, un 400 o un tiempo agotado. La categoría es
    ``<proveedor>-http-<código>``, ``<proveedor>-timeout``,
    ``<proveedor>-red``, ``<proveedor>-sin-respuesta``, ``sin-llave-vapid`` o
    ``error-interno``: nunca el endpoint ni el mensaje del proveedor.

    Es FALSO como booleano, igual que el `False` que reemplaza: quien pregunte
    «¿salió?» con un `if` sigue recibiendo «no».
    """
    __slots__ = ("categoria",)

    def __init__(self, categoria: str):
        self.categoria = categoria

    def __bool__(self):
        return False

    def __repr__(self):
        return f"FalloDePush({self.categoria!r})"


def proveedor_de(endpoint) -> str:
    """'apple' | 'fcm' | 'mozilla' | 'wns' | 'otro'. Solo el servicio, nunca
    el endpoint (que identifica al dispositivo)."""
    host = origen_de(endpoint).split("://", 1)[-1].split(":", 1)[0]
    if host == "push.apple.com" or host.endswith(".push.apple.com"):
        return "apple"
    if host in ("fcm.googleapis.com", "android.googleapis.com"):
        return "fcm"
    if host == "push.services.mozilla.com" or host.endswith(".push.services.mozilla.com"):
        return "mozilla"
    if host.endswith(".notify.windows.com"):
        return "wns"
    return "otro"


def _categoria_de_excepcion(exc, proveedor: str) -> str:
    # Por la jerarquía y no con `import requests`: el pywebpush de algunos
    # entornos de prueba es un sustituto sin `requests`. `ConnectTimeout`
    # hereda de las dos: cuenta como tiempo agotado.
    nombres = {c.__name__ for c in type(exc).__mro__}
    if "Timeout" in nombres:
        return f"{proveedor}-timeout"
    if "ConnectionError" in nombres:
        return f"{proveedor}-red"
    return "error-interno"


def send_push_notification(subscription_info, payload_data, ttl: int = TTL_POR_DEFECTO):
    """Envía una notificación push web a una suscripción específica.

    `vapid_claims` va COPIADO en cada llamada: pywebpush le escribe `aud` y
    `exp` al diccionario que recibe si no los tiene, así que con el global
    compartido el `aud` del PRIMER proveedor quedaba fijo para todos los envíos
    siguientes del proceso. Los dispositivos de otro proveedor (Apple, WNS)
    rechazaban el JWT y no recibían nada. Reproducido con la librería real el
    28 sep 2026: tres proveedores, los tres con el `aud` de FCM.
    """
    llave = _get_vapid_private_key()
    if llave is None:
        return FalloDePush("sin-llave-vapid")
    proveedor = proveedor_de(subscription_info.get("endpoint"))
    try:
        webpush(
            subscription_info=subscription_info,
            data=json.dumps(payload_data),
            vapid_private_key=llave,
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
        clase = clasificar_rechazo_de_llave(ex.response, subscription_info.get("endpoint"))
        if clase:
            return clase
        if ex.response is None:
            return FalloDePush(f"{proveedor}-sin-respuesta")
        try:
            codigo = int(ex.response.status_code)
        except (TypeError, ValueError):
            return FalloDePush(f"{proveedor}-sin-respuesta")
        return FalloDePush(f"{proveedor}-http-{codigo}")
    except Exception as e:
        categoria = _categoria_de_excepcion(e, proveedor)
        if categoria == "error-interno":
            logger.error(f"Error inesperado enviando push: {e}")
        else:
            logger.error("Push sin entregar: %s", categoria)
        return FalloDePush(categoria)


# El proveedor dice que la suscripción se hizo con OTRA llave pública.
#
# POR QUÉ (vigésima auditoría, 11 oct 2026): el recordatorio del partido 293
# salió con `vapid: ok` y le llegó a 7 de 8 personas. Al octavo, un iPhone
# suscrito el 13 de junio, Apple le respondía 400 `VapidPkHashMismatch`; y dos
# Windows de junio daban 401 en WNS. Son dispositivos que se suscribieron con
# la llave de antes: no les va a llegar NADA nunca, pero la fila existe, así
# que el backend los reintentaba cada 15 minutos y la app no se enteraba.
LLAVE_VIEJA = "llave-vieja"            # Apple lo dice con todas las letras
LLAVE_RECHAZADA = "llave-rechazada"    # 401/403 fuera de Apple: probablemente lo mismo


def origen_de(endpoint) -> str:
    """El origen del servicio de push (``https://host``): es la unidad del
    `aud` del JWT, así que es la unidad en la que «nuestro JWT sirve» se puede
    comprobar. '' si no se puede leer."""
    from urllib.parse import urlparse
    try:
        u = urlparse(str(endpoint or ""))
    except ValueError:
        return ""
    if not u.scheme or not u.netloc:
        return ""
    return f"{u.scheme}://{u.netloc}".lower()


def _es_apple(endpoint) -> bool:
    return proveedor_de(endpoint) == "apple"


def clasificar_rechazo_de_llave(respuesta, endpoint=None):
    """``LLAVE_VIEJA`` / ``LLAVE_RECHAZADA`` si el rechazo es de llave, o False.

    SOLO con ``estado_vapid() == 'ok'``. Si la llave propia estuviera mal
    ('ilegible', 'no-coincide'), TODOS los proveedores rechazarían TODOS los
    envíos, y tomar eso por «dispositivos viejos» borraría la suscripción de
    todo el grupo. Con la llave propia confirmada, el que no calza es el
    dispositivo.

    APPLE solo cuenta con su 400 ``VapidPkHashMismatch``: es como Apple dice
    «esta suscripción es de otra llave». Su 403 (``BadJwtToken``,
    ``ExpiredJwtToken``) es SIEMPRE culpa de nuestro JWT —el `aud` cruzado del
    28 sep daba exactamente eso— y nunca dice nada del dispositivo (revisión
    de la vigésima auditoría).

    El 401/403 de los demás (WNS, FCM, Mozilla) es menos preciso: también lo
    da un JWT mal armado, y `estado_vapid` no lo ve. Por eso quien borra exige
    además que en el mismo envío algún dispositivo DEL MISMO ORIGEN haya
    aceptado el aviso (`borrables`).
    """
    if respuesta is None:
        return False
    estado = respuesta.status_code
    if estado == 400:
        try:
            cuerpo = respuesta.text or ""
        except Exception:  # noqa: BLE001
            cuerpo = ""
        clase = LLAVE_VIEJA if "VapidPkHashMismatch" in cuerpo else None
    elif estado in (401, 403) and not _es_apple(endpoint):
        clase = LLAVE_RECHAZADA
    else:
        clase = None
    if clase is None or estado_vapid() != "ok":
        return False
    return clase


def borrables(resultados) -> list:
    """Qué endpoints se borran después de un envío.

    resultados: [(endpoint, resultado de send_push_notification)]

    404/410 y el `VapidPkHashMismatch` de Apple se borran siempre. Un 401/403
    solo si en el MISMO envío otro dispositivo del MISMO ORIGEN (mismo
    servicio de push, que es la unidad del `aud`) recibió el aviso: eso prueba
    que nuestro JWT sirve PARA ESE servicio, así que el rechazo es del
    dispositivo.

    POR QUÉ POR ORIGEN Y NO POR ENVÍO (revisión de la vigésima auditoría): la
    primera versión aceptaba como prueba CUALQUIER entrega del envío, y eso no
    cubría el caso que la motivó. Con el `aud` cruzado del 28 sep, FCM recibía
    y Apple/WNS rechazaban: «alguien recibió» era cierto y se habrían borrado
    todas las de Apple y WNS (hoy, 9 de 13). Un fallo de JWT afecta a un
    servicio entero, así que la prueba tiene que ser de ese servicio.

    Costo, dicho: un Windows viejo cuyo host no tiene otro dispositivo que
    reciba no se borra acá y se sigue reintentando; lo migra el Hub al abrir
    (`llaveDistinta`). Perder la suscripción de todo un proveedor por un fallo
    nuestro no se arregla solo; un reintento de más, sí.
    """
    recibieron = {origen_de(e) for e, r in resultados if r is True}
    recibieron.discard("")
    fuera = []
    for endpoint, resultado in resultados:
        if resultado in ("expired", LLAVE_VIEJA):
            fuera.append(endpoint)
        elif resultado == LLAVE_RECHAZADA and origen_de(endpoint) in recibieron:
            fuera.append(endpoint)
    return fuera

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
    
    resultados = []
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
        resultados.append((sub["endpoint"], result))
        if result is True:
            success_count += 1

    # Limpiar endpoints muertos o suscritos con una llave vieja. Es
    # mantenimiento: si falla, el envío ya salió y no puede contarse como
    # fallido (la alerta de puntajes lo reintentaría a quien ya lo recibió).
    fuera = borrables(resultados)
    if fuera:
        try:
            supabase.table("push_subscriptions").delete().in_("endpoint", fuera).execute()
        except Exception:  # noqa: BLE001
            logger.exception("No se pudieron borrar %d suscripciones vencidas", len(fuera))

    return success_count


def motivo_de_fallo(endpoint, resultado) -> str:
    """La categoría de un dispositivo que no recibió y se conserva."""
    if isinstance(resultado, FalloDePush):
        return resultado.categoria
    if resultado == LLAVE_RECHAZADA:
        # 401/403 sin prueba de que nuestro JWT sirva en ese servicio: no se
        # borra (`borrables`), pero se dice qué fue.
        return f"{proveedor_de(endpoint)}-llave-rechazada"
    return "error-interno"


def usuarios_con_dispositivo(supabase, user_ids) -> set:
    """De estas personas, las que tienen AL MENOS un dispositivo registrado.

    El recordatorio del saque reclamaba también a quien no tiene ninguno: el
    envío no podía salir, el reclamo se cerraba como fallido
    («sin-dispositivo-vigente») y se volvía a reclamar cada 15 minutos hasta el
    cierre, sin llegarle nunca a nadie (medido el 10 oct 2026 con el partido
    295). Lanza si no se puede saber: quien llama decide seguir sin filtrar.
    """
    ids = sorted({u for u in user_ids if u})
    if not ids:
        return set()
    filas = (
        supabase.table("push_subscriptions").select("user_id")
        .in_("user_id", ids).execute().data or []
    )
    return {f["user_id"] for f in filas}


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
    resultados_por_usuario = {}
    for user_id, payload in mensajes.items():
        resultados_por_usuario[user_id] = []
        for sub in por_usuario.get(user_id, []):
            info = {
                "endpoint": sub["endpoint"],
                "keys": {"p256dh": sub["p256dh"], "auth": sub["auth"]},
            }
            resultado = await asyncio.to_thread(send_push_notification, info, payload, ttl=ttl)
            resultados_por_usuario[user_id].append((sub["endpoint"], resultado))
            if resultado is True:
                enviados += 1

    # Qué se borra se decide con el envío ENTERO a la vista: un 401/403 solo
    # cuenta como llave vieja si otro dispositivo del mismo servicio de push
    # sí recibió (`borrables`).
    fuera = set(borrables(
        [r for lista in resultados_por_usuario.values() for r in lista]))

    detalle = {}
    llave_vieja_total = 0
    fallos = {}
    for user_id, lista in resultados_por_usuario.items():
        suyo = {"enviados": 0, "fallidos": 0, "expirados": 0, "llave_vieja": 0,
                "sin_dispositivo": not lista}
        motivos = []
        for endpoint, resultado in lista:
            if resultado is True:
                suyo["enviados"] += 1
            elif resultado == "expired":
                suyo["expirados"] += 1
            elif endpoint in fuera:
                # Se borra: a esta persona no le queda ese dispositivo. Si era
                # el único, el reclamo se cierra como «sin-dispositivo-vigente»
                # y no se reintenta para siempre.
                suyo["llave_vieja"] += 1
                llave_vieja_total += 1
            else:
                suyo["fallidos"] += 1
                motivos.append(motivo_de_fallo(endpoint, resultado))
        if motivos:
            suyo["motivos"] = motivos
            for m in motivos:
                fallos[m] = fallos.get(m, 0) + 1
        detalle[user_id] = suyo

    # La limpieza de endpoints muertos es MANTENIMIENTO, no parte del envío.
    # Si fallaba, la excepción se llevaba puesto `por_usuario` y el endpoint no
    # llegaba a cerrar los reclamos: a los 5 minutos se reenviaba el aviso
    # también a quien SÍ lo recibió (quinta auditoría, hallazgo 4). Se deja
    # rastro y se sigue; la próxima vez que falle ese endpoint se reintenta.
    if fuera:
        try:
            supabase.table("push_subscriptions").delete().in_("endpoint", sorted(fuera)).execute()
        except Exception:  # noqa: BLE001
            logger.exception("No se pudieron borrar %d suscripciones vencidas", len(fuera))

    salida = {
        "enviados": enviados,
        "sin_dispositivo": len([u for u in ids if u not in por_usuario]),
    }
    if llave_vieja_total:
        salida["llave_vieja"] = llave_vieja_total
    # Por qué no salió lo que no salió, contado por categoría. Va en la
    # respuesta (queda en `net._http_response`) y en el log de la corrida.
    if fallos:
        salida["fallos"] = dict(sorted(fallos.items()))
    if detallado:
        salida["por_usuario"] = detalle
    return salida
