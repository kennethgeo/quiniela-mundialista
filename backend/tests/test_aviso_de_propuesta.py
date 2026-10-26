"""Aviso push al proponer un cambio de reglas (pedido del dueño, 26 oct 2026).

Se fija lo que no puede fallar en una quiniela por plata:
  · le llega al PADRÓN de la propuesta, menos a quien propone y a quien ya no
    es miembro;
  · UNA vez por persona y propuesta: un segundo toque, u otro admin, no lo
    repite (la bitácora de la 82 con el tipo `propuesta:<id>`, anclada a un
    partido del torneo);
  · un aviso que falló se puede volver a mandar;
  · solo lo dispara quien propuso o un admin de esa quiniela, y solo con la
    propuesta abierta;
  · sin bitácora no se manda nada.

El doble de Supabase aplica la unicidad (user, league, match, tipo) como la
base: un doble que aceptara duplicados haría pasar la prueba con el bug.
"""
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app.routes.propuestas as rutas  # noqa: E402
from app.auth import get_current_user  # noqa: E402
from app.main import app  # noqa: E402
from app.services import aviso_de_propuesta  # noqa: E402

LIGA = "liga-1"
PROP = "prop-1"
CREADOR, COADMIN, ANA, BETO, CARLA, AJENO = "creador", "coadmin", "ana", "beto", "carla", "ajeno"


class _R:
    def __init__(self, data):
        self.data = data


class _Q:
    def __init__(self, db, tabla):
        self.db, self.tabla = db, tabla
        self.filtros, self.modo, self.valores, self.opciones = [], "select", None, {}

    def select(self, *_a, **_k):
        return self

    def eq(self, col, val):
        self.filtros.append(lambda f, c=col, v=val: f.get(c) == v)
        return self

    def order(self, col, **_k):
        self.orden = col
        return self

    def limit(self, _n):
        return self

    def upsert(self, filas, on_conflict=None, ignore_duplicates=False):
        self.modo, self.valores = "upsert", filas
        self.opciones = {"on_conflict": on_conflict, "ignore_duplicates": ignore_duplicates}
        return self

    def update(self, valores):
        self.modo, self.valores = "update", valores
        return self

    def execute(self):
        tabla = self.db.tablas.setdefault(self.tabla, [])
        if self.db.fallar_en == (self.tabla, self.modo):
            raise RuntimeError("se cortó la base")
        if self.modo == "upsert":
            assert self.opciones["ignore_duplicates"], "sin ignore_duplicates pisaría un aviso ya entregado"
            claves = self.opciones["on_conflict"].split(",")
            insertadas = []
            for fila in self.valores:
                if any(all(f.get(k) == fila.get(k) for k in claves) for f in tabla):
                    continue  # ON CONFLICT DO NOTHING: no vuelve en RETURNING
                nueva = {"attempts": 1, "delivered_at": None, "last_error": None, **fila}
                tabla.append(nueva)
                insertadas.append(dict(nueva))
            return _R(insertadas)
        filas = [f for f in tabla if all(g(f) for g in self.filtros)]
        if self.modo == "update":
            for f in filas:
                f.update(self.valores)
            return _R([dict(f) for f in filas])
        orden = getattr(self, "orden", None)
        if orden:
            filas = sorted(filas, key=lambda f: f.get(orden))
        return _R([dict(f) for f in filas])


class FalsaBase:
    def __init__(self, estado="open"):
        self.fallar_en = None
        miembros = [CREADOR, COADMIN, ANA, BETO, CARLA]
        self.tablas = {
            "rule_proposals": [{"id": PROP, "league_id": LIGA, "kind": "scoring",
                                "payload": {"points_exact": 5}, "status": estado,
                                "proposed_by": COADMIN, "expires_at": "2026-10-28T18:00:00Z"}],
            "leagues": [{"id": LIGA, "name": "Bundestica", "admin_id": CREADOR, "tournament_id": 5}],
            "league_members": [{"league_id": LIGA, "user_id": u, "es_admin": u == COADMIN}
                               for u in miembros],
            # CARLA se fue después de abrirse la votación: sigue en el padrón.
            "rule_proposal_electores": [{"proposal_id": PROP, "user_id": u}
                                        for u in [CREADOR, COADMIN, ANA, BETO, CARLA, "se-fue"]],
            "users": [{"id": COADMIN, "display_name": "Kenneth"}],
            "matches": [{"id": 300, "tournament_id": 5}, {"id": 252, "tournament_id": 5},
                        {"id": 9, "tournament_id": 1}],
            "notification_deliveries": [],
        }

    def table(self, nombre):
        return _Q(self, nombre)


