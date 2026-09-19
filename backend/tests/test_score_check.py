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


# ─────────────────────────────────────────────────────────────────────────────
# EL HUECO QUE ESTE CRUCE NO MIRABA (19 sep 2026)
#
# Pérez Zeledón–Sporting terminó el viernes, UNAFUT lo daba `COMPLETE` 1-2, y
# nuestra base lo tenía en `pending` sin marcador porque el sync llevaba días
# sin escribir nada. La alarma ya existía —este mismo archivo— pero solo miraba
# partidos que NOSOTROS ya teníamos en `finished`, así que uno que el sync
# nunca escribió ni entraba en la comparación: estaba instalada y mirando al
# lado del incendio.
# ─────────────────────────────────────────────────────────────────────────────
from datetime import datetime, timedelta, timezone  # noqa: E402

from app.services.score_check import (  # noqa: E402
    HORAS_PARA_SOSPECHAR, clasificar, sospechosos,
)

SAQUE = "2026-09-19T02:00:00Z"


def _nuestro(id_, local, visita, gl=None, gv=None, status="finished", **extra):
    return {"id": id_, "home_team": local, "away_team": visita,
            "home_goals_actual": gl, "away_goals_actual": gv,
            "status": status, "matchday": 9, "kickoff_at": SAQUE,
            "score_locked": False, **extra}


def _suyo(local, visita, gl, gv, estado="COMPLETE"):
    return {"local": local, "visita": visita,
            "goles_local": str(gl) if gl is not None else None,
            "goles_visita": str(gv) if gv is not None else None,
            "estado": estado,
            "fecha": datetime.fromisoformat(SAQUE.replace("Z", "+00:00")),
            "ronda": 9}


class TestHuecosNuestros:
    """No son desacuerdos entre fuentes: no hay dos marcadores que comparar."""

    def test_la_liga_lo_cerro_y_nosotros_no_lo_tenemos(self):
        _, faltantes, _, _ = clasificar(
            [_nuestro(290, "Pérez Zeledón", "Sporting San José", status="pending")],
            [_suyo("Municipal Pérez Zeledón", "Sporting F.C.", 1, 2)])
        assert len(faltantes) == 1
        assert faltantes[0]["match_id"] == 290
        assert faltantes[0]["unafut"] == "1-2"
        assert faltantes[0]["nuestro_estado"] == "pending"

    def test_uno_en_curso_para_nosotros_tambien_es_hueco(self):
        """El sync pudo abrirlo y no cerrarlo nunca."""
        _, faltantes, _, _ = clasificar(
            [_nuestro(290, "Pérez Zeledón", "Sporting San José", status="in_progress")],
            [_suyo("Municipal Pérez Zeledón", "Sporting F.C.", 1, 2)])
        assert len(faltantes) == 1

    def test_si_la_liga_TAMPOCO_lo_cerro_no_hay_hueco(self):
        _, faltantes, _, _ = clasificar(
            [_nuestro(290, "Pérez Zeledón", "Sporting San José", status="pending")],
            [_suyo("Municipal Pérez Zeledón", "Sporting F.C.", None, None, estado="IN_PROGRESS")])
        assert faltantes == []

    def test_sin_pareja_no_se_afirma_que_falte(self):
        """Sin pareja no se sabe nada; decir que falta el resultado sería
        inventar, y encima mandaría al admin a buscar un fallo que no existe."""
        disc, faltantes, sin_pareja, _ = clasificar(
            [_nuestro(290, "Equipo Fantasma", "Otro Fantasma", status="pending")],
            [_suyo("Municipal Pérez Zeledón", "Sporting F.C.", 1, 2)])
        assert (disc, faltantes) == ([], [])
        assert len(sin_pareja) == 1


class TestDesacuerdos:
    """Lo que el cruce ya hacía, y que no se puede haber roto al ampliarlo."""

    def test_dos_marcadores_distintos_siguen_siendo_discrepancia(self):
        disc, faltantes, _, comparados = clasificar(
            [_nuestro(290, "Pérez Zeledón", "Sporting San José", 0, 0)],
            [_suyo("Municipal Pérez Zeledón", "Sporting F.C.", 1, 2)])
        assert faltantes == [], "es un desacuerdo, no un hueco"
        assert comparados == 1
        assert disc[0]["nuestro"] == "0-0" and disc[0]["unafut"] == "1-2"

    def test_un_marcador_fijado_a_mano_se_marca_como_esperado(self):
        """Una sanción o un walkover difieren a propósito."""
        disc, _, _, _ = clasificar(
            [_nuestro(290, "Pérez Zeledón", "Sporting San José", 3, 0, score_locked=True)],
            [_suyo("Municipal Pérez Zeledón", "Sporting F.C.", 1, 2)])
        assert disc[0]["esperado"] is True

    def test_iguales_no_reportan_nada(self):
        assert clasificar(
            [_nuestro(290, "Pérez Zeledón", "Sporting San José", 1, 2)],
            [_suyo("Municipal Pérez Zeledón", "Sporting F.C.", 1, 2)]) == ([], [], [], 1)


class _BaseFalsa:
    """Lo mínimo del cliente de Supabase para `sospechosos`."""

    def __init__(self, filas):
        self.filas, self.pedido = filas, {}

    def table(self, _):
        return self

    def select(self, *_a, **_k):
        return self

    def in_(self, campo, valores):
        self.pedido[campo] = valores
        return self

    def lt(self, campo, valor):
        self.pedido[campo] = valor
        return self

    def execute(self):
        return type("R", (), {"data": self.filas})()


AHORA = datetime(2026, 9, 19, 13, 0, tzinfo=timezone.utc)


class TestElVigilanteNoLlamaDeMas:
    """Esto corre en cada pasada del cron —cada minuto—, así que en una pasada
    normal no puede costar ni una petición a UNAFUT."""

    def test_sin_partidos_viejos_sin_resultado_no_consulta_nada(self):
        assert sospechosos(_BaseFalsa([]), AHORA) == {}

    def test_cuenta_los_huecos_por_torneo(self):
        base = _BaseFalsa([{"tournament_id": 2}, {"tournament_id": 2}, {"tournament_id": 6}])
        assert sospechosos(base, AHORA) == {2: 2, 6: 1}

    def test_solo_mira_lo_no_cerrado_con_el_saque_pasado(self):
        base = _BaseFalsa([])
        sospechosos(base, AHORA)
        assert base.pedido["status"] == ["pending", "in_progress"]
        assert base.pedido["kickoff_at"] == (AHORA - timedelta(hours=HORAS_PARA_SOSPECHAR)).isoformat()

    def test_el_umbral_coincide_con_el_de_la_pantalla(self):
        """La pantalla deja de decir «en juego» a las 4 horas del saque
        (`MINUTOS_MAXIMOS_DE_PARTIDO` = 240). Dos números distintos dejarían
        una franja en la que la app dice «sin datos» y nadie está mirando."""
        assert HORAS_PARA_SOSPECHAR * 60 == 240
