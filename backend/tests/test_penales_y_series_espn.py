"""Penales automáticos y tramos de ida y vuelta en los torneos de ESPN
(vigésima auditoría, 1.1 y 1.3).

Los eventos de `datos/espn_penales_y_series.json` son el scoreboard REAL de
ESPN, recortado a lo que lee el parser. Con `lang=es` (como lo pide el sync) las
notas vienen en español; el bloque `en` es el mismo mes sin `lang`.

Tres partidos reales sostienen la regla de los penales:
  · Inglaterra 1-1 Suiza (703941) y Portugal 0-0 Francia (703940), Euro 2024:
    tandas de verdad sobre un empate → se marcan, con el que pasó.
  · Alajuelense 1-0 Puntarenas (735711), semifinal tica 2025: ESPN dice
    «FT-Pens» y fue un 1-0 REAL con gol en la prórroga → ni se marca ni se
    tocan los goles.
  · Liverpool 0-1 PSG (733605), vuelta de octavos: la tanda fue por el GLOBAL,
    el partido no terminó empatado → no se marca.
"""
import asyncio
import copy
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import app.services.espn_tournament_sync as sync  # noqa: E402
from app.services.espn_tournament_sync import (  # noqa: E402
    _assign_stages,
    _parse_event,
    _tramo_de_la_nota,
)

DATOS = json.loads((Path(__file__).parent / "datos" / "espn_penales_y_series.json").read_text())
EVENTOS = {ev["id"]: ev for ev in DATOS["es"]}
EVENTOS_EN = {ev["id"]: ev for ev in DATOS["en"]}


def _parsear(eid, eventos=EVENTOS):
    p = _parse_event(copy.deepcopy(eventos[eid]))
    _assign_stages([p])
    return p


# ── 1.1 penales ────────────────────────────────────────────────────────────

def test_una_tanda_real_sobre_un_empate_se_marca_con_el_que_paso():
    local = _parsear("703941")       # Inglaterra 1-1 Suiza, pasa el LOCAL
    assert (local["home_goals"], local["away_goals"]) == (1, 1)
    assert local["goes_to_penalties"] is True
    assert local["penalties_winner_real"] == "Inglaterra" == local["home_team"]

    visita = _parsear("703940")      # Portugal 0-0 Francia, pasa la VISITA
    assert visita["goes_to_penalties"] is True
    assert visita["penalties_winner_real"] == "Francia" == visita["away_team"]


def test_el_1_0_real_en_la_prorroga_queda_1_0_y_sin_penales():
    """735711: «FT-Pens» en ESPN, pero fue un gol en la prórroga. Restarle la
    tanda o sumar periodos lo convertía en 0-0: los goles no se tocan."""
    p = _parsear("735711")
    assert EVENTOS["735711"]["status"]["type"]["name"] == "STATUS_FINAL_PEN"
    assert (p["home_goals"], p["away_goals"]) == (1, 0)
    assert p["status"] == "finished"
    assert p["goes_to_penalties"] is False
    assert p["penalties_winner_real"] is None


def test_una_vuelta_definida_por_penales_en_el_global_no_se_marca():
    """Liverpool 0-1 PSG: hubo tanda (1-4) pero por el GLOBAL; en el partido
    ganó PSG. Marcarla bajaría un 0-1 exacto de 3 puntos a 1."""
    p = _parsear("733605")
    assert [c["shootoutScore"] for c in EVENTOS["733605"]["competitions"][0]["competitors"]] == [1, 4]
    assert (p["home_goals"], p["away_goals"]) == (0, 1)
    assert p["goes_to_penalties"] is False
    # Herediano 1-0 Alajuelense (702491), semifinal tica 2024: el mismo caso.
    assert _parsear("702491")["goes_to_penalties"] is False


def test_un_empate_de_eliminatoria_sin_tanda_no_se_marca():
    """Saprissa 2-2 Alajuelense (762650), ida de la final: empate sin tanda."""
    p = _parsear("762650")
    assert (p["home_goals"], p["away_goals"]) == (2, 2)
    assert p["goes_to_penalties"] is False


def test_una_vuelta_empatada_que_paso_por_el_global_no_se_marca():
    """EL CASO QUE HACE FALTA LA TANDA: Alajuelense 2-2 Herediano (723983,
    semifinal 2024) y Arsenal 2-2 PSV (733607). Empate en eliminatoria y ESPN
    marca `winner=true` al que pasó por el GLOBAL, sin ninguna tanda. Con solo
    «empate + eliminatoria + ganador» se habrían dado por definidos en penales."""
    for eid, quien in (("723983", "Herediano"), ("733607", "Arsenal")):
        comps = EVENTOS[eid]["competitions"][0]["competitors"]
        assert [c["team"]["displayName"] for c in comps if c["winner"]] == [quien]
        p = _parsear(eid)
        assert p["home_goals"] == p["away_goals"]
        assert p["goes_to_penalties"] is False, eid
        assert p["penalties_winner_real"] is None


