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
solo si en el mismo envío algún dispositivo recibió.

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

def test_apple_con_la_llave_vieja_se_reconoce(proveedor):
    assert notif.send_push_notification(_sub(APPLE + "apple-vieja"), {"t": 1}) == notif.LLAVE_VIEJA


def test_otro_400_de_apple_no_es_llave_vieja(proveedor):
    """Un 400 cualquiera es un fallo, no un dispositivo para borrar."""
    assert notif.send_push_notification(_sub(APPLE + "apple-otro-400"), {"t": 1}) is False


@pytest.mark.parametrize("endpoint", [WNS + "wns-vieja", FCM + "fcm-403"])
def test_401_y_403_son_rechazo_de_llave(proveedor, endpoint):
    assert notif.send_push_notification(_sub(endpoint), {"t": 1}) == notif.LLAVE_RECHAZADA


@pytest.mark.parametrize("estado", ["no-coincide", "ilegible"])
@pytest.mark.parametrize("endpoint", [APPLE + "apple-vieja", WNS + "wns-vieja", FCM + "fcm-403"])
def test_con_la_llave_PROPIA_mal_nada_es_llave_vieja(proveedor, monkeypatch, estado, endpoint):
    """Si la llave nuestra no es la del frontend, TODOS rechazan: eso no dice
    nada de los dispositivos."""
    monkeypatch.setattr(notif, "_vapid_estado", estado)
    assert notif.send_push_notification(_sub(endpoint), {"t": 1}) is False


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


def _escenario_del_11_de_octubre():
    """Ana recibe por su Android; el iPhone de Beto es de junio; Carla tiene
    dos Windows de junio y un Android nuevo."""
    return _Base([
        _fila("ana", FCM + "ok"),
        _fila("beto", APPLE + "apple-vieja"),
        _fila("carla", WNS + "wns-vieja"),
        _fila("carla", WNS.replace("wns2", "wns3") + "wns-vieja"),
        _fila("carla", FCM.replace("/send/", "/send2/") + "ok"),
    ])


def _enviar(base):
    mensajes = {u: {"title": "t", "body": "b", "url": "/"} for u in ("ana", "beto", "carla")}
    return asyncio.run(notif.enviar_push_personalizado(base, mensajes, detallado=True))


def test_se_borran_los_de_llave_vieja_y_se_cuentan_aparte(proveedor):
    base = _escenario_del_11_de_octubre()
    salida = _enviar(base)
    assert sorted(base.borrados) == sorted([
        APPLE + "apple-vieja", WNS + "wns-vieja", WNS.replace("wns2", "wns3") + "wns-vieja"])
    assert salida["enviados"] == 2 and salida["llave_vieja"] == 3
    det = salida["por_usuario"]
    assert det["beto"] == {"enviados": 0, "fallidos": 0, "expirados": 0, "llave_vieja": 1,
                           "sin_dispositivo": False}
    # A Beto no le queda dispositivo: se cierra sin reintento eterno.
    assert resultado_de_entrega(det["beto"]) == (False, "sin-dispositivo-vigente")
    # A Carla le llegó por el Android.
    assert resultado_de_entrega(det["carla"]) == (True, "entrega-parcial")


def test_con_la_llave_propia_mal_NO_se_borra_nada(proveedor, monkeypatch):
    """La salvaguarda: con `no-coincide` los rechazos son culpa nuestra."""
    monkeypatch.setattr(notif, "_vapid_estado", "no-coincide")
    base = _escenario_del_11_de_octubre()
    salida = _enviar(base)
    assert base.borrados == []
    assert "llave_vieja" not in salida
    assert resultado_de_entrega(salida["por_usuario"]["beto"]) == (False, "push-fallido")


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
    tiene dos Windows de junio y un Android."""
    base = _Base([_fila("admin", WNS + "wns-vieja"),
                  _fila("admin", WNS.replace("wns2", "wns3") + "wns-vieja"),
                  _fila("admin", FCM + "ok")])
    enviados = asyncio.run(notif.broadcast_push_to_users(base, ["admin"], "t", "b"))
    assert enviados == 1
    assert len(base.borrados) == 2 and all("notify.windows.com" in e for e in base.borrados)
