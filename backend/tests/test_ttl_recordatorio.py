"""El recordatorio no puede llegar con las predicciones ya cerradas (auditoría 19).

Un reintento a T-16 con TTL fijo de 30 min podía entregarse a T+14. El TTL se
acota al cierre (saque - 15 min) del partido más próximo del envío.
"""
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.routes.matches import TTL_RECORDATORIO, ttl_recordatorio  # noqa: E402

AHORA = datetime(2026, 10, 14, 0, 0, tzinfo=timezone.utc)


def _p(minutos):
    return {"kickoff_at": (AHORA + timedelta(minutes=minutos)).isoformat()}


def test_ventana_normal_usa_los_30_minutos():
    assert ttl_recordatorio([_p(50)], AHORA) == TTL_RECORDATORIO


def test_un_reintento_tardio_no_pasa_del_cierre():
    assert ttl_recordatorio([_p(20)], AHORA) == 5 * 60


def test_manda_el_partido_mas_proximo():
    assert ttl_recordatorio([_p(55), _p(25)], AHORA) == 10 * 60


def test_nunca_menos_de_un_minuto_ni_sin_partidos():
    assert ttl_recordatorio([_p(15)], AHORA) == 60
    assert ttl_recordatorio([], AHORA) == TTL_RECORDATORIO
