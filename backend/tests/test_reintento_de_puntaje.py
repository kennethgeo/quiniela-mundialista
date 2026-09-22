"""El puntaje que se perdía y no se reintentaba nunca.

EL FALLO (leído en el código el 22 sep 2026, a raíz de una auditoría externa):
`espn_tournament_sync` solo llamaba al motor de puntos cuando el partido
TRANSICIONABA a `finished` y envolvía la llamada en `except Exception: pass`.
Si el motor fallaba a mitad —el paso 4 es un UPDATE por predicción, no una
transacción—, la pasada siguiente veía el partido ya terminado y sin cambios y
no lo volvía a puntuar. Nunca.

ESTE ARCHIVO SE REESCRIBIÓ, y es la excepción consciente a «añadir, nunca
reescribir»: la primera versión probaba un arreglo que NO podía dispararse.
Buscaba `points_earned IS NULL` y sus datos de prueba usaban `None`, pero la
columna nace en 0 — medido, 0 NULL en toda la tabla. Las pruebas pasaban
sobre una base que no existe. Conservarlas sería dejar en verde algo que
afirma lo contrario de la realidad.

Regla que sale de acá: **los datos de una prueba tienen que ser los que la
base real produce**. Acá, predicciones que nacen con `points_earned = 0`.
"""
import asyncio
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import app.services.scoring as scoring  # noqa: E402
from app.services.scoring import (  # noqa: E402
    calculate_and_update_scores,
    firma_resultado,
    partidos_sin_puntuar,
)


# ---------------------------------------------------------------------------
# Doble de Supabase: tablas en memoria, con lo justo que usan el motor y el
# detector. Registra las escrituras y puede fallar a propósito.
# ---------------------------------------------------------------------------
class _R:
    def __init__(self, data):
        self.data = data


class _Q:
    def __init__(self, db, tabla):
        self.db, self.tabla = db, tabla
        self.filtros, self.valores, self.modo, self.unica = [], None, "select", False

    def select(self, *_a, **_k):
        return self

    def eq(self, col, val):
        self.filtros.append(lambda f, c=col, v=val: f.get(c) == v)
        return self

    def in_(self, col, vals):
        vals = list(vals)
        self.filtros.append(lambda f, c=col, v=vals: f.get(c) in v)
        return self

    def single(self):
        self.unica = True
        return self

    def update(self, valores):
        self.modo, self.valores = "update", valores
        return self

    def execute(self):
        if self.db.fallar_si and self.db.fallar_si(self):
            raise RuntimeError("corte con la base a mitad del lote")
        filas = [f for f in self.db.tablas[self.tabla] if all(g(f) for g in self.filtros)]
        if self.modo == "update":
            for f in filas:
                f.update(self.valores)
            self.db.escrituras.append((self.tabla, dict(self.valores), [f.get("id") for f in filas]))
            return _R(filas)
        if self.unica:
            return _R(filas[0] if filas else None)
        return _R([dict(f) for f in filas])


class FalsaBase:
    def __init__(self, matches, predictions, leagues=()):
        self.tablas = {"matches": matches, "predictions": predictions, "leagues": list(leagues)}
        self.escrituras = []
        self.fallar_si = None
        self.consultas = 0

    def table(self, nombre):
        self.consultas += 1
        return _Q(self, nombre)


def _partido(**k):
    base = {"id": 7, "home_team": "Saprissa", "away_team": "Alajuelense",
            "home_goals_actual": 2, "away_goals_actual": 1, "status": "finished",
            "goes_to_penalties": False, "penalties_winner_real": None, "puntuado_con": None}
    base.update(k)
    return base


def _prediccion(pid, h, a, **k):
    """Como nace en la base de verdad: `points_earned` en 0, nunca None."""
    base = {"id": pid, "user_id": f"u{pid}", "league_id": "L", "match_id": 7,
            "home_goals_pred": h, "away_goals_pred": a, "use_powerup_x2": False,
            "penalties_winner_pred": None, "points_earned": 0}
    base.update(k)
    return base


@pytest.fixture(autouse=True)
def _sin_push(monkeypatch):
    async def nada(*_a, **_k):
        return None
    monkeypatch.setattr(scoring, "broadcast_push_to_users", nada)


def _correr(coro):
    return asyncio.run(coro)


# ---------------------------------------------------------------------------
# La firma
# ---------------------------------------------------------------------------
def test_la_firma_cambia_con_todo_lo_que_decide_los_puntos():
    base = firma_resultado(_partido())
    assert firma_resultado(_partido(home_goals_actual=3)) != base
    assert firma_resultado(_partido(goes_to_penalties=True)) != base
    assert (firma_resultado(_partido(goes_to_penalties=True, penalties_winner_real="Saprissa"))
            != firma_resultado(_partido(goes_to_penalties=True, penalties_winner_real="Alajuelense")))


def test_la_firma_no_depende_de_lo_que_no_puntua():
    assert firma_resultado(_partido(home_team="X")) == firma_resultado(_partido())


