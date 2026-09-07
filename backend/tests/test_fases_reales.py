"""Las fases que ESPN publica DE VERDAD en la Champions y en la liga tica.

POR QUÉ ESTE ARCHIVO. La etiqueta que sale de aquí no es decorativa: en las
ligas es la CLAVE del cupo de comodines ×2 (`clave_fase` en Postgres toma
`matches.stage` y lo recorta en ' · '). Si dos rondas distintas producen la
misma etiqueta, comparten cupo sin que nadie lo note; si una ronda no se
reconoce, cae en la fase regular y encima puntúa sin las reglas de penales.

Los slugs de abajo NO son inventados: salen de consultar el scoreboard de ESPN
para uefa.champions (temporadas 2025 y 2026) y crc.1 (2025 y 2026).

Dos cosas que esto sujeta y que estaban mal:
  · 'clausura---grand-finals' daba «Final», la misma clave que
    'clausura---playoff-finals'. En la liga tica son DOS series distintas: la
    final y, si el líder de la fase regular no la gana, la gran final.
  · 'knockout-round-playoffs' (la ronda previa a octavos de la Champions) caía
    en el comodín genérico «Eliminatoria» porque "knockout" se comprobaba antes
    que "playoff".
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import pytest  # noqa: E402

from app.services.espn_tournament_sync import (  # noqa: E402
    _es_eliminatoria, _stage_from_event,
)


def _ev(slug, notes=None):
    return {"season": {"slug": slug}, "competitions": [{"notes": notes or []}]}


# (slug real de ESPN, etiqueta esperada, ¿es eliminatoria?)
CHAMPIONS = [
    ("league-phase",            "Fase de liga", False),
    ("knockout-round-playoffs", "Repechaje",    True),
    ("round-of-16",             "Octavos",      True),
    ("quarterfinals",           "Cuartos",      True),
    ("semifinals",              "Semifinal",    True),
    ("final",                   "Final",        True),
]

LIGA_TICA = [
    ("apertura",                      None,          False),
    ("clausura",                      None,          False),
    ("apertura---playoff-semifinals", "Semifinal",   True),
    ("clausura---playoff-semifinals", "Semifinal",   True),
    ("apertura---playoff-finals",     "Final",       True),
    ("clausura---playoff-finals",     "Final",       True),
    ("clausura---grand-finals",       "Gran final",  True),
]


@pytest.mark.parametrize("slug,etiqueta,elim", CHAMPIONS + LIGA_TICA)
def test_slug_real_da_la_etiqueta_esperada(slug, etiqueta, elim):
    base, _leg = _stage_from_event(_ev(slug))
    assert base == etiqueta, f"{slug} -> {base!r}, se esperaba {etiqueta!r}"
    assert _es_eliminatoria(base) is elim


def test_la_gran_final_no_comparte_clave_con_la_final():
    """Si compartieran etiqueta compartirían cupo de ×2, y son dos series."""
    final, _ = _stage_from_event(_ev("clausura---playoff-finals"))
    gran, _ = _stage_from_event(_ev("clausura---grand-finals"))
    assert final != gran


def test_cada_ronda_de_la_champions_tiene_su_propia_clave():
    """Cinco rondas eliminatorias, cinco claves: si no, el cupo de la final
    sería el mismo que el de los octavos."""
    claves = [_stage_from_event(_ev(s))[0] for s, _, elim in CHAMPIONS if elim]
    assert len(set(claves)) == len(claves), claves


def test_la_ida_y_la_vuelta_van_a_la_misma_ronda():
    """El cupo es de la RONDA, no de cada partido: por eso `stage` lleva el
    tramo aparte y `clave_fase` lo recorta en ' · '."""
    ida, leg_ida = _stage_from_event(_ev("round-of-16", [{"text": "Ida"}]))
    vuelta, leg_vuelta = _stage_from_event(
        _ev("round-of-16", [{"text": "Juego de Vuelta - Arsenal avanza 3-1 en el global"}]))
    assert ida == vuelta == "Octavos"
    assert leg_ida != leg_vuelta   # el tramo sí cambia, y va después del ' · '


def test_una_ronda_desconocida_no_se_confunde_con_liga_regular():
    """Un slug que no se reconoce da None, y None = fase regular: matchday por
    fecha y puntaje SIN reglas de penales. Es el modo de fallo peligroso, así
    que queda escrito: si aparece una ronda nueva hay que mapearla."""
    base, _ = _stage_from_event(_ev("copa---repesca-intercontinental-2030"))
    assert base is None
    assert _es_eliminatoria(base) is False
