"""Recordatorio 45 minutos antes del saque.

Lo que se cuida acá: que nadie reciba el aviso dos veces, y que no le llegue a
quien ya predijo. Las dos cosas se equivocan en silencio — nadie reporta "me
llegaron dos push", simplemente apaga las notificaciones.
"""
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.resumen_diario import (  # noqa: E402
    ANCHO_VENTANA_MIN, MINUTOS_AVISO, armar_recordatorios, ventana_recordatorio,
)


def _p(pid, kickoff, torneo=6, local="Saprissa", visita="Alajuelense"):
    return {"id": pid, "tournament_id": torneo, "home_team": local,
            "away_team": visita, "kickoff_at": kickoff}


def test_cada_partido_cae_en_una_sola_corrida():
    """El caso que de verdad importa: el cron corre cada 15 min durante horas y
    ningún partido puede entrar en dos ventanas."""
    saque = datetime(2026, 9, 8, 20, 0, tzinfo=timezone.utc)
    veces = 0
    # Cuatro horas de corridas cada 15 minutos alrededor del saque.
    t = saque - timedelta(hours=3)
    while t <= saque + timedelta(hours=1):
        desde, hasta = ventana_recordatorio(t)
        if desde <= saque < hasta:
            veces += 1
        t += timedelta(minutes=ANCHO_VENTANA_MIN)
    assert veces == 1, f"el partido entró en {veces} corridas"


def test_tambien_con_saques_en_minutos_raros():
    """Un saque a las 20:07 no cae en el reloj del cron: igual debe avisarse
    una sola vez."""
    for minuto in range(0, 60):
        saque = datetime(2026, 9, 8, 20, minuto, tzinfo=timezone.utc)
        veces = 0
        t = datetime(2026, 9, 8, 17, 0, tzinfo=timezone.utc)
        while t <= saque:
            desde, hasta = ventana_recordatorio(t)
            if desde <= saque < hasta:
                veces += 1
            t += timedelta(minutes=ANCHO_VENTANA_MIN)
        assert veces == 1, f"saque :{minuto:02d} entró {veces} veces"


def test_la_ventana_empieza_a_los_45():
    ahora = datetime(2026, 9, 8, 19, 0, tzinfo=timezone.utc)
    desde, hasta = ventana_recordatorio(ahora)
    assert desde == ahora + timedelta(minutes=MINUTOS_AVISO)
    assert (hasta - desde) == timedelta(minutes=ANCHO_VENTANA_MIN)


def test_no_se_avisa_a_quien_ya_predijo():
    partidos = [_p(1, "2026-09-08T20:00:00Z")]
    membresias = [{"league_id": 9, "user_id": "ana", "tournament_id": 6},
                  {"league_id": 9, "user_id": "beto", "tournament_id": 6}]
    predicciones = [{"user_id": "ana", "league_id": 9, "match_id": 1}]
    m = armar_recordatorios(partidos, membresias, predicciones)
    assert "ana" not in m
    assert "beto" in m


def test_estar_en_dos_quinielas_y_predecir_en_una_deja_pendiente():
    partidos = [_p(1, "2026-09-08T20:00:00Z")]
    membresias = [{"league_id": 9, "user_id": "ana", "tournament_id": 6},
                  {"league_id": 10, "user_id": "ana", "tournament_id": 6}]
    predicciones = [{"user_id": "ana", "league_id": 9, "match_id": 1}]
    assert "ana" in armar_recordatorios(partidos, membresias, predicciones)


def test_el_texto_dice_cuantas_faltan_y_cuando_cierra():
    partidos = [_p(1, "2026-09-08T20:00:00Z"), _p(2, "2026-09-08T20:00:00Z", local="Herediano")]
    membresias = [{"league_id": 9, "user_id": "ana", "tournament_id": 6}]
    m = armar_recordatorios(partidos, membresias, [])
    assert "Te faltan 2" in m["ana"]["body"]
    assert "15 min" in m["ana"]["body"]
    # 20:00 UTC son las 2:00 pm en Costa Rica (UTC-6, sin horario de verano).
    assert "14:00" in m["ana"]["body"]


def test_una_sola_pendiente_usa_singular():
    partidos = [_p(1, "2026-09-08T20:00:00Z")]
    m = armar_recordatorios(partidos, [{"league_id": 9, "user_id": "ana", "tournament_id": 6}], [])
    assert "No has predicho" in m["ana"]["body"]


def test_partido_de_otro_torneo_no_genera_aviso():
    partidos = [_p(1, "2026-09-08T20:00:00Z", torneo=6)]
    membresias = [{"league_id": 9, "user_id": "ana", "tournament_id": 1}]
    assert armar_recordatorios(partidos, membresias, []) == {}


def test_sin_partidos_no_se_manda_nada():
    assert armar_recordatorios([], [{"league_id": 9, "user_id": "ana", "tournament_id": 6}], []) == {}
