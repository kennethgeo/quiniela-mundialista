"""Reparto de campeón, goleador y asistidor (vigésima auditoría, ítem 1.4).

Las picks son las 15 globales REALES de Bundestica (producción, 11 oct 2026)
y los jugadores, los de `players` del torneo 2: así se prueba con lo que la
gente escribió de verdad, variantes de tildes y espacios incluidas, y con los
homónimos que de verdad juegan en la liga tica.
"""
import asyncio
import copy
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import app.routes.admin as admin_mod  # noqa: E402
from app.services import reparto_globales as rg  # noqa: E402

BUNDESTICA = "2df51e3a-60a0-4824-a7aa-98b25c6e8350"
CLAUSURA = "c1a05a7a-0000-4000-8000-000000000001"
CHAMPIONS = "c4a3b1e0-0000-4000-8000-000000000006"

# (campeón, goleador, asistidor, cuántas personas): agrupado de producción.
_PICKS_BUNDESTICA = [
    ("Alajuelense", "Marcel Hernandez", "Elías Aguilar", 1),
    ("Alajuelense", "Marcel Hernández", "Elías Aguilar", 1),
    ("Alajuelense", "Ronaldo Cisneros", "Elías Aguilar", 1),
    ("Alajuelense", "Ronaldo Cisneros", "Juanpi", 1),
    ("Alajuelense", "Ronaldo Cisneros", "Mariano Torres", 1),
    ("Alajuelense", "Ronaldo Cisneros", "Roan Wilson", 1),
    ("Cartaginés", "Marcel Hernandez", "Elías Aguilar", 1),
    ("Herediano", "Marcel Hernandez", "Mariano Torres", 1),
    ("Saprissa", "Marcel Hernandez", "Elías Aguilar", 2),
    ("Saprissa", "Marcel Hernandez", "Luis Paradela", 1),
    ("Saprissa", "Marcel Hernandez", "Mariano Torres", 1),
    ("Saprissa", "Marcel Hernández ", "Elías Aguilar", 1),
    ("Saprissa", "Newton Williams", "Mariano Torres", 1),
    ("Saprissa", "Ronaldo Cisneros", "Elías Aguilar", 1),
]

# Equipos de los partidos del torneo 2 (producción).
EQUIPOS_TICA = ["AD San Carlos", "Alajuelense", "Cartaginés", "Escorpiones Belén", "Herediano",
                "Inter de San Carlos", "Pérez Zeledón", "Puntarenas FC", "Saprissa",
                "Sporting San José"]


def _predicciones(liga, prefijo):
    filas, n = [], 0
    for campeon, goleador, asistidor, cuantas in _PICKS_BUNDESTICA:
        for _ in range(cuantas):
            n += 1
            # Como nacen en la base: puntos en 0, no NULL.
            filas.append({"id": f"{prefijo}{n}", "user_id": f"u{n}", "league_id": liga,
                          "tournament_id": 2, "champion_team": campeon,
                          "top_scorer_name": goleador, "top_assist_name": asistidor,
                          "champion_points": 0, "top_scorer_points": 0, "top_assist_points": 0})
    return filas


# --- La comparación ---------------------------------------------------------

@pytest.mark.parametrize("pick", ["Marcel Hernandez", "Marcel Hernández", "Marcel Hernández "])
def test_las_variantes_reales_de_marcel_siguen_acertando(pick):
    assert rg.acierta(rg.alias("Marcel Hernández", rg.SEPARADORES_JUGADOR), pick)
    # Y al revés: `players` lo tiene escrito sin tilde.
    assert rg.acierta(rg.alias("Marcel Hernandez", rg.SEPARADORES_JUGADOR), pick)


