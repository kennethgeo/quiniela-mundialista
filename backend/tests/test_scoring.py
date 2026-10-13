"""Tests del motor de puntaje (Python), el ÚNICO que hay.

Corre el corpus de shared/scoring_cases.json contra backend/app/services/
scoring.py. Ese corpus es la red que protege el puntaje: si un cambio en el
motor mueve el resultado de cualquier caso, el CI falla.

scoring.py importa app.services.notifications, que a su vez necesita pywebpush.
Para no arrastrar todas las dependencias del backend solo para probar una
función pura, se stubea ese módulo antes de importar. Así el CI corre estos
tests con pytest y nada más.
"""
import importlib
import json
import sys
import types
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(RAIZ / "backend"))

# Stub de notifications: scoring.py solo usa broadcast_push_to_users al puntuar
# un partido completo, no en evaluate_prediction.
_stub = types.ModuleType("app.services.notifications")


async def _noop(*_args, **_kwargs):
    return None


_stub.broadcast_push_to_users = _noop
sys.modules.setdefault("app.services.notifications", _stub)

scoring = importlib.import_module("app.services.scoring")

CORPUS = json.loads((RAIZ / "shared" / "scoring_cases.json").read_text(encoding="utf-8"))


def _ids(casos):
    return [c["nombre"] for c in casos]


@pytest.mark.parametrize("caso", CORPUS["casos"], ids=_ids(CORPUS["casos"]))
def test_corpus_compartido(caso):
    penales = caso.get("penales") or {}
    puntos = scoring.evaluate_prediction(
        caso["pred"],
        caso["real"]["home"],
        caso["real"]["away"],
        penales.get("va", False),
        penales.get("ganador_real"),
        "Local",
        "Visita",
    )
    assert puntos == caso["esperado"]


def test_comodin_multiplica_no_suma():
    base = dict(home_goals_pred=1, away_goals_pred=0)
    sin = scoring.evaluate_prediction(base, 1, 0, False, None, "Local", "Visita")
    con = scoring.evaluate_prediction(
        dict(base, use_powerup_x2=True), 1, 0, False, None, "Local", "Visita"
    )
    assert con == sin * 2


def test_comodin_sobre_un_fallo_sigue_siendo_cero():
    pred = dict(home_goals_pred=0, away_goals_pred=3, use_powerup_x2=True)
    assert scoring.evaluate_prediction(pred, 3, 0, False, None, "Local", "Visita") == 0


class TestPuntajePorQuiniela:
    """El motor respeta el puntaje configurado de cada quiniela.

    El corpus usa siempre 3/1, así que acá viven los casos con otra
    configuración (5/2): con 3/1 no se distingue «sumar 1» de «sumar
    points_correct», y es justo la diferencia que hay que fijar en penales.
    """

    def test_usa_points_exact_de_la_config(self):
        pred = dict(home_goals_pred=1, away_goals_pred=0)
        cfg = {"points_exact": 5, "points_correct": 2}
        assert scoring.evaluate_prediction(pred, 1, 0, False, None, "Local", "Visita", config=cfg) == 5

    def test_usa_points_correct_de_la_config(self):
        pred = dict(home_goals_pred=3, away_goals_pred=0)
        cfg = {"points_exact": 5, "points_correct": 2}
        assert scoring.evaluate_prediction(pred, 2, 1, False, None, "Local", "Visita", config=cfg) == 2

    def test_la_config_tambien_se_duplica_con_el_comodin(self):
        pred = dict(home_goals_pred=1, away_goals_pred=0, use_powerup_x2=True)
        cfg = {"points_exact": 5, "points_correct": 2}
        assert scoring.evaluate_prediction(pred, 1, 0, False, None, "Local", "Visita", config=cfg) == 10

    def test_sin_config_cae_al_default_3_1(self):
        pred = dict(home_goals_pred=1, away_goals_pred=0)
        assert scoring.evaluate_prediction(pred, 1, 0, False, None, "Local", "Visita") == 3

    def test_el_mas_uno_de_la_tanda_es_fijo_no_points_correct(self):
        """Con 5/2, un 0-0 exacto con la tanda acertada vale 5 + 1 = 6, no 7.

        El +1 por acertar quién pasa es fijo (CLAUDE.md, «Eliminatoria —
        penales»). Si alguien lo cambia por points_correct, con 3/1 no se nota
        —1 es 1— y el corpus entero sigue en verde: por eso este caso.
        """
        pred = dict(home_goals_pred=0, away_goals_pred=0, penalties_winner_pred="Local")
        cfg = {"points_exact": 5, "points_correct": 2}
        assert scoring.evaluate_prediction(pred, 0, 0, True, "Local", "Local", "Visita", config=cfg) == 6

    def test_el_mas_uno_fijo_tambien_en_el_empate_no_exacto(self):
        # 1-1 contra 2-2: points_correct (2) + 1 fijo = 3, y con ×2 = 6.
        pred = dict(home_goals_pred=1, away_goals_pred=1, penalties_winner_pred="Local")
        cfg = {"points_exact": 5, "points_correct": 2}
        assert scoring.evaluate_prediction(pred, 2, 2, True, "Local", "Local", "Visita", config=cfg) == 3
        con_x2 = dict(pred, use_powerup_x2=True)
        assert scoring.evaluate_prediction(con_x2, 2, 2, True, "Local", "Local", "Visita", config=cfg) == 6