def test_en_la_fase_regular_no_hay_penales():
    # Puntarenas 1-1 Cartaginés (692526), Clausura 2024 regular: ESPN marca
    # `winner=true` en un empate de liga. No hay tanda, pero tampoco eliminatoria.
    assert _parsear("692526")["goes_to_penalties"] is False
    ev = copy.deepcopy(EVENTOS["703941"])
    ev["season"]["slug"] = "apertura"
    p = _parse_event(ev)
    assert p["goes_to_penalties"] is False


def test_a_mitad_de_la_tanda_no_se_marca():
    """Con la tanda en curso no se escribe nada, aunque ya venga el marcador
    de la tanda y un `winner`: hasta que termine, manda el respaldo manual."""
    ev = copy.deepcopy(EVENTOS["703941"])
    ev["status"]["type"].update(name="STATUS_SHOOTOUT", state="in", completed=False)
    assert _parse_event(ev)["goes_to_penalties"] is False


# ── 1.3 ida y vuelta ───────────────────────────────────────────────────────

def test_el_tramo_sale_de_la_nota_real_y_nunca_cruda():
    esperado = {
        "735709": "Semifinal · Ida",        # 'Ida'
        "735712": "Semifinal · Vuelta",     # 'Juego de Vuelta - Saprissa avanza 4-2 en el global'
        "735795": "Final · Vuelta",         # '… Alajuelense Gana 4-3 en el global'
        "735928": "Gran final · Vuelta",
        "762650": "Final",                  # sin nota
        "733605": "Octavos · Vuelta",       # '… Empatados en el global - PSG avanza…'
        "703936": "Octavos",                # 'Portugal avanza 3-0 en tiros de penal'
    }
    assert {eid: _parsear(eid)["stage"] for eid in esperado} == esperado


def test_las_notas_en_ingles_dan_lo_mismo():
    assert _parsear("735709", EVENTOS_EN)["stage"] == "Semifinal · Ida"        # '1st Leg'
    assert _parsear("735712", EVENTOS_EN)["stage"] == "Semifinal · Vuelta"     # '2nd Leg - Saprissa advance…'
    assert _parsear("735795", EVENTOS_EN)["stage"] == "Final · Vuelta"


def test_lo_que_no_es_un_tramo_queda_vacio():
    for texto in ("Tied on aggregate", "Alajuelense win 4-3 on aggregate",
                  "Saprissa advance 4-2 on aggregate", "Portugal avanza 3-0 en tiros de penal", "", None):
        assert _tramo_de_la_nota(texto) == "", texto
    assert _tramo_de_la_nota("2nd Leg - Saprissa advance 4-2 on aggregate") == "Vuelta"
    assert _tramo_de_la_nota("1st Leg") == "Ida"


def test_ida_y_vuelta_caen_en_la_misma_bolsa_de_x2():
    """`clave_fase` corta en ' · ': el cupo es de la ronda."""
    semis = {_parsear(e)["stage"].split(" · ")[0] for e in ("735709", "735710", "735711", "735712")}
    assert semis == {"Semifinal"}


# ── el sync entero: qué escribe y cuándo vuelve a puntuar ──────────────────

class _R:
    def __init__(self, data):
        self.data = data


class _Consulta:
    def __init__(self, base, tabla):
        self.base, self.tabla, self.filtros, self.accion = base, tabla, [], ("select", None)

    def select(self, *_a, **_k):
        return self

    def eq(self, col, val):
        self.filtros.append(lambda f: f.get(col) == val)
        return self

    def in_(self, col, vals):
        vals = set(vals)
        self.filtros.append(lambda f: f.get(col) in vals)
        return self

    def update(self, cambios):
        self.accion = ("update", cambios)
        return self

    def upsert(self, filas, on_conflict=None):
        # Como PostgREST con default_to_null: en un lote todas las filas
        # tienen que traer las MISMAS columnas, o a alguna se le escribe NULL.
        claves = {frozenset(f) for f in filas}
        assert len(claves) <= 1, "upsert en lote con columnas distintas: PostgREST pondría NULL"
        self.accion = ("upsert", (filas, on_conflict))
        return self

    def execute(self):
        filas = self.base.tablas.setdefault(self.tabla, [])
        tipo, dato = self.accion
        if tipo == "upsert":
            nuevas, _ = dato
            self.base.upserts.append(copy.deepcopy(nuevas))
            for n in nuevas:
                actual = next((f for f in filas if f.get("tournament_id") == n["tournament_id"]
                               and f.get("external_id") == n["external_id"]), None)
                if actual is None:
                    filas.append({"id": 1000 + len(filas), **n})
                else:
                    actual.update(n)
            return _R([])
        elegidas = [f for f in filas if all(c(f) for c in self.filtros)]
        if tipo == "update":
            for f in elegidas:
                f.update(dato)
        return _R(copy.deepcopy(elegidas))