@pytest.mark.parametrize("real,pick", [
    ("Gerson Torres", "Mariano Torres"),
    ("Anthony Hernández", "Marcel Hernández"),
    ("Alonso Hernández", "Marcel Hernández"),
    ("Bancy Hernández", "Marcel Hernández"),
    ("Bancy Hernández", "Marcel Hernandez"),
    ("Jenzel Aguilar", "Elías Aguilar"),
    ("Deylan Aguilar", "Elías Aguilar"),
    ("Jorman Aguilar", "Elías Aguilar"),
    # Solo el apellido tampoco: si el admin lo quiere aceptar, lo pone de alias.
    ("Marcel Hernández", "Hernández"),
    ("Hernández", "Marcel Hernández"),
])
def test_un_homonimo_de_apellido_no_acierta(real, pick):
    assert not rg.acierta(rg.alias(real, rg.SEPARADORES_JUGADOR), pick)


def test_los_alias_del_admin_se_comparan_uno_por_uno():
    # El valor real que tiene el Mundial 2026 en producción.
    reales = rg.alias("Kylian Mbappe, Kylian Mbappé, Mbappe, Mbappé", rg.SEPARADORES_JUGADOR)
    assert rg.acierta(reales, "Kylian Mbappé")
    assert rg.acierta(reales, "mbappe")
    # Un error de tipeo real de la Champions: solo cobra si el admin lo agrega.
    assert not rg.acierta(rg.alias("Harry Kane", rg.SEPARADORES_JUGADOR), "Harry Keane")
    assert rg.acierta(rg.alias("Harry Kane; Harry Keane", rg.SEPARADORES_JUGADOR), "Harry Keane")
    assert rg.acierta(rg.alias("Harry Kane / Kane", rg.SEPARADORES_JUGADOR), "Kane")


def test_el_campeon_acepta_alias_exactos_y_nunca_subcadenas():
    madrid = rg.alias("Madrid", rg.SEPARADORES_EQUIPO)
    assert not rg.acierta(madrid, "Real Madrid")
    assert not rg.acierta(madrid, "Atlético de Madrid")
    assert not rg.acierta(rg.alias("LD Alajuelense", rg.SEPARADORES_EQUIPO), "Alajuelense")
    assert rg.acierta(rg.alias("LD Alajuelense, Alajuelense", rg.SEPARADORES_EQUIPO), "Alajuelense")
    assert rg.acierta(rg.alias("Cartagines", rg.SEPARADORES_EQUIPO), "Cartaginés")


def test_el_campeon_no_parte_por_barra():
    # «Bodo/Glimt» juega la Champions 26-27: partirlo por «/» lo rompería.
    assert rg.acierta(rg.alias("Bodo/Glimt", rg.SEPARADORES_EQUIPO), "Bodo/Glimt")
    assert not rg.acierta(rg.alias("Bodo/Glimt", rg.SEPARADORES_EQUIPO), "Glimt")


def test_sin_real_nadie_acierta():
    assert not rg.acierta(rg.alias(None, rg.SEPARADORES_JUGADOR), "Marcel Hernández")
    assert not rg.acierta(rg.alias("Marcel Hernández", rg.SEPARADORES_JUGADOR), "")
    assert not rg.acierta(rg.alias(" , ", rg.SEPARADORES_JUGADOR), " ")


# --- La cuenta sobre las picks reales de Bundestica ------------------------

LIGA_CFG = {"champion_points": 10, "scorer_points": 10, "assist_points": 8}


def test_cuenta_quien_acierta_con_las_picks_reales():
    r = rg.calcular({"actual_champion": "Saprissa", "actual_top_scorer": "Marcel Hernández",
                     "actual_top_assist": "Elías Aguilar"},
                    _predicciones(BUNDESTICA, "b"), LIGA_CFG)
    assert r["predicciones"] == 15
    assert (r["campeon"]["aciertan"], r["goleador"]["aciertan"], r["asistidor"]["aciertan"]) == (7, 9, 8)
    # Las tres variantes de Marcel aparecen por separado y las tres aciertan.
    marcel = {d["pick"]: d for d in r["goleador"]["picks"] if d["pick"].startswith("Marcel")}
    assert set(marcel) == {"Marcel Hernandez", "Marcel Hernández"}  # el espacio final se recorta
    assert all(d["acierta"] for d in marcel.values())
    assert sum(d["personas"] for d in marcel.values()) == 9
    assert {f["puntos"]["top_assist_points"] for f in r["filas"]} == {0, 8}


