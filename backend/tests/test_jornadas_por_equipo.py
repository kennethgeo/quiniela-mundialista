"""Cada equipo juega una vez por jornada (auditoría del 28 sep 2026).

EL FALLO: `_assign_stages` abría jornada nueva solo si pasaban MÁS de 48 h
entre partidos. La liga tica metió una jornada entre semana (14-16 oct) pegada
a la del fin de semana (18-20 oct) con exactamente 48 h de hueco, y las dos
quedaron como una «Jornada 11» de 10 partidos. El cupo del ×2 es por jornada:
quien gastó los suyos entre semana se quedaba sin ninguno el fin de semana, y
la pantalla decía lo mismo que la base, así que nadie lo notaba.

Los partidos de abajo son el calendario REAL de producción (hora UTC).
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.espn_tournament_sync import _assign_stages  # noqa: E402

# (id, kickoff UTC, local, visita) — jornadas reales 11 y 12 de la liga tica
OCTUBRE = [
    ("300", "2026-10-14T00:00:00Z", "Cartaginés", "Puntarenas FC"),
    ("298", "2026-10-14T02:00:00Z", "AD San Carlos", "Inter de San Carlos"),
    ("301", "2026-10-14T23:00:00Z", "Pérez Zeledón", "Escorpiones Belén"),
    ("299", "2026-10-15T02:00:00Z", "Alajuelense", "Herediano"),
    ("302", "2026-10-16T02:00:00Z", "Saprissa", "Sporting San José"),
    ("305", "2026-10-18T02:00:00Z", "Inter de San Carlos", "Alajuelense"),
    ("303", "2026-10-18T17:00:00Z", "Cartaginés", "Saprissa"),
    ("306", "2026-10-18T22:00:00Z", "Pérez Zeledón", "Herediano"),
    ("307", "2026-10-20T00:00:00Z", "Sporting San José", "AD San Carlos"),
    ("304", "2026-10-20T02:00:00Z", "Escorpiones Belén", "Puntarenas FC"),
]


def _partidos(filas):
    return [{"external_id": i, "kickoff_at": k, "home_team": h, "away_team": a,
             "stage_base": None, "leg": ""} for i, k, h, a in filas]


def test_dos_jornadas_pegadas_se_separan_por_equipo():
    partidos = _partidos(OCTUBRE)
    _assign_stages(partidos)
    por_id = {p["external_id"]: p["matchday"] for p in partidos}
    entre_semana = {por_id[i] for i in ("300", "298", "301", "299", "302")}
    fin_de_semana = {por_id[i] for i in ("305", "303", "306", "307", "304")}
    assert len(entre_semana) == 1 and len(fin_de_semana) == 1, por_id
    assert fin_de_semana != entre_semana, "dos jornadas reales quedaron como una"


def test_el_historial_tambien_se_separa_por_equipo():
    """El sync pasa lo ya guardado como `history`: también lleva equipos."""
    historial = [{"external_id": i, "kickoff_at": k, "home_team": h, "away_team": a}
                 for i, k, h, a in OCTUBRE[:5]]
    nuevos = _partidos(OCTUBRE[5:])
    _assign_stages(nuevos, historial)
    assert {p["matchday"] for p in nuevos} == {2}


def test_una_jornada_repartida_en_varios_dias_sigue_siendo_una():
    """Sin equipos repetidos y con huecos cortos, no se parte (viernes a lunes)."""
    partidos = _partidos(OCTUBRE[5:])
    _assign_stages(partidos)
    assert {p["matchday"] for p in partidos} == {1}
