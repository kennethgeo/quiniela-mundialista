"""Un dispositivo suscrito con la llave VAPID de antes se borra (vigésima auditoría).

LO QUE PASÓ (11 oct 2026, 22:00 UTC): el recordatorio del partido 293 salió
con `vapid: ok` y le llegó a 7 de 8 personas. Al octavo, un iPhone suscrito el
13 de junio, Apple le respondió 400 `{"reason":"VapidPkHashMismatch"}`; y dos
Windows de junio daban 401 en WNS. Son dispositivos suscritos con la llave
pública de antes: no les va a llegar nada NUNCA. Pero la fila existía, así que
el backend los reintentaba cada 15 minutos y la app no se enteraba.

LA SALVAGUARDA que importa tanto como el arreglo: si la llave PROPIA estuviera
mal, todos los proveedores rechazarían todo, y tomarlo por «dispositivos
viejos» borraría la suscripción del grupo entero. Por eso solo se borra con
`estado_vapid() == 'ok'`, y un 401/403 (menos preciso que el mensaje de Apple)
solo si en el mismo envío recibió otro dispositivo DEL MISMO SERVICIO de push.
El 403 de Apple no cuenta nunca: es su forma de decir «tu JWT está mal».

Se usa la librería REAL: se intercepta solo la petición HTTP y se responde con
una `requests.Response` de verdad, con el estado y el cuerpo que dieron Apple y
WNS en producción.
"""
import asyncio
import base64
import os
import sys
from pathlib import Path

import pytest
import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

pywebpush = pytest.importorskip("pywebpush")
if not hasattr(pywebpush, "WebPusher"):
    pytest.skip("pywebpush es un sustituto, no la librería", allow_module_level=True)

from cryptography.hazmat.primitives import serialization  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import ec  # noqa: E402
from py_vapid import Vapid  # noqa: E402

import app.services.notifications as notif  # noqa: E402
from app.services.notification_deliveries import resultado_de_entrega  # noqa: E402

FCM = "https://fcm.googleapis.com/fcm/send/"
APPLE = "https://web.push.apple.com/"
WNS = "https://wns2-par02p.notify.windows.com/w/?token="

# Lo que respondió cada proveedor en producción.
RESPUESTAS = {
    "apple-vieja": (400, '{"reason":"VapidPkHashMismatch"}'),
    "apple-otro-400": (400, '{"reason":"BadDeviceToken"}'),
    "wns-vieja": (401, ""),
    "fcm-403": (403, "the key in the authorization header does not correspond"),
    # Lo que Apple responde cuando el JWT está mal (el `aud` cruzado del 28 sep).
    "apple-403": (403, '{"reason":"BadJwtToken"}'),
    "ok": (201, ""),
}


def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def _claves():
    clave = ec.generate_private_key(ec.SECP256R1()).public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    return _b64(clave), _b64(os.urandom(16))


def _respuesta(estado, cuerpo):
    r = requests.Response()
    r.status_code = estado
    r._content = cuerpo.encode()
    r.reason = "x"
    return r


@pytest.fixture
def proveedor(monkeypatch):
    """Intercepta el POST de pywebpush. El endpoint termina en la clave de
    `RESPUESTAS` que ese dispositivo tiene que recibir."""
    monkeypatch.setattr(notif, "_vapid_cache", _vapid_nueva())
    monkeypatch.setattr(notif, "_vapid_estado", "ok")
    monkeypatch.setattr(notif, "VAPID_CLAIMS", {"sub": "mailto:prueba@example.com"})
    pedidos = []

    def post(url, data=None, headers=None, timeout=None, **_k):
        pedidos.append(url)
        clave = url.rsplit("/", 1)[-1].rsplit("=", 1)[-1]
        return _respuesta(*RESPUESTAS[clave])
    monkeypatch.setattr(pywebpush.requests, "post", post)
    return pedidos


def _vapid_nueva():
    v = Vapid()
    v.generate_keys()
    return v


def _sub(endpoint):
    p256dh, auth = _claves()
    return {"endpoint": endpoint, "keys": {"p256dh": p256dh, "auth": auth}}


# ── send_push_notification ──────────────────────────────────────────────────

def _fallo(resultado):
    """La categoría de un envío fallido. Un fallo sigue siendo FALSO como
    booleano (revisión de Codex): quien pregunte «¿salió?» recibe «no»."""
    assert isinstance(resultado, notif.FalloDePush), resultado
    assert not resultado
    return resultado.categoria

def test_apple_con_la_llave_vieja_se_reconoce(proveedor):
    assert notif.send_push_notification(_sub(APPLE + "apple-vieja"), {"t": 1}) == notif.LLAVE_VIEJA


def test_otro_400_de_apple_no_es_llave_vieja(proveedor):
    """Un 400 cualquiera es un fallo, no un dispositivo para borrar."""
    assert _fallo(notif.send_push_notification(_sub(APPLE + "apple-otro-400"), {"t": 1})) == "apple-http-400"


