"""Los recálculos del panel y del cron no dicen «ok» si el motor no puntuó.

El motor DEVUELVE algunos fallos en vez de lanzarlos: un partido sin goles o
sin terminar da `status: error`, y uno cuyo resultado cambió mientras se
calculaba da `stale` (no escribió nada). `recalc-match` respondía
`{"status": "ok"}` con eso adentro y el panel avisaba que había recalculado;
los dos `recalc-scores` contaban como recalculado todo lo que no lanzara y
respondían «ok» con la lista de errores adentro. Mismo error que la sexta
auditoría corrigió en la recuperación (`puntuar_pendientes`), que ahora
comparte la clasificación con estos tres.

Se usa el motor REAL sobre el doble de `test_reintento_de_puntaje` (que imita
`aplicar_puntaje` de la base), no un motor simulado.
"""
import asyncio
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import app.routes.admin as admin  # noqa: E402
import app.routes.matches as matches  # noqa: E402
from app import config  # noqa: E402
from app.auth import require_admin  # noqa: E402
from app.main import app  # noqa: E402
from app.services import scoring  # noqa: E402
from test_reintento_de_puntaje import FalsaBase, _partido, _prediccion  # noqa: E402


@pytest.fixture(autouse=True)
def _sin_push(monkeypatch):
    async def nada(*_a, **_k):
        return None
    monkeypatch.setattr(scoring, "broadcast_push_to_users", nada)


def _base(*partidos):
    preds = [_prediccion(i + 1, 2, 1, match_id=p["id"]) for i, p in enumerate(partidos)]
    return FalsaBase(list(partidos), preds,
                     [{"id": "L", "tournament_id": 5, "points_exact": 3, "points_correct": 1}])


def _como_admin(monkeypatch, db, ruta, cuerpo=None):
    monkeypatch.setattr(admin, "get_supabase", lambda: db)
    app.dependency_overrides[require_admin] = lambda: {"sub": "admin"}
    try:
        with TestClient(app) as http:
            return http.post(ruta, json=cuerpo or {})
    finally:
        app.dependency_overrides.clear()


# --- recalc-match ------------------------------------------------------------

def test_recalc_match_ok_escribe_los_puntos(monkeypatch):
    db = _base(_partido(id=7))
    r = _como_admin(monkeypatch, db, "/api/admin/recalc-match", {"match_id": 7})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "ok"
    assert db.tablas["predictions"][0]["points_earned"] == 3


def test_recalc_match_sin_goles_no_dice_ok(monkeypatch):
    db = _base(_partido(id=7, home_goals_actual=None))
    r = _como_admin(monkeypatch, db, "/api/admin/recalc-match", {"match_id": 7})
    assert r.status_code == 409
    assert "resultado válido" in r.json()["detail"]


def test_recalc_match_sin_terminar_no_dice_ok(monkeypatch):
    db = _base(_partido(id=7, status="in_progress"))
    r = _como_admin(monkeypatch, db, "/api/admin/recalc-match", {"match_id": 7})
    assert r.status_code == 409
    assert "no finalizado" in r.json()["detail"]


def test_recalc_match_con_el_resultado_cambiando_no_dice_ok(monkeypatch):
    db = _base(_partido(id=7))
    db.aplicar_puntaje = lambda **_k: "desactualizado"
    r = _como_admin(monkeypatch, db, "/api/admin/recalc-match", {"match_id": 7})
    assert r.status_code == 409
    assert "cambió" in r.json()["detail"]
    assert db.tablas["predictions"][0]["points_earned"] == 0


# --- recalc-scores del panel --------------------------------------------------

def test_recalc_scores_del_panel_con_un_error_no_es_ok(monkeypatch):
    bien = _partido(id=7, phase="knockout")
    sin_goles = _partido(id=8, phase="knockout", away_goals_actual=None)
    db = _base(bien, sin_goles)
    r = _como_admin(monkeypatch, db, "/api/admin/recalc-scores")
    assert r.status_code == 500
    cuerpo = r.json()
    assert cuerpo["status"] == "error"
    assert cuerpo["finished"] == 2 and cuerpo["recalculated"] == 1
    assert len(cuerpo["errors"]) == 1 and cuerpo["errors"][0].startswith("match 8:")
    assert "Recalculados 1 de 2" in cuerpo["detail"]
    # El que estaba bien se puntuó igual: un fallo no tapa a los demás.
    assert {p["match_id"]: p["points_earned"] for p in db.tablas["predictions"]} == {7: 3, 8: 0}


def test_recalc_scores_del_panel_todo_bien_es_ok(monkeypatch):
    db = _base(_partido(id=7, phase="knockout"), _partido(id=9, phase="groups"))
    r = _como_admin(monkeypatch, db, "/api/admin/recalc-scores")
    assert r.status_code == 200, r.text
    assert r.json() == {"status": "ok", "finished": 1, "recalculated": 1, "reintentar": [], "errors": []}


# --- recalc-scores del cron ---------------------------------------------------

def _como_cron(monkeypatch, db):
    monkeypatch.setattr(matches, "get_supabase", lambda: db)
    monkeypatch.setattr(config.settings, "CRON_SECRET", "s3cr3t")
    with TestClient(app) as http:
        return http.post("/api/matches/recalc-scores", headers={"Authorization": "Bearer s3cr3t"})


def test_recalc_scores_del_cron_con_un_partido_que_cambio_no_es_ok(monkeypatch):
    db = _base(_partido(id=7))
    db.aplicar_puntaje = lambda **_k: "desactualizado"
    r = _como_cron(monkeypatch, db)
    assert r.status_code == 409
    assert r.json()["status"] == "stale" and r.json()["reintentar"] == [7]


def test_recalc_scores_del_cron_cuenta_un_status_error_como_error(monkeypatch):
    db = _base(_partido(id=7), _partido(id=8, home_goals_actual=None))
    r = _como_cron(monkeypatch, db)
    assert r.status_code == 500
    assert [e.split(":")[0] for e in r.json()["errors"]] == ["match 8"]
    assert r.json()["recalculated"] == 1


# --- el motor ------------------------------------------------------------------

def test_estado_del_puntaje_solo_acepta_ok_como_exito():
    assert scoring.estado_del_puntaje({"status": "ok"}) == "ok"
    assert scoring.estado_del_puntaje({"status": "stale"}) == "stale"
    for r in ({"status": "error"}, {"status": "raro"}, {}, None, "ok"):
        assert scoring.estado_del_puntaje(r) == "error"


def test_anular_sin_respuesta_de_la_base_es_error_no_ok():
    """`void_cancelled_match` sin respuesta: no consta que se haya anulado."""
    db = _base(_partido(id=7, status="cancelled"))

    class _Vacia:
        def execute(self):
            class R:
                data = None
            return R()
    db.rpc = lambda nombre, params: _Vacia()
    r = asyncio.run(scoring.calculate_and_update_scores(db, 7))
    assert r["status"] == "error"