def test_un_homonimo_real_no_reparte_nada():
    # El escenario que regalaba 90 + 32 puntos con el apellido.
    r = rg.calcular({"actual_top_scorer": "Bancy Hernández", "actual_top_assist": "Gerson Torres"},
                    _predicciones(BUNDESTICA, "b"), LIGA_CFG)
    assert r["goleador"]["aciertan"] == 0
    assert r["asistidor"]["aciertan"] == 0
    assert r["cambiarian"] == 0
    r = rg.calcular({"actual_top_assist": "Jorman Aguilar"}, _predicciones(BUNDESTICA, "b"), LIGA_CFG)
    assert r["asistidor"]["aciertan"] == 0


def test_puntos_por_defecto_y_cambios():
    preds = _predicciones(BUNDESTICA, "b")
    preds[0]["champion_points"] = 12  # ya repartido antes con otro campeón
    r = rg.calcular({"actual_champion": "Saprissa"}, preds, {})
    assert r["puntos"] == {"campeon": 12, "goleador": 12, "asistidor": 12}
    assert r["filas"][0]["puntos"]["champion_points"] == 0 and r["filas"][0]["cambia"]
    assert r["cambiarian"] == 8  # 7 de Saprissa + la que pierde sus 12


# --- El endpoint, contra un doble que filtra de verdad ----------------------

class _R:
    def __init__(self, data):
        self.data = data


class _Q:
    """Imita lo justo de PostgREST: `eq` filtra, `select` proyecta solo las
    columnas pedidas y `update` escribe solo en las filas que pasan los
    filtros. Un doble que ignorara los filtros no podría ver el fallo de
    recorrer todas las quinielas."""

    def __init__(self, base, tabla):
        self.base, self.tabla = base, tabla
        self.filtros, self.columnas, self.cambios = [], None, None

    def select(self, columnas="*", *_a, **_k):
        self.columnas = None if columnas == "*" else [c.strip() for c in columnas.split(",")]
        return self

    def eq(self, col, val):
        self.filtros.append((col, val))
        return self

    def order(self, col, *_a, **_k):
        self.orden = col
        return self

    def update(self, cambios):
        self.cambios = cambios
        return self

    def execute(self):
        filas = [f for f in self.base.tablas[self.tabla]
                 if all(f.get(c) == v for c, v in self.filtros)]
        if self.cambios is not None:
            for f in filas:
                f.update(self.cambios)
                self.base.escrituras.append((self.tabla, f["id"], dict(self.cambios)))
            return _R([copy.deepcopy(f) for f in filas])
        if getattr(self, "orden", None):
            filas = sorted(filas, key=lambda f: f.get(self.orden) or "")
        if self.columnas:
            filas = [{c: f.get(c) for c in self.columnas} for f in filas]
        return _R(copy.deepcopy(filas))


class _Rpc:
    def __init__(self, base, nombre, args):
        self.base, self.nombre, self.args = base, nombre, args

    def execute(self):
        self.base.rpcs.append((self.nombre, self.args))
        if self.nombre == "tournament_predictions_open":
            if self.base.falla_abiertas:
                raise RuntimeError("PGRST002")
            return _R(self.base.globales_abiertas(self.args["p_tid"]))
        return _R(None)


