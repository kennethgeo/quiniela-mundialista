"""La fase de liga de la Champions NO es eliminatoria.

ESPN manda season.slug = 'league-phase' en los 100 partidos de la fase de liga
del formato nuevo. Tratarla como eliminatoria tenía tres efectos, y ninguno se
veía hasta que empezara el torneo:

  1. matchday NULL -> sin jornadas.
  2. El cupo de comodines x2 es por (fase, jornada): con jornada nula daría UN
     comodín para los 100 partidos en vez de uno por jornada.
  3. live_sync marca como "definido por penales" todo empate con
     phase != 'groups'.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from app.services.espn_tournament_sync import (  # noqa: E402
    _assign_stages, _es_eliminatoria, _stage_from_event,
)


def _ev(slug, notes=None):
    return {"season": {"slug": slug}, "competitions": [{"notes": notes or []}]}


def test_league_phase_no_es_eliminatoria():
    base, _ = _stage_from_event(_ev("league-phase"))
    assert base == "Fase de liga"
    assert _es_eliminatoria(base) is False


def test_fase_de_grupos_tampoco():
    base, _ = _stage_from_event(_ev("group-stage"))
    assert base == "Fase de grupos"
    assert _es_eliminatoria(base) is False


def test_las_de_verdad_si_son_eliminatoria():
    for slug, etiqueta in [
        ("round-of-16", "Octavos"), ("quarterfinals", "Cuartos"),
        ("semifinals", "Semifinal"), ("final", "Final"),
    ]:
        base, _ = _stage_from_event(_ev(slug))
        assert base == etiqueta, slug
        assert _es_eliminatoria(base) is True, slug


def test_la_fase_de_liga_recibe_jornadas():
    """Dos jornadas separadas por semanas, cada una repartida en dos días."""
    partidos = [
        {"external_id": "1", "kickoff_at": "2026-09-15T19:00:00Z", "stage_base": "Fase de liga", "leg": ""},
        {"external_id": "2", "kickoff_at": "2026-09-16T19:00:00Z", "stage_base": "Fase de liga", "leg": ""},
        {"external_id": "3", "kickoff_at": "2026-09-30T19:00:00Z", "stage_base": "Fase de liga", "leg": ""},
        {"external_id": "4", "kickoff_at": "2026-10-01T19:00:00Z", "stage_base": "Fase de liga", "leg": ""},
    ]
    _assign_stages(partidos)
    md = [p["matchday"] for p in partidos]
    assert md == [1, 1, 2, 2], md
    assert all(p["stage"] == f"Jornada {p['matchday']}" for p in partidos)


def test_los_octavos_siguen_sin_jornada():
    partidos = [
        {"external_id": "9", "kickoff_at": "2027-02-17T20:00:00Z", "stage_base": "Octavos", "leg": "Ida"},
    ]
    _assign_stages(partidos)
    assert partidos[0]["matchday"] is None
    assert partidos[0]["stage"] == "Octavos · Ida"