class _Base:
    def __init__(self, tablas):
        self.tablas, self.upserts = tablas, []

    def table(self, nombre):
        return _Consulta(self, nombre)

    def rpc(self, *_a, **_k):
        return _Consulta(self, "_rpc")


class _Respuesta:
    def __init__(self, datos):
        self.datos = datos

    def raise_for_status(self):
        pass

    def json(self):
        return self.datos


class _Cliente:
    def __init__(self, eventos):
        self.eventos = eventos

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_a):
        return False

    async def get(self, *_a, **_k):
        return _Respuesta({"events": copy.deepcopy(self.eventos)})


def _correr_sync(monkeypatch, eventos, guardados, torneo=None):
    puntuados = []

    async def falso_puntaje(_db, mid):
        puntuados.append(mid)

    monkeypatch.setattr(sync, "calculate_and_update_scores", falso_puntaje)
    monkeypatch.setattr(sync, "partidos_sin_puntuar", lambda *_a, **_k: set())
    monkeypatch.setattr(sync.httpx, "AsyncClient", lambda *a, **k: _Cliente(eventos))
    torneo = torneo or {"id": 9, "external_ref": "uefa.euro", "unafut_aviso_firma": None}
    base = _Base({"matches": guardados, "leagues": [], "users": [],
                  "tournaments": [{k: v for k, v in torneo.items() if k != "external_ref"}]})
    salida = asyncio.run(sync.sync_espn_tournament(base, torneo))
    por_eid = {f["external_id"]: f for f in base.tablas["matches"]}
    return salida, por_eid, puntuados, base


def _guardado(mid, eid, goles, penales=False, quien=None, bloqueado=False):
    return {"id": mid, "tournament_id": 9, "external_id": eid, "status": "finished",
            "home_goals_actual": goles[0], "away_goals_actual": goles[1], "score_locked": bloqueado,
            "kickoff_at": "2024-07-05T19:00Z", "phase": "knockout", "home_team": "x", "away_team": "y",
            "matchday": None, "jornada_oficial": None,
            "goes_to_penalties": penales, "penalties_winner_real": quien}


def test_el_sync_escribe_la_tanda_y_vuelve_a_puntuar(monkeypatch):
    """El partido ya estaba terminado 1-1: los goles no cambian, pero ESPN
    acaba de decir quién pasó. Sin mirar los penales no se re-puntuaba."""
    eventos = [EVENTOS["703941"], EVENTOS["703940"]]
    guardados = [_guardado(1, "703941", (1, 1)),
                 _guardado(2, "703940", (0, 0), True, "Francia")]   # ya estaba bien
    _salida, por_eid, puntuados, _ = _correr_sync(monkeypatch, eventos, guardados)
    assert por_eid["703941"]["goes_to_penalties"] is True
    assert por_eid["703941"]["penalties_winner_real"] == "Inglaterra"
    assert puntuados == [1], "o no re-puntuó el que cambió, o re-puntuó el que ya estaba"


def test_el_sync_no_borra_una_tanda_marcada_a_mano(monkeypatch):
    """El form de admin es el respaldo manual y NO congela el partido: si ESPN
    no dice nada, el sync tiene que reescribir lo que ya estaba."""
    eventos = [EVENTOS["762650"], EVENTOS["703941"]]
    guardados = [_guardado(5, "762650", (2, 2), True, "Saprissa")]
    _salida, por_eid, puntuados, base = _correr_sync(monkeypatch, eventos, guardados)
    assert por_eid["762650"]["goes_to_penalties"] is True
    assert por_eid["762650"]["penalties_winner_real"] == "Saprissa"
    assert 5 not in puntuados
    nuevo = por_eid["703941"]                                   # no estaba: nace con la tanda
    assert nuevo["goes_to_penalties"] is True and nuevo["penalties_winner_real"] == "Inglaterra"


def test_el_sync_no_toca_un_partido_congelado(monkeypatch):
    eventos = [EVENTOS["703936"], EVENTOS["762650"]]
    guardados = [_guardado(3, "703936", (0, 0), False, None, bloqueado=True)]
    _salida, por_eid, puntuados, base = _correr_sync(monkeypatch, eventos, guardados)
    assert por_eid["703936"]["goes_to_penalties"] is False
    assert all(f["external_id"] != "703936" for lote in base.upserts for f in lote)
    assert 3 not in puntuados