class Base:
    def __init__(self, reales):
        # Bloqueo y apertura forzada como los tiene HOY el torneo 2 en
        # producción (locked y force_open en true: cerradas).
        self.tablas = {
            "tournaments": [{"id": 2, "predictions_locked": True, "predictions_force_open": True,
                             **reales}],
            "leagues": [
                {"id": BUNDESTICA, "name": "Bundestica", "tournament_id": 2, **LIGA_CFG},
                {"id": CLAUSURA, "name": "Clausura 2027", "tournament_id": 2,
                 "champion_points": 12, "scorer_points": 12, "assist_points": 12},
                {"id": CHAMPIONS, "name": "Champions 26-27", "tournament_id": 6,
                 "champion_points": 12, "scorer_points": 12, "assist_points": 12},
            ],
            "tournament_predictions": _predicciones(BUNDESTICA, "b") + _predicciones(CLAUSURA, "c"),
            "matches": [{"id": i, "tournament_id": 2, "home_team": a, "away_team": b,
                         "kickoff_at": f"2026-07-{24 + i // 2:02d}T02:00:00+00:00"}
                        for i, (a, b) in enumerate(zip(EQUIPOS_TICA, EQUIPOS_TICA[1:] + EQUIPOS_TICA[:1]))],
        }
        self.escrituras, self.rpcs = [], []
        self.falla_abiertas = False

    def globales_abiertas(self, tid):
        """La MISMA condición que `tournament_predictions_open` en producción
        (migración 47): no bloqueadas Y (forzadas O antes del primer saque; un
        torneo sin partidos está abierto)."""
        t = next((f for f in self.tablas["tournaments"] if f["id"] == tid), {})
        saques = [datetime.fromisoformat(m["kickoff_at"]) for m in self.tablas["matches"]
                  if m["tournament_id"] == tid and m.get("kickoff_at")]
        antes_del_primero = not saques or datetime.now(timezone.utc) < min(saques)
        return (not (t.get("predictions_locked") or False)
                and bool(t.get("predictions_force_open") or antes_del_primero))

    def table(self, t): return _Q(self, t)
    def rpc(self, n, a): return _Rpc(self, n, a)


REALES_CLAUSURA = {"actual_champion": "Alajuelense", "actual_top_scorer": "Ronaldo Cisneros",
                   "actual_top_assist": "Mariano Torres"}


def _calc(base, monkeypatch, **kw):
    monkeypatch.setattr(admin_mod, "get_supabase", lambda: base)
    kw.setdefault("tournament_id", 2)
    kw.setdefault("league_id", None)
    kw.setdefault("dry_run", False)
    if "esperado" not in kw:
        # Lo que manda el panel: los reales que mostró la vista previa.
        t = base.tablas["tournaments"][0]
        kw["esperado"] = None if kw["dry_run"] else {k: t.get(k) for k in admin_mod.REALES}
    return asyncio.run(admin_mod.calc_tournament_globals(admin={"sub": "admin"}, **kw))


def _recalculos(base):
    return [a for n, a in base.rpcs if n == "recompute_user_total"]


def test_repartir_sin_elegir_quiniela_no_escribe(monkeypatch):
    base = Base(REALES_CLAUSURA)
    with pytest.raises(HTTPException) as e:
        _calc(base, monkeypatch)
    assert e.value.status_code == 400
    assert base.escrituras == []


def test_repartir_una_quiniela_no_toca_la_otra_temporada(monkeypatch):
    base = Base(REALES_CLAUSURA)
    r = _calc(base, monkeypatch, league_id=CLAUSURA)
    tocadas = {i for _t, i, _c in base.escrituras}
    assert tocadas and all(i.startswith("c") for i in tocadas), "se reescribió Bundestica"
    bundes = [p for p in base.tablas["tournament_predictions"] if p["league_id"] == BUNDESTICA]
    assert all(p["champion_points"] == p["top_scorer_points"] == p["top_assist_points"] == 0 for p in bundes)
    # Clausura: 6 Alajuelense, 5 Cisneros, 4 Mariano Torres, con los puntos de SU quiniela.
    clau = [p for p in base.tablas["tournament_predictions"] if p["league_id"] == CLAUSURA]
    assert sum(p["champion_points"] for p in clau) == 6 * 12
    assert sum(p["top_scorer_points"] for p in clau) == 5 * 12
    assert sum(p["top_assist_points"] for p in clau) == 4 * 12
    assert r["liga"]["league_id"] == CLAUSURA and r["updated"] == len(tocadas)
    assert {a["p_user_id"] for a in _recalculos(base)} == {p["user_id"] for p in clau if p["id"] in tocadas}