# ---------------------------------------------------------------------------
# El detector
# ---------------------------------------------------------------------------
def test_un_partido_terminado_que_nunca_se_marco_se_reintenta():
    db = FalsaBase([_partido(puntuado_con=None)], [])
    assert partidos_sin_puntuar(db, [7]) == {7}


def test_un_cero_legitimo_NO_se_reintenta():
    """EL CASO QUE LA PRIMERA VERSIÓN CONFUNDÍA: todas las predicciones en 0
    porque nadie acertó. El partido está bien puntuado y no hay nada que hacer."""
    p = _partido()
    p["puntuado_con"] = firma_resultado(p)
    db = FalsaBase([p], [_prediccion(1, 0, 0), _prediccion(2, 0, 3)])
    assert partidos_sin_puntuar(db, [7]) == set()


def test_un_resultado_corregido_despues_de_puntuar_se_reintenta():
    """El admin corrige 2-1 por 2-2 y el re-puntaje falla: la firma vieja ya
    no coincide con el resultado nuevo."""
    p = _partido(home_goals_actual=2, away_goals_actual=2)
    p["puntuado_con"] = firma_resultado(_partido(home_goals_actual=2, away_goals_actual=1))
    db = FalsaBase([p], [])
    assert partidos_sin_puntuar(db, [7]) == {7}


def test_un_partido_por_jugar_no_se_reintenta():
    db = FalsaBase([_partido(status="pending", home_goals_actual=None, away_goals_actual=None)], [])
    assert partidos_sin_puntuar(db, [7]) == set()


def test_sin_partidos_no_se_consulta_la_base():
    """El cron corre cada minuto: una pasada sin terminados no cuesta nada."""
    db = FalsaBase([_partido()], [])
    assert partidos_sin_puntuar(db, []) == set()
    assert partidos_sin_puntuar(db, None) == set()
    assert db.consultas == 0


def test_si_la_columna_no_existe_todavia_no_revienta():
    """Código desplegado antes que la migración: se sigue sin reintento, sin 500."""
    db = FalsaBase([_partido()], [])
    db.fallar_si = lambda q: q.tabla == "matches"
    assert partidos_sin_puntuar(db, [7]) == set()


# ---------------------------------------------------------------------------
# El motor marca AL FINAL
# ---------------------------------------------------------------------------
def test_un_puntaje_completo_deja_la_firma():
    db = FalsaBase([_partido()], [_prediccion(1, 2, 1), _prediccion(2, 0, 0)],
                   [{"id": "L", "points_exact": 3, "points_correct": 1}])
    _correr(calculate_and_update_scores(db, 7))
    assert db.tablas["matches"][0]["puntuado_con"] == firma_resultado(_partido())
    assert partidos_sin_puntuar(db, [7]) == set()


def test_un_puntaje_que_se_cae_a_mitad_NO_deja_la_firma_y_se_reintenta():
    """El caso de verdad: predicciones nacidas en 0, el lote de UPDATE se corta
    en la segunda fila. Sin firma, la pasada siguiente lo completa."""
    db = FalsaBase([_partido()], [_prediccion(1, 2, 1), _prediccion(2, 2, 1)],
                   [{"id": "L", "points_exact": 3, "points_correct": 1}])
    escritas = []

    def corte(q):
        if q.tabla == "predictions" and q.modo == "update":
            escritas.append(1)
            return len(escritas) == 2
        return False

    db.fallar_si = corte
    with pytest.raises(RuntimeError):
        _correr(calculate_and_update_scores(db, 7))
    assert db.tablas["matches"][0]["puntuado_con"] is None
    assert partidos_sin_puntuar(db, [7]) == {7}, "el partido a medias tiene que reintentarse"

    # La pasada siguiente, sin corte, lo termina.
    db.fallar_si = None
    _correr(calculate_and_update_scores(db, 7))
    assert [p["points_earned"] for p in db.tablas["predictions"]] == [3, 3]
    assert partidos_sin_puntuar(db, [7]) == set()


def test_un_partido_sin_predicciones_tambien_queda_marcado():
    """Si no, se reintentaría en cada pasada del cron para siempre."""
    db = FalsaBase([_partido()], [])
    _correr(calculate_and_update_scores(db, 7))
    assert partidos_sin_puntuar(db, [7]) == set()


# ---------------------------------------------------------------------------
# El sync usa el detector y no se traga el error
# ---------------------------------------------------------------------------
def test_el_sync_reintenta_los_pendientes_y_no_se_traga_el_error():
    fuente = (Path(__file__).resolve().parents[1]
              / "app" / "services" / "espn_tournament_sync.py").read_text()
    assert "partidos_sin_puntuar" in fuente, "el sync no consulta los pendientes"
    assert "or mid in pendientes" in fuente, "los pendientes no entran en `changed`"
    assert "scoring_errors" in fuente, "los fallos de puntaje no se reportan"
    cuerpo = fuente[fuente.index("    scored = 0"):fuente.index("# Recalcular medallas")]
    assert "except Exception:  # noqa: BLE001\n                pass" not in cuerpo, \
        "el fallo de puntaje se vuelve a tragar en silencio"