@pytest.fixture
def entorno(monkeypatch):
    db = FalsaBase()
    enviados = []

    async def enviar(_sb, mensajes, detallado=False, **_k):
        enviados.append(mensajes)
        por = {u: {"enviados": 1} for u in mensajes}
        return {"enviados": len(mensajes), "sin_dispositivo": 0, "por_usuario": por}

    monkeypatch.setattr(rutas, "get_supabase", lambda: db)
    monkeypatch.setattr(rutas, "enviar_push_personalizado", enviar)
    monkeypatch.setattr(rutas, "usuarios_con_dispositivo", lambda _sb, ids: set(ids) - {BETO})
    yield db, enviados
    app.dependency_overrides.clear()


def _avisar(quien, proposal_id=PROP):
    app.dependency_overrides[get_current_user] = lambda: {"sub": quien}
    with TestClient(app) as http:
        return http.post("/api/propuestas/avisar", json={"proposal_id": proposal_id})


def test_le_llega_al_padron_menos_a_quien_propone_y_a_quien_se_fue(entorno):
    db, enviados = entorno
    r = _avisar(COADMIN)
    assert r.status_code == 200, r.text
    # BETO no tiene dispositivo; «se-fue» ya no es miembro; COADMIN propuso.
    assert sorted(enviados[0]) == [ANA, CARLA, CREADOR]
    assert r.json()["personas"] == 3 and r.json()["sin_dispositivo"] == 1
    texto = enviados[0][ANA]
    assert texto["title"] == "🗳️ Nueva propuesta en Bundestica"
    assert texto["body"] == "Kenneth propone un cambio en el puntaje. Entrá a verlo y votá antes del 28/10 a las 12:00."
    assert texto["url"] == f"/q/{LIGA}?tab=rules"
    filas = db.tablas["notification_deliveries"]
    assert {f["tipo"] for f in filas} == {f"propuesta:{PROP}"}
    assert {f["match_id"] for f in filas} == {252}, "el ancla es el primer partido DEL TORNEO de la quiniela"
    assert {f["status"] for f in filas} == {"delivered"}


def test_un_segundo_toque_u_otro_admin_no_lo_repiten(entorno):
    _db, enviados = entorno
    assert _avisar(COADMIN).status_code == 200
    r = _avisar(CREADOR)
    assert r.status_code == 200
    assert len(enviados) == 1, "el segundo toque no manda nada"
    assert r.json()["personas"] == 0 and r.json()["ya_avisados"] == 3


def test_un_aviso_que_fallo_se_puede_volver_a_mandar(entorno, monkeypatch):
    db, enviados = entorno

    async def falla_ana(_sb, mensajes, detallado=False, **_k):
        enviados.append(mensajes)
        por = {u: ({"fallidos": 1} if u == ANA else {"enviados": 1}) for u in mensajes}
        return {"enviados": len(mensajes) - 1, "por_usuario": por}
    monkeypatch.setattr(rutas, "enviar_push_personalizado", falla_ana)
    _avisar(COADMIN)
    estado = {f["user_id"]: f["status"] for f in db.tablas["notification_deliveries"]}
    assert estado[ANA] == "failed"
    _avisar(COADMIN)
    assert sorted(enviados[1]) == [ANA], "solo se reintenta a quien le falló"


def test_solo_quien_propuso_o_un_admin_de_esa_quiniela(entorno):
    _db, enviados = entorno
    assert _avisar(ANA).status_code == 404       # miembro sin rol de admin
    assert _avisar(AJENO).status_code == 404     # ni siquiera es miembro
    assert _avisar(COADMIN, "otra").status_code == 404
    assert enviados == []
    assert _avisar(CREADOR).status_code == 200   # el creador sí


def test_una_propuesta_cerrada_no_se_avisa(entorno):
    db, enviados = entorno
    db.tablas["rule_proposals"][0]["status"] = "approved"
    r = _avisar(COADMIN)
    assert r.status_code == 200 and r.json()["personas"] == 0
    assert enviados == [] and db.tablas["notification_deliveries"] == []


@pytest.mark.parametrize("fallo", [("notification_deliveries", "upsert"), ("matches", "select")])
def test_sin_bitacora_no_se_manda_nada(entorno, fallo):
    db, enviados = entorno
    if fallo == ("matches", "select"):
        db.tablas["matches"] = []  # torneo sin partidos: no hay ancla
    else:
        db.fallar_en = fallo
    r = _avisar(COADMIN)
    assert r.status_code == 503
    assert "La propuesta quedó igual" in r.json()["detail"]
    assert enviados == []


def test_que_se_propone():
    assert aviso_de_propuesta.que_se_propone("rules", {"rules": "x"}) == "un cambio en el texto de las reglas"
    assert aviso_de_propuesta.que_se_propone("scoring", {"powerup_limits": {}}) == "un cambio en los cupos de ×2 por fase"
    assert aviso_de_propuesta.que_se_propone("scoring", {"points_exact": 5, "powerup_limits": {}}) == "un cambio en el puntaje"
