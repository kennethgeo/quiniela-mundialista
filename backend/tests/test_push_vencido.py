"""Un endpoint de push muerto se reconoce como muerto.

EL FALLO (cuarta auditoría, hallazgo 4): la condición era
`if ex.response and ex.response.status_code in [404, 410]`. Una
`requests.Response` es FALSA cuando su estado es de error —su `__bool__`
devuelve `self.ok`—, así que con 404 o 410 la condición no se cumplía nunca:
los endpoints muertos no se borraban y cada envío los contaba como un fallo
reintentable.

Estas pruebas usan una `requests.Response` y una `WebPushException` DE VERDAD.
Con un objeto simulado cualquiera (que es verdadero siempre) el fallo no se
ve: es la regla del repo sobre los dobles más permisivos que lo real.
"""
import sys
from pathlib import Path

import pytest
import requests
from pywebpush import WebPushException

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import app.services.notifications as notif  # noqa: E402


def _respuesta(estado):
    r = requests.Response()
    r.status_code = estado
    return r


def _excepcion(respuesta):
    """Se asigna `response` después de crearla: así funciona igual con la
    librería real (CI instala requirements.txt) y con el sustituto mínimo que
    hay en algunos entornos locales, donde la clase no acepta ese argumento.
    Es el mismo atributo que lee el código de producción."""
    ex = WebPushException("push falló")
    ex.response = respuesta
    return ex


def _envio_que_falla_con(estado, monkeypatch):
    def webpush_falso(**_k):
        raise _excepcion(_respuesta(estado))
    monkeypatch.setattr(notif, "webpush", webpush_falso)
    monkeypatch.setattr(notif, "_get_vapid_private_key", lambda: "clave")
    return notif.send_push_notification({"endpoint": "https://x", "keys": {}}, {"title": "t"})


def test_la_trampa_existe_de_verdad():
    """Si esto dejara de ser cierto, las demás pruebas perderían su motivo."""
    assert bool(_respuesta(410)) is False


@pytest.mark.parametrize("estado", [404, 410])
def test_un_endpoint_muerto_se_reconoce(estado, monkeypatch):
    assert _envio_que_falla_con(estado, monkeypatch) == "expired"


def test_un_error_del_servidor_no_borra_el_endpoint(monkeypatch):
    """Un 500 es un fallo pasajero del proveedor: el dispositivo sigue vivo."""
    assert _envio_que_falla_con(500, monkeypatch) is False


def test_sin_respuesta_no_revienta(monkeypatch):
    def webpush_falso(**_k):
        raise _excepcion(None)
    monkeypatch.setattr(notif, "webpush", webpush_falso)
    monkeypatch.setattr(notif, "_get_vapid_private_key", lambda: "clave")
    assert notif.send_push_notification({"endpoint": "https://x", "keys": {}}, {}) is False
