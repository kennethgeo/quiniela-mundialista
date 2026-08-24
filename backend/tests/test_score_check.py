"""Tests del emparejador entre fuentes (ESPN vs UNAFUT).

Los nombres de equipo no coinciden entre fuentes y las diferencias son
caprichosas: una agrega el sufijo del club ("Escorpiones F.C."), la otra la
ciudad ("Escorpiones Belén"). Esto se rompe en silencio — emparejaría mal y
reportaría discrepancias falsas — así que los casos reales quedan fijados acá.
"""
import sys
import types
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(RAIZ / "backend"))

# httpx solo se usa para las llamadas HTTP; el emparejador es puro.
if "httpx" not in sys.modules:
    try:
        import httpx  # noqa: F401
    except ModuleNotFoundError:
        _stub = types.ModuleType("httpx")
        _stub.AsyncClient = object
        sys.modules["httpx"] = _stub

from app.services.score_check import _similitud, _tokens, emparejar  # noqa: E402


def _u(local, visita):
    return dict(local=local, visita=visita, goles_local="1", goles_visita="0",
                estado="COMPLETE", fecha=None, ronda=5)


# La jornada 5 real, con los nombres tal cual los da cada fuente.
JORNADA_REAL = [
    _u("Puntarenas F.C.", "Municipal Pérez Zeledón"),
    _u("Escorpiones F.C.", "C.S. Cartaginés"),
    _u("C.S. Herediano", "Sporting F.C."),
    _u("Inter San Carlos", "Deportivo Saprissa"),
    _u("L.D. Alajuelense", "A.D. San Carlos"),
]

NUESTROS = [
    ("Puntarenas FC", "Pérez Zeledón", "Puntarenas F.C."),
    ("Escorpiones Belén", "Cartaginés", "Escorpiones F.C."),
    ("Herediano", "Sporting San José", "C.S. Herediano"),
    ("Inter de San Carlos", "Saprissa", "Inter San Carlos"),
    ("Alajuelense", "AD San Carlos", "L.D. Alajuelense"),
]


@pytest.mark.parametrize("local,visita,esperado_local", NUESTROS,
                         ids=[f"{h} vs {a}" for h, a, _ in NUESTROS])
def test_empareja_los_cruces_reales(local, visita, esperado_local):
    pareja, puntaje = emparejar({"home_team": local, "away_team": visita, "kickoff_at": None},
                                JORNADA_REAL)
    assert pareja is not None, f"no emparejó (puntaje {puntaje})"
    assert pareja["local"] == esperado_local


@pytest.mark.parametrize("local,visita", [
    ("Alajuelense", "Saprissa"),        # cruce que no existe en esa jornada
    ("Herediano", "Cartaginés"),        # ambos equipos existen, el cruce no
])
def test_no_empareja_cruces_inexistentes(local, visita):
    pareja, _ = emparejar({"home_team": local, "away_team": visita, "kickoff_at": None},
                          JORNADA_REAL)
    assert pareja is None


class TestSimilitud:
    """La trampa de esta liga: 'AD San Carlos' e 'Inter de San Carlos'."""

    def test_el_sufijo_del_club_no_estorba(self):
        assert _similitud("Cartaginés", "C.S. Cartaginés") == 1.0
        assert _similitud("Alajuelense", "L.D. Alajuelense") == 1.0
        assert _similitud("Puntarenas FC", "Puntarenas F.C.") == 1.0

    def test_una_fuente_agrega_la_ciudad_y_la_otra_no(self):
        assert _similitud("Escorpiones Belén", "Escorpiones F.C.") == 1.0
        assert _similitud("Sporting San José", "Sporting F.C.") == 1.0

    def test_san_carlos_es_ambiguo_por_si_solo(self):
        # Los dos equipos comparten 'san carlos': por eso NO alcanza con
        # comparar un equipo, y el emparejado exige el cruce completo.
        assert _similitud("AD San Carlos", "Inter San Carlos") == 1.0

    def test_equipos_distintos_no_se_parecen(self):
        assert _similitud("Herediano", "Saprissa") == 0.0
        assert _similitud("Alajuelense", "Cartaginés") == 0.0

    def test_las_siglas_sueltas_se_descartan(self):
        # Al quitar la puntuación, "L.D." queda como "l" + "d": si esos tokens
        # sobrevivieran, bajarían la similitud sin motivo.
        assert _tokens("L.D. Alajuelense") == {"alajuelense"}
        assert _tokens("A.D. San Carlos") == {"san", "carlos"}