def test_repartir_es_idempotente(monkeypatch):
    base = Base(REALES_CLAUSURA)
    _calc(base, monkeypatch, league_id=CLAUSURA)
    base.escrituras.clear()
    r = _calc(base, monkeypatch, league_id=CLAUSURA)
    assert r["updated"] == 0 and base.escrituras == []


def test_una_quiniela_de_otro_torneo_se_rechaza(monkeypatch):
    base = Base(REALES_CLAUSURA)
    with pytest.raises(HTTPException) as e:
        _calc(base, monkeypatch, league_id=CHAMPIONS)
    assert e.value.status_code == 404
    assert base.escrituras == []


def test_la_vista_previa_no_escribe_y_muestra_cada_quiniela(monkeypatch):
    base = Base({"actual_champion": "Saprissa", "actual_top_scorer": "Bancy Hernández",
                 "actual_top_assist": "Elías Aguilar"})
    r = _calc(base, monkeypatch, dry_run=True)
    assert base.escrituras == [] and _recalculos(base) == []
    assert r["abiertas"] is False
    assert [l["nombre"] for l in r["ligas"]] == ["Bundestica", "Clausura 2027"]
    b = r["ligas"][0]
    assert b["league_id"] == BUNDESTICA and "filas" not in b
    assert (b["campeon"]["aciertan"], b["goleador"]["aciertan"], b["asistidor"]["aciertan"]) == (7, 0, 8)
    goleadores = {d["pick"]: d["acierta"] for d in b["goleador"]["picks"]}
    assert goleadores == {"Marcel Hernandez": False, "Marcel Hernández": False,
                          "Ronaldo Cisneros": False, "Newton Williams": False}
    assert b["puntos"] == {"campeon": 10, "goleador": 10, "asistidor": 8}
    # El selector del campeón usa los equipos del torneo, no un texto libre.
    assert r["equipos"] == EQUIPOS_TICA


def test_la_vista_previa_de_una_sola_quiniela(monkeypatch):
    base = Base(REALES_CLAUSURA)
    r = _calc(base, monkeypatch, dry_run=True, league_id=BUNDESTICA)
    assert [l["league_id"] for l in r["ligas"]] == [BUNDESTICA]
    assert base.escrituras == []


def test_si_los_reales_cambiaron_desde_la_vista_previa_no_reparte(monkeypatch):
    base = Base(REALES_CLAUSURA)
    visto = dict(REALES_CLAUSURA, actual_top_assist="Gerson Torres")
    with pytest.raises(HTTPException) as e:
        _calc(base, monkeypatch, league_id=CLAUSURA, esperado=visto)
    assert e.value.status_code == 409
    assert base.escrituras == []
    # Con lo mismo que se vio, reparte.
    r = _calc(base, monkeypatch, league_id=CLAUSURA, esperado=dict(REALES_CLAUSURA))
    assert r["updated"] > 0