@pytest.mark.parametrize("endpoint", [WNS + "wns-vieja", FCM + "fcm-403"])
def test_401_y_403_son_rechazo_de_llave(proveedor, endpoint):
    assert notif.send_push_notification(_sub(endpoint), {"t": 1}) == notif.LLAVE_RECHAZADA


def test_el_403_de_apple_no_es_llave(proveedor):
    """Apple marca la llave vieja con 400 `VapidPkHashMismatch`. Su 403
    (`BadJwtToken`/`ExpiredJwtToken`) es culpa de NUESTRO JWT."""
    assert _fallo(notif.send_push_notification(_sub(APPLE + "apple-403"), {"t": 1})) == "apple-http-403"


@pytest.mark.parametrize("estado", ["no-coincide", "ilegible"])
@pytest.mark.parametrize("endpoint", [APPLE + "apple-vieja", WNS + "wns-vieja", FCM + "fcm-403"])
def test_con_la_llave_PROPIA_mal_nada_es_llave_vieja(proveedor, monkeypatch, estado, endpoint):
    """Si la llave nuestra no es la del frontend, TODOS rechazan: eso no dice
    nada de los dispositivos."""
    monkeypatch.setattr(notif, "_vapid_estado", estado)
    esperado = {"apple-vieja": "apple-http-400", "wns-vieja": "wns-http-401", "fcm-403": "fcm-http-403"}
    assert _fallo(notif.send_push_notification(_sub(endpoint), {"t": 1})) == next(
        v for k, v in esperado.items() if endpoint.endswith(k))


# ── el envío entero: qué se borra y qué se informa ──────────────────────────

class _Base:
    def __init__(self, subs):
        self.subs, self.borrados = subs, []

    def table(self, nombre):
        assert nombre == "push_subscriptions"
        return self

    def select(self, *_a):
        self._op = "select"
        return self

    def delete(self):
        self._op = "delete"
        return self

    def in_(self, campo, valores):
        self._in = (campo, list(valores))
        return self

    def execute(self):
        campo, valores = self._in
        if self._op == "delete":
            self.borrados.extend(valores)
            return type("R", (), {"data": []})()
        return type("R", (), {"data": [s for s in self.subs if s[campo] in valores]})()


def _fila(user, endpoint):
    p256dh, auth = _claves()
    return {"user_id": user, "endpoint": endpoint, "p256dh": p256dh, "auth": auth}


WNS_OTRO_HOST = WNS.replace("wns2-par02p", "wns2-bl2p")


def _escenario_del_11_de_octubre():
    """Ana recibe por su Android; el iPhone de Beto es de junio; Carla tiene
    dos Windows de junio (en dos hosts de WNS) y un Android nuevo; Dani tiene
    un Windows nuevo en el MISMO host que el primer Windows de Carla."""
    return _Base([
        _fila("ana", FCM + "ok"),
        _fila("beto", APPLE + "apple-vieja"),
        _fila("carla", WNS + "wns-vieja"),
        _fila("carla", WNS_OTRO_HOST + "wns-vieja"),
        _fila("carla", FCM.replace("/send/", "/send2/") + "ok"),
        _fila("dani", WNS + "ok"),
    ])


def _enviar(base):
    mensajes = {u: {"title": "t", "body": "b", "url": "/"} for u in ("ana", "beto", "carla", "dani")}
    return asyncio.run(notif.enviar_push_personalizado(base, mensajes, detallado=True))


def test_se_borran_los_de_llave_vieja_y_se_cuentan_aparte(proveedor):
    base = _escenario_del_11_de_octubre()
    salida = _enviar(base)
    # El Windows de Carla en el host donde Dani SÍ recibió se borra; el del
    # otro host no tiene prueba de que nuestro JWT sirva ahí y se conserva.
    assert sorted(base.borrados) == sorted([APPLE + "apple-vieja", WNS + "wns-vieja"])
    assert salida["enviados"] == 3 and salida["llave_vieja"] == 2
    det = salida["por_usuario"]
    assert det["beto"] == {"enviados": 0, "fallidos": 0, "expirados": 0, "llave_vieja": 1,
                           "sin_dispositivo": False}
    # A Beto no le queda dispositivo: se cierra sin reintento eterno.
    assert resultado_de_entrega(det["beto"]) == (False, "sin-dispositivo-vigente")
    assert det["carla"]["llave_vieja"] == 1 and det["carla"]["fallidos"] == 1
    # A Carla le llegó por el Android; el Windows que se conservó dice qué fue.
    assert resultado_de_entrega(det["carla"]) == (True, "entrega-parcial:wns-llave-rechazada")
    assert salida["fallos"] == {"wns-llave-rechazada": 1}


