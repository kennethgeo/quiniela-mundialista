"""Cómo se le piden los partidos al scoreboard de ESPN.

EL FALLO QUE ESTO FIJA (medido el 19 sep 2026, no supuesto): el scoreboard
devuelve **cero eventos** para cualquier rango `YYYYMMDD-YYYYMMDD`, y sin dar
ningún error — un 200 con `events: []`. Comprobado en crc.1, uefa.champions,
esp.1 y eng.1, y hasta con un rango de un solo día. El mismo mes pedido como
`YYYYMM` devuelve 15, 18, 39 y 30 eventos.

El sync consultaba justo con rangos, así que **cada corrida del cron traía una
lista vacía y no escribía nada**. El síntoma que lo destapó: un partido
terminado doce horas antes seguía apareciendo «en juego» en la app.
"""
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.espn_tournament_sync import _meses, _ventanas  # noqa: E402

AHORA = datetime(2026, 9, 19, 13, 0, tzinfo=timezone.utc)
SOLO_MES = re.compile(r"^\d{6}$")


def test_nunca_se_pide_un_rango():
    """LA REGLA. Un valor con guion devuelve cero eventos y ningún error, así
    que el sync se queda mudo y nadie se entera."""
    for full in (False, True):
        for v in _ventanas(AHORA, full):
            assert SOLO_MES.match(v), f"«{v}» no es un mes YYYYMM"
            assert "-" not in v


def test_la_ventana_movil_cubre_lo_reciente_y_lo_proximo():
    """3 días atrás y 21 adelante: desde el 19 de septiembre eso toca
    septiembre y octubre."""
    assert _ventanas(AHORA, False) == ["202609", "202610"]


def test_la_ventana_movil_no_se_pasa_de_dos_meses():
    """Una petición por mes: la ventana móvil nunca debería costar más de dos."""
    for dia in range(1, 29):
        ahora = AHORA.replace(day=dia)
        assert len(_ventanas(ahora, False)) <= 2


def test_el_partido_de_ayer_cae_dentro_de_la_ventana():
    """El caso real: Pérez Zeledón–Sporting, 2026-09-19T02:00Z. Con la ventana
    móvil del día siguiente su mes tiene que estar en la lista, o el resultado
    no se escribe nunca."""
    assert "202609" in _ventanas(AHORA, False)


def test_la_temporada_completa_va_mes_a_mes_sin_huecos():
    meses = _ventanas(AHORA, True)
    assert all(SOLO_MES.match(m) for m in meses)
    assert meses == sorted(meses), "los meses van en orden"
    assert len(meses) == len(set(meses)), "sin meses repetidos"
    # De ~10 meses atrás a ~5 adelante.
    assert meses[0] == "202511" and meses[-1] == "202702"


def test_meses_incluye_los_dos_extremos():
    d = datetime(2026, 1, 15, tzinfo=timezone.utc)
    assert _meses(d, d) == ["202601"]
    assert _meses(d, d + timedelta(days=31)) == ["202601", "202602"]


def test_meses_cruza_el_cambio_de_año():
    """Diciembre a enero: sin esto, la ventana de fin de año se quedaría vacía
    justo en la jornada de Navidad."""
    assert _meses(datetime(2026, 12, 20, tzinfo=timezone.utc),
                  datetime(2027, 1, 10, tzinfo=timezone.utc)) == ["202612", "202701"]