def test_el_cuerpo_que_manda_el_panel_llega_entero(monkeypatch):
    """Por HTTP, con el JSON tal cual lo arma `TournamentGlobalsAdmin`: los
    parámetros son `Body(embed=True)` y un nombre mal puesto se ignoraría
    callado (el `league_id` quedaría en None)."""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    base = Base(REALES_CLAUSURA)
    monkeypatch.setattr(admin_mod, "get_supabase", lambda: base)
    app = FastAPI()
    app.include_router(admin_mod.router)
    app.dependency_overrides[admin_mod.require_admin] = lambda: {"sub": "admin"}
    cli = TestClient(app)

    r = cli.post("/api/admin/calc-tournament-globals", json={"tournament_id": 2, "dry_run": True})
    assert r.status_code == 200 and len(r.json()["ligas"]) == 2
    assert base.escrituras == []

    r = cli.post("/api/admin/calc-tournament-globals",
                 json={"tournament_id": 2, "league_id": CLAUSURA, "esperado": REALES_CLAUSURA})
    assert r.status_code == 200, r.text
    assert r.json()["liga"]["league_id"] == CLAUSURA
    tocadas = {i for _t, i, _c in base.escrituras}
    assert tocadas and all(i.startswith("c") for i in tocadas)

    r = cli.post("/api/admin/calc-tournament-globals", json={"tournament_id": 2})
    assert r.status_code == 400


def test_el_doble_del_panel_es_lo_que_devuelve_el_backend(monkeypatch):
    """`frontend/tests/ui/datos/globales_vista_previa.json` es la respuesta
    que simula la prueba del panel. Si el backend cambia la forma o los
    números, ese doble quedaría probando la pantalla contra algo que el
    backend ya no manda: acá se exige que sean idénticos."""
    import json

    base = Base({"actual_champion": "Saprissa", "actual_top_scorer": "Bancy Hernández",
                 "actual_top_assist": "Elías Aguilar"})
    datos = Path(__file__).resolve().parents[2] / "frontend" / "tests" / "ui" / "datos"
    r = _calc(base, monkeypatch, dry_run=True)
    assert r == json.loads((datos / "globales_vista_previa.json").read_text(encoding="utf-8"))
    # Y la de las globales abiertas, que el panel muestra sin picks.
    base.tablas["tournaments"][0].update({"predictions_locked": False, "predictions_force_open": True})
    r = _calc(base, monkeypatch, dry_run=True)
    assert r == json.loads((datos / "globales_vista_previa_abiertas.json").read_text(encoding="utf-8"))


# --- Globales abiertas: ni se miran ni se reparten ---------------------------

def _abrir(base):
    """Temporada nueva sobre el torneo 2: el admin desbloquea y fuerza la
    apertura para que el grupo cargue sus globales (lo que hoy hace el panel)."""
    base.tablas["tournaments"][0].update({"predictions_locked": False, "predictions_force_open": True})
    assert base.globales_abiertas(2)


def test_el_doble_de_abiertas_es_la_condicion_de_produccion():
    # Los valores reales del 11 oct 2026: torneo 2 locked+force → cerradas.
    base = Base(REALES_CLAUSURA)
    assert base.globales_abiertas(2) is False
    # Desbloqueado pero sin forzar, con el torneo ya empezado: cerradas.
    base.tablas["tournaments"][0].update({"predictions_locked": False, "predictions_force_open": False})
    assert base.globales_abiertas(2) is False
    # Un torneo sin partidos está abierto (COALESCE a 'infinity').
    base.tablas["matches"] = []
    assert base.globales_abiertas(2) is True


def test_la_vista_previa_con_las_globales_abiertas_no_destapa_picks(monkeypatch):
    """La RLS de `tournament_predictions` no le deja ver al admin global las
    globales ajenas mientras están abiertas, y el admin global también juega.
    El backend corre con `service_role` y salta esa RLS: la vista previa no
    puede ser la puerta lateral."""
    base = Base({"actual_champion": None, "actual_top_scorer": None, "actual_top_assist": None})
    _abrir(base)
    r = _calc(base, monkeypatch, dry_run=True)
    assert r["abiertas"] is True
    assert ("tournament_predictions_open", {"p_tid": 2}) in base.rpcs
    for liga in r["ligas"]:
        assert set(liga) == {"league_id", "nombre", "puntos"}, liga
    # Ni siquiera se leen.
    texto = repr(r)
    for pick in ("Marcel", "Cisneros", "Elías Aguilar", "Newton"):
        assert pick not in texto
    # Lo que el panel necesita para elegir el campeón sí viene.
    assert r["equipos"] == EQUIPOS_TICA
    assert [l["nombre"] for l in r["ligas"]] == ["Bundestica", "Clausura 2027"]