def test_un_401_de_un_servicio_sin_entregas_no_se_borra_aunque_otro_reciba(proveedor):
    """FCM recibe, WNS da 401 y ningún Windows recibió: no hay prueba de que
    nuestro JWT sirva en WNS. Se conserva."""
    base = _Base([_fila("ana", FCM + "ok"), _fila("carla", WNS + "wns-vieja")])
    salida = asyncio.run(notif.enviar_push_personalizado(
        base, {"ana": {"title": "t"}, "carla": {"title": "t"}}, detallado=True))
    assert base.borrados == []
    assert salida["por_usuario"]["carla"]["fallidos"] == 1


def test_el_aud_cruzado_del_28_de_septiembre_no_borra_a_nadie(monkeypatch):
    """El caso que la guarda dice cubrir, reproducido con la librería real:
    `aud` fijo de FCM (el estado del bug del 28 sep) y proveedores que
    validan que el `aud` del JWT sea su propio origen. FCM recibe; Apple
    responde 403 y WNS 401. Nada de eso dice algo de los dispositivos."""
    import json
    from urllib.parse import urlparse

    monkeypatch.setattr(notif, "_vapid_cache", _vapid_nueva())
    monkeypatch.setattr(notif, "_vapid_estado", "ok")
    monkeypatch.setattr(notif, "VAPID_CLAIMS", {"sub": "mailto:prueba@example.com",
                                                "aud": "https://fcm.googleapis.com"})

    def post(url, data=None, headers=None, timeout=None, **_k):
        auth = headers["Authorization"]
        token = auth.split("t=")[1].split(",")[0] if "t=" in auth else auth.split()[1]
        cuerpo = token.split(".")[1]
        aud = json.loads(base64.urlsafe_b64decode(cuerpo + "=" * (-len(cuerpo) % 4)))["aud"]
        o = urlparse(url)
        if aud == f"{o.scheme}://{o.netloc}":
            return _respuesta(201, "")
        if "apple" in url:
            return _respuesta(403, '{"reason":"BadJwtToken"}')
        return _respuesta(401, "")
    monkeypatch.setattr(pywebpush.requests, "post", post)

    base = _Base([_fila("ana", FCM + "a"), _fila("beto", APPLE + "b"),
                  _fila("carla", APPLE + "c"), _fila("dani", WNS + "d")])
    salida = asyncio.run(notif.enviar_push_personalizado(
        base, {u: {"title": "t"} for u in ("ana", "beto", "carla", "dani")}, detallado=True))
    assert salida["enviados"] == 1
    assert base.borrados == []
    assert "llave_vieja" not in salida


def test_con_la_llave_propia_mal_NO_se_borra_nada(proveedor, monkeypatch):
    """La salvaguarda: con `no-coincide` los rechazos son culpa nuestra."""
    monkeypatch.setattr(notif, "_vapid_estado", "no-coincide")
    base = _escenario_del_11_de_octubre()
    salida = _enviar(base)
    assert base.borrados == []
    assert "llave_vieja" not in salida
    assert resultado_de_entrega(salida["por_usuario"]["beto"]) == (False, "push-fallido:apple-http-400")


def test_un_401_sin_ninguna_entrega_en_el_envio_no_borra(proveedor):
    """Un JWT mal armado (como el `aud` cruzado del 28 sep) también da 401/403
    y `estado_vapid` no lo ve. Si nadie recibió, no hay prueba de que el JWT
    sirva: se conserva y se reintenta."""
    base = _Base([_fila("carla", WNS + "wns-vieja")])
    salida = asyncio.run(notif.enviar_push_personalizado(
        base, {"carla": {"title": "t"}}, detallado=True))
    assert base.borrados == []
    assert salida["por_usuario"]["carla"]["fallidos"] == 1


def test_el_mensaje_de_apple_se_borra_aunque_nadie_mas_reciba(proveedor):
    """`VapidPkHashMismatch` es inequívoco: con nuestra llave confirmada, la
    suscripción es de otra llave."""
    base = _Base([_fila("beto", APPLE + "apple-vieja")])
    asyncio.run(notif.enviar_push_personalizado(base, {"beto": {"title": "t"}}, detallado=True))
    assert base.borrados == [APPLE + "apple-vieja"]


def test_el_aviso_a_los_admins_tambien_limpia(proveedor):
    """`broadcast_push_to_users` (alertas de puntaje, UNAFUT): el admin global
    tiene un iPhone y un Windows de junio, un Windows nuevo en el mismo host y
    otro viejo en un host donde nada recibió."""
    base = _Base([_fila("admin", APPLE + "apple-vieja"),
                  _fila("admin", WNS + "wns-vieja"),
                  _fila("admin", WNS + "ok"),
                  _fila("admin", WNS_OTRO_HOST + "wns-vieja")])
    enviados = asyncio.run(notif.broadcast_push_to_users(base, ["admin"], "t", "b"))
    assert enviados == 1
    assert sorted(base.borrados) == sorted([APPLE + "apple-vieja", WNS + "wns-vieja"])
