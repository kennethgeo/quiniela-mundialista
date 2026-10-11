"""La llave VAPID se lee en el formato en que venga (11 oct 2026).

EL FALLO, medido en producción: el resumen de las 6 am salió para 17 personas
con `enviados: 0`, y el log de Vercel decía en cada envío «Could not open
private key file … Could not deserialize key data … ASN.1 parsing error: short
data». El backend escribía `VAPID_PRIVATE_KEY` a un archivo y pywebpush, desde
un archivo, solo entiende PEM o DER; la variable tenía otro formato (el error
calza con la llave «cruda» de 32 bytes que da `web-push`). NINGÚN push del
backend salía, tuviera la persona dispositivo o no.

Se prueba con la librería REAL (py_vapid / pywebpush), no con el sustituto.
"""
import base64
import re
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

RAIZ = Path(__file__).resolve().parents[2]


def _b64u(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def _par():
    privada = ec.generate_private_key(ec.SECP256R1())
    publica = _b64u(privada.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint))
    return privada, publica


def _formatos(privada):
    pkcs8 = privada.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                  serialization.NoEncryption()).decode()
    sec1 = privada.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.TraditionalOpenSSL,
                                 serialization.NoEncryption()).decode()
    der = privada.private_bytes(serialization.Encoding.DER, serialization.PrivateFormat.PKCS8,
                                serialization.NoEncryption())
    crudo = privada.private_numbers().private_value.to_bytes(32, "big")
    return {
        "PEM normal": pkcs8,
        "PEM con \\n literales": pkcs8.replace("\n", "\\n"),
        "PEM en una sola línea": pkcs8.replace("\n", ""),
        "PEM con espacios": pkcs8.replace("\n", " "),
        "PEM entre comillas": '"' + pkcs8.replace("\n", "\\n") + '"',
        "PEM SEC1 en una línea": sec1.replace("\n", ""),
        "cruda base64url (web-push)": _b64u(crudo),
        "cruda con salto final": _b64u(crudo) + "\n",
        "DER base64url": _b64u(der),
        "DER base64": base64.b64encode(der).decode(),
    }


@pytest.mark.parametrize("nombre", list(_formatos(ec.generate_private_key(ec.SECP256R1()))))
def test_cada_formato_da_la_misma_llave(nombre):
    privada, publica = _par()
    vapid = notif.cargar_vapid(_formatos(privada)[nombre])
    assert notif.publica_de(vapid) == publica, nombre


def test_la_basura_no_pasa():
    with pytest.raises(Exception):
        notif.cargar_vapid("esto-no-es-una-llave")


def _reiniciar(monkeypatch, env):
    monkeypatch.setattr(notif, "_VAPID_PRIVATE_KEY_ENV", env)
    monkeypatch.setattr(notif, "_vapid_cache", None)
    monkeypatch.setattr(notif, "_vapid_estado", None)


def test_estado_dice_que_pasa_sin_mostrar_la_llave(monkeypatch, tmp_path, caplog):
    monkeypatch.chdir(tmp_path)  # sin private_key.pem de respaldo
    privada, publica = _par()
    cruda = _formatos(privada)["cruda base64url (web-push)"]

    _reiniciar(monkeypatch, cruda)
    monkeypatch.setattr(notif, "VAPID_PUBLIC_KEY_ESPERADA", publica)
    assert notif.estado_vapid() == "ok"

    _reiniciar(monkeypatch, cruda)
    monkeypatch.setattr(notif, "VAPID_PUBLIC_KEY_ESPERADA", _par()[1])
    assert notif.estado_vapid() == "no-coincide"

    _reiniciar(monkeypatch, "basura" + cruda)
    assert notif.estado_vapid() == "ilegible"
    assert cruda not in caplog.text, "el log no puede llevar la llave"

    _reiniciar(monkeypatch, "")
    assert notif.estado_vapid() == "sin-llave"


def test_sin_llave_legible_no_se_intenta_enviar(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    _reiniciar(monkeypatch, "basura")
    llamadas = []
    monkeypatch.setattr(notif, "webpush", lambda **k: llamadas.append(k))
    assert notif.send_push_notification({"endpoint": "https://x", "keys": {}}, {"title": "t"}) is False
    assert llamadas == []


def test_la_publica_esperada_es_la_del_frontend_y_la_de_public_key_pem():
    """Tres copias de la misma llave pública: si se separan, los proveedores
    rechazan todo sin que nada lo diga."""
    js = (RAIZ / "frontend" / "src" / "lib" / "notificaciones.js").read_text()
    del_frontend = re.search(r"VAPID_PUBLIC_KEY\s*=\s*'([^']+)'", js).group(1)
    assert del_frontend == notif.VAPID_PUBLIC_KEY_ESPERADA
    pem = (RAIZ / "backend" / "public_key.pem").read_bytes()
    publica = serialization.load_pem_public_key(pem).public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    assert _b64u(publica) == notif.VAPID_PUBLIC_KEY_ESPERADA


def test_con_la_llave_cruda_el_envio_sale_de_verdad(monkeypatch, tmp_path):
    """De punta a punta con pywebpush real: la llave cruda en la variable y el
    envío llega al proveedor (interceptado) firmado con su pública."""
    monkeypatch.chdir(tmp_path)
    privada, publica = _par()
    _reiniciar(monkeypatch, _formatos(privada)["cruda base64url (web-push)"])
    monkeypatch.setattr(notif, "VAPID_PUBLIC_KEY_ESPERADA", publica)

    pedidos = []

    class _Resp:
        status_code = 201
        text = ""

    def falso_post(url, data=None, headers=None, timeout=None, **_k):
        pedidos.append(headers)
        return _Resp()
    monkeypatch.setattr(pywebpush.requests, "post", falso_post)

    cliente = ec.generate_private_key(ec.SECP256R1()).public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    sub = {"endpoint": "https://fcm.googleapis.com/fcm/send/x",
           "keys": {"p256dh": _b64u(cliente), "auth": _b64u(b"0123456789abcdef")}}
    assert notif.send_push_notification(sub, {"title": "t", "body": "b"}) is True
    assert len(pedidos) == 1 and f"k={publica}" in pedidos[0]["Authorization"]