def test_con_las_globales_abiertas_no_se_reparte(monkeypatch):
    base = Base(REALES_CLAUSURA)
    _abrir(base)
    with pytest.raises(HTTPException) as e:
        _calc(base, monkeypatch, league_id=CLAUSURA)
    assert e.value.status_code == 409 and "abiertas" in e.value.detail
    assert base.escrituras == [] and _recalculos(base) == []


def test_si_no_se_sabe_si_estan_abiertas_no_se_muestra_ni_se_reparte(monkeypatch):
    base = Base(REALES_CLAUSURA)
    base.falla_abiertas = True
    for kw in ({"dry_run": True}, {"league_id": CLAUSURA}):
        with pytest.raises(HTTPException) as e:
            _calc(base, monkeypatch, **kw)
        assert e.value.status_code == 503
    assert base.escrituras == []


# --- Lo que tiene que traer un reparto ---------------------------------------

def test_repartir_sin_lo_que_se_vio_no_escribe(monkeypatch):
    base = Base(REALES_CLAUSURA)
    with pytest.raises(HTTPException) as e:
        _calc(base, monkeypatch, league_id=CLAUSURA, esperado=None)
    assert e.value.status_code == 400
    with pytest.raises(HTTPException) as e:
        _calc(base, monkeypatch, league_id=CLAUSURA, esperado={"actual_champion": 1})
    assert e.value.status_code == 400
    assert base.escrituras == []


def test_por_http_los_datos_mal_formados_son_error_del_cliente(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    base = Base(REALES_CLAUSURA)
    monkeypatch.setattr(admin_mod, "get_supabase", lambda: base)
    app = FastAPI()
    app.include_router(admin_mod.router)
    app.dependency_overrides[admin_mod.require_admin] = lambda: {"sub": "admin"}
    cli = TestClient(app, raise_server_exceptions=False)

    r = cli.post("/api/admin/calc-tournament-globals",
                 json={"tournament_id": 2, "league_id": "bundestica", "esperado": REALES_CLAUSURA})
    assert r.status_code == 422, r.text
    r = cli.post("/api/admin/calc-tournament-globals",
                 json={"tournament_id": 2, "league_id": CLAUSURA, "esperado": {"actual_champion": 1}})
    assert r.status_code == 400, r.text
    r = cli.post("/api/admin/calc-tournament-globals", json={"tournament_id": 2, "league_id": CLAUSURA})
    assert r.status_code == 400, r.text
    assert base.escrituras == []


# --- Apóstrofos y guiones (nombres reales de `players`) ----------------------

@pytest.mark.parametrize("real,pick", [
    ("N'Golo Kanté", "N’Golo Kanté"),     # el iPhone escribe ’
    ("Ange N'Guessan", "Ange N‘Guessan"),
    ("Ian O’Rourke", "Ian O'Rourke"),     # y al revés: el admin desde el iPhone
    ("Marc-Oliver Kempf", "Marc Oliver Kempf"),
    ("Trent Alexander-Arnold", "trent alexander arnold"),
    ("Aaron Wan-Bissaka", "Aaron Wan–Bissaka"),
])
def test_apostrofos_y_guiones_no_dejan_a_nadie_en_cero(real, pick):
    assert rg.acierta(rg.alias(real, rg.SEPARADORES_JUGADOR), pick)


def test_los_guiones_no_vuelven_a_abrir_los_apellidos():
    assert not rg.acierta(rg.alias("Trent Alexander-Arnold", rg.SEPARADORES_JUGADOR), "Arnold")
    assert not rg.acierta(rg.alias("Lee Han-Beom", rg.SEPARADORES_JUGADOR), "Hwang In-Beom")
