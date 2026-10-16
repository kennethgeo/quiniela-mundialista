"""Un aviso que no salió dice POR QUÉ (revisión de Codex, 12 oct 2026).

EL HUECO: el recordatorio del partido 293 le llegó a 7 de 8 personas, y la
bitácora del octavo decía «push-fallido». Todo lo que no era 404/410 o llave
vieja volvía como `False`, así que no había forma de saber —sin el log de
Vercel, que dura una hora— si era Apple o Windows, un 400 o un tiempo agotado.

Ahora cada fallo trae una categoría CERRADA (proveedor + código, tiempo
agotado, red), que llega a `last_error` y al resumen de la corrida. Nunca el
endpoint: identifica al dispositivo, y la misma regla que los logs de login.
"""
import asyncio
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import app.services.notifications as notif  # noqa: E402
from app.services.notification_deliveries import (  # noqa: E402
    LARGO_MAXIMO_ERROR, cerrar_reclamos, resultado_de_entrega,
)

requests = pytest.importorskip("requests")

APPLE = "https://web.push.apple.com/QSECRETOAPPLE"
FCM = "https://fcm.googleapis.com/fcm/send/SECRETOFCM"
WNS = "https://wns2-par02p.notify.windows.com/w/?token=SECRETOWNS"
MOZ = "https://updates.push.services.mozilla.com/wpush/v2/SECRETOMOZ"


@pytest.fixture
def envio(monkeypatch):
    """`webpush` responde lo que diga el endpoint."""
    monkeypatch.setattr(notif, "_get_vapid_private_key", lambda: "llave")
    reacciones = {}

    def webpush_falso(subscription_info=None, **_k):
        r = reacciones.get(subscription_info["endpoint"], True)
        if r is True:
            return None
        raise r
    monkeypatch.setattr(notif, "webpush", webpush_falso)
    return reacciones


def _sub(endpoint):
    return {"endpoint": endpoint, "keys": {"p256dh": "p", "auth": "a"}}


@pytest.mark.parametrize("endpoint,proveedor", [
    (APPLE, "apple"), (FCM, "fcm"), (WNS, "wns"), (MOZ, "mozilla"),
    ("https://android.googleapis.com/gcm/send/x", "fcm"),
    ("https://push.ejemplo.com/x", "otro"), ("no es una url", "otro"), (None, "otro"),
])
def test_el_proveedor_sale_del_host(endpoint, proveedor):
    assert notif.proveedor_de(endpoint) == proveedor


@pytest.mark.parametrize("excepcion,categoria", [
    (requests.exceptions.ReadTimeout(), "fcm-timeout"),
    (requests.exceptions.ConnectTimeout(), "fcm-timeout"),
    (requests.exceptions.ConnectionError(), "fcm-red"),
    (requests.exceptions.SSLError(), "fcm-red"),
    (ValueError("algo raro"), "error-interno"),
])
def test_tiempo_agotado_y_red_se_distinguen(envio, excepcion, categoria):
    envio[FCM] = excepcion
    r = notif.send_push_notification(_sub(FCM), {"t": 1})
    assert not r and isinstance(r, notif.FalloDePush)
    assert r.categoria == categoria


def test_la_bitacora_dice_proveedor_y_codigo_sin_el_endpoint(envio):
    from pywebpush import WebPushException

    class _Resp:
        def __init__(self, codigo):
            self.status_code, self.text = codigo, "detalle del proveedor con SECRETO"

        def __bool__(self):  # como una requests.Response con error
            return False

    def rechazo(codigo):
        e = WebPushException("rechazado")
        e.response = _Resp(codigo)
        return e

    envio[APPLE] = rechazo(400)
    envio[WNS] = requests.exceptions.ReadTimeout()

    class _Base:
        def table(self, _n):
            return self

        def select(self, *_a):
            return self

        def in_(self, *_a):
            return self

        def delete(self):
            return self

        def execute(self):
            class R:
                data = [{"user_id": "ana", "endpoint": APPLE, "p256dh": "p", "auth": "a"},
                        {"user_id": "ana", "endpoint": WNS, "p256dh": "p", "auth": "a"},
                        {"user_id": "beto", "endpoint": FCM, "p256dh": "p", "auth": "a"}]
            return R()

    salida = asyncio.run(notif.enviar_push_personalizado(
        _Base(), {"ana": {"title": "t"}, "beto": {"title": "t"}}, detallado=True))
    assert salida["enviados"] == 1
    assert salida["fallos"] == {"apple-http-400": 1, "wns-timeout": 1}

    entregado, error = resultado_de_entrega(salida["por_usuario"]["ana"])
    assert (entregado, error) == (False, "push-fallido:apple-http-400,wns-timeout")
    assert "SECRETO" not in error and " " not in error
    assert resultado_de_entrega(salida["por_usuario"]["beto"]) == (True, None)


def test_el_motivo_viaja_hasta_last_error():
    class _Tabla:
        def __init__(self):
            self.cambios = []

        def table(self, _n):
            return self

        def update(self, c):
            self.cambios.append(c)
            return self

        def eq(self, *_a):
            return self

        def execute(self):
            return None

    base = _Tabla()
    cerrar_reclamos(base, {"ana": "tok"},
                    {"ana": {"enviados": 0, "fallidos": 1, "motivos": ["apple-http-400"]}})
    assert base.cambios[0]["last_error"] == "push-fallido:apple-http-400"
    assert base.cambios[0]["status"] == "failed"


def test_muchos_motivos_no_pasan_el_check_de_la_columna():
    """Un `last_error` de más de 120 rompería el UPDATE y dejaría el reclamo
    abierto: a los 5 minutos el aviso saldría otra vez."""
    motivos = [f"otro-http-{c}" for c in range(400, 440)]
    _, error = resultado_de_entrega({"enviados": 0, "fallidos": 40, "motivos": motivos})
    assert error.startswith("push-fallido:") and len(error) <= LARGO_MAXIMO_ERROR
    _, error = resultado_de_entrega({"enviados": 1, "fallidos": 40, "motivos": motivos})
    assert error.startswith("entrega-parcial:") and len(error) <= LARGO_MAXIMO_ERROR


def test_sin_motivos_las_categorias_de_siempre():
    """Un detalle viejo (o de otra ruta) sin `motivos` se cierra igual que antes."""
    assert resultado_de_entrega({"enviados": 0, "fallidos": 2}) == (False, "push-fallido")
    assert resultado_de_entrega({"enviados": 1, "fallidos": 1}) == (True, "entrega-parcial")
