"""delete-match está BLOQUEADO: responde 409 y no toca la base.

Un DELETE en matches arrastra en cascada predicciones, prediction_logs,
match_audit, alertas_de_puntaje y notification_deliveries, y deja sin origen
los créditos ×2 (SET NULL): leído en pg_constraint de producción el 20 oct
2026. Ninguna comprobación previa desde el backend es atómica frente a filas
nuevas, así que hasta que haya una vía transaccional desplegada no se borra
nada. La prueba exige que ni siquiera se abra el cliente de Supabase.
"""
import sys
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app.routes.admin as admin  # noqa: E402
from app.auth import require_admin  # noqa: E402
from app.main import app  # noqa: E402


def test_borrar_partido_responde_409_sin_tocar_la_base(monkeypatch):
    llamadas = []

    def no_se_usa():
        llamadas.append('get_supabase')
        raise AssertionError('delete-match no debe tocar la base mientras esté bloqueado')

    monkeypatch.setattr(admin, 'get_supabase', no_se_usa)
    app.dependency_overrides[require_admin] = lambda: {'sub': 'admin'}
    try:
        with TestClient(app) as http:
            r = http.post('/api/admin/delete-match', json={'match_id': 77})
    finally:
        app.dependency_overrides.clear()
    assert r.status_code == 409
    assert 'deshabilitado' in r.json()['detail']
    assert 'suspendido o no disputado' in r.json()['detail']
    assert llamadas == []


def test_sin_admin_no_llega_ni_al_bloqueo():
    with TestClient(app) as http:
        r = http.post('/api/admin/delete-match', json={'match_id': 77})
    assert r.status_code in (401, 403)
