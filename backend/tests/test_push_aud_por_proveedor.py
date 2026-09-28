"""Cada push lleva el `aud` de SU proveedor (auditoría del 28 sep 2026).

EL FALLO: `send_push_notification` le pasaba a `webpush()` el diccionario
GLOBAL `VAPID_CLAIMS`, y pywebpush le escribe `aud` y `exp` si no los tiene.
Después del primer envío el `aud` quedaba fijo en el origen de ESE proveedor
para todo el proceso: con las 13 suscripciones de producción repartidas entre
FCM, Apple y WNS, los de los otros proveedores recibían un JWT que su
proveedor rechaza.

Se prueba con la librería REAL (no con el sustituto de dos líneas que hay en
algunos entornos locales): se intercepta solo la petición HTTP.
"""
import base64
import json
import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

pywebpush = pytest.importorskip("pywebpush")
if not hasattr(pywebpush, "WebPusher"):
    pytest.skip("pywebpush es un sustituto, no la librería", allow_module_level=True)

from cryptography.hazmat.primitives import serialization  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import ec  # noqa: E402

import app.services.notifications as notif  # noqa: E402


def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def _suscripcion(endpoint: str) -> dict:
    clave = ec.generate_private_key(ec.SECP256R1()).public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    return {"endpoint": endpoint, "keys": {"p256dh": _b64(clave), "auth": _b64(os.urandom(16))}}


class _Resp:
    status_code = 201
    text = ""


@pytest.fixture
def capturas(monkeypatch, tmp_path):
    pem = ec.generate_private_key(ec.SECP256R1()).private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption())
    ruta = tmp_path / "vapid.pem"
    ruta.write_bytes(pem)
    monkeypatch.setattr(notif, "_get_vapid_private_key", lambda: str(ruta))
    monkeypatch.setattr(notif, "VAPID_CLAIMS", {"sub": "mailto:prueba@example.com"})

    vistas = []

    def post(url, data=None, headers=None, timeout=None, **_k):
        vistas.append({"url": url, "headers": headers, "timeout": timeout})
        return _Resp()
    monkeypatch.setattr(pywebpush.requests, "post", post)
    return vistas


def _aud(headers) -> str:
    auth = headers.get("Authorization") or headers.get("authorization")
    token = auth.split("t=")[1].split(",")[0] if "t=" in auth else auth.split(" ")[1]
    cuerpo = token.split(".")[1]
    return json.loads(base64.urlsafe_b64decode(cuerpo + "=" * (-len(cuerpo) % 4)))["aud"]


def test_cada_proveedor_recibe_su_propio_aud(capturas):
    endpoints = [
        "https://fcm.googleapis.com/fcm/send/abc",
        "https://web.push.apple.com/QXYZ",
        "https://wns2-par02p.notify.windows.com/w/?token=1",
    ]
    for e in endpoints:
        assert notif.send_push_notification(_suscripcion(e), {"title": "t"}) is True
    auds = [_aud(v["headers"]) for v in capturas]
    assert auds == ["https://fcm.googleapis.com", "https://web.push.apple.com",
                    "https://wns2-par02p.notify.windows.com"]
    assert "aud" not in notif.VAPID_CLAIMS, "se volvió a escribir en el diccionario global"


def test_lleva_ttl_y_tiempo_limite(capturas):
    notif.send_push_notification(_suscripcion("https://fcm.googleapis.com/fcm/send/x"), {"t": 1})
    v = capturas[0]
    assert int(v["headers"]["ttl"]) == notif.TTL_POR_DEFECTO > 0
    assert v["timeout"] == notif.TIMEOUT_ENVIO

    notif.send_push_notification(_suscripcion("https://fcm.googleapis.com/fcm/send/y"), {"t": 1}, ttl=1800)
    assert int(capturas[1]["headers"]["ttl"]) == 1800
