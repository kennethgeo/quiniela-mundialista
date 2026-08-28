"""Tests del resumen diario.

Lo que se cuida: a quién se le manda y qué dice. La cañería del push se prueba
sola en producción; esto no.
"""
import sys
from datetime import datetime, timezone
from pathlib import Path

# Igual que test_scoring.py: el CI corre pytest desde la raíz del repo, así que
# 'app' no está en el path a menos que se agregue backend/ a mano.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.resumen_diario import armar_mensajes, ventana_del_dia  # noqa: E402


def partido(id_, hora_utc, tid=1, local="Saprissa", visita="Herediano"):
    return {"id": id_, "tournament_id": tid, "home_team": local,
            "away_team": visita, "kickoff_at": hora_utc}


class TestVentanaDelDia:
    def test_a_las_6am_de_costa_rica_el_dia_ya_empezo(self):
        # 12:00 UTC = 6:00 en Costa Rica. El día local va de 06:00Z a 06:00Z.
        ahora = datetime(2026, 8, 26, 12, 0, tzinfo=timezone.utc)
        desde, hasta = ventana_del_dia(ahora)
        assert desde == datetime(2026, 8, 26, 6, 0, tzinfo=timezone.utc)
        assert hasta == datetime(2026, 8, 27, 6, 0, tzinfo=timezone.utc)

    def test_un_partido_de_las_8pm_de_anoche_no_es_de_hoy(self):
        # 8pm del 25 en Costa Rica = 02:00Z del 26. Si se usara el día UTC,
        # a las 6am del 26 ese partido aparecería como "de hoy".
        ahora = datetime(2026, 8, 26, 12, 0, tzinfo=timezone.utc)
        desde, _ = ventana_del_dia(ahora)
        anoche = datetime(2026, 8, 26, 2, 0, tzinfo=timezone.utc)
        assert anoche < desde


class TestArmarMensajes:
    membresias = [{"league_id": "L1", "user_id": "ana", "tournament_id": 1},
                  {"league_id": "L1", "user_id": "beto", "tournament_id": 1}]

    def test_sin_partidos_no_manda_nada(self):
        assert armar_mensajes([], self.membresias, []) == {}

    def test_avisa_a_todos_los_del_torneo(self):
        m = armar_mensajes([partido(1, "2026-08-26T20:00:00Z")], self.membresias, [])
        assert set(m) == {"ana", "beto"}

    def test_no_avisa_de_un_torneo_que_no_jugas(self):
        m = armar_mensajes([partido(1, "2026-08-26T20:00:00Z", tid=9)], self.membresias, [])
        assert m == {}

    def test_solo_cuentan_los_partidos_del_torneo_de_TU_quiniela(self):
        # Hoy juegan dos torneos, pero Ana solo está en una quiniela del 1.
        # No debe enterarse del otro ni contarlo en el total.
        partidos = [partido(1, "2026-08-26T20:00:00Z", tid=1, local="Saprissa", visita="Herediano"),
                    partido(2, "2026-08-26T21:00:00Z", tid=2, local="Barcelona", visita="Madrid")]
        m = armar_mensajes(partidos, [{"league_id": "L1", "user_id": "ana", "tournament_id": 1}], [])
        assert "Hoy hay 1 partido ·" in m["ana"]["title"]
        assert "Saprissa" in m["ana"]["body"]
        assert "Barcelona" not in m["ana"]["body"]

    def test_sin_ninguna_quiniela_de_ese_torneo_no_se_avisa_a_nadie(self):
        m = armar_mensajes([partido(1, "2026-08-26T20:00:00Z", tid=1)], [], [])
        assert m == {}

    def test_cuenta_lo_que_falta_por_predecir(self):
        partidos = [partido(1, "2026-08-26T20:00:00Z"), partido(2, "2026-08-26T22:00:00Z")]
        preds = [{"league_id": "L1", "match_id": 1, "user_id": "ana"}]
        m = armar_mensajes(partidos, self.membresias, preds)
        assert "Te falta 1 por predecir" in m["ana"]["title"]
        assert "Te faltan 2 por predecir" in m["beto"]["title"]

    def test_a_quien_ya_predijo_todo_se_lo_dice(self):
        preds = [{"league_id": "L1", "match_id": 1, "user_id": "ana"}]
        m = armar_mensajes([partido(1, "2026-08-26T20:00:00Z")], self.membresias, preds)
        assert "Ya predijiste todo" in m["ana"]["title"]

    def test_en_dos_quinielas_del_mismo_torneo_falta_igual(self):
        # Predijo en L1 pero no en L2: el partido sigue pendiente.
        membresias = [{"league_id": "L1", "user_id": "ana", "tournament_id": 1},
                      {"league_id": "L2", "user_id": "ana", "tournament_id": 1}]
        preds = [{"league_id": "L1", "match_id": 1, "user_id": "ana"}]
        m = armar_mensajes([partido(1, "2026-08-26T20:00:00Z")], membresias, preds)
        assert "Te falta 1 por predecir" in m["ana"]["title"]

    def test_la_hora_sale_en_hora_de_costa_rica(self):
        # 20:00Z = 2:00 pm en Costa Rica
        m = armar_mensajes([partido(1, "2026-08-26T20:00:00Z")], self.membresias, [])
        assert "14:00" in m["ana"]["body"]

    def test_kickoff_sin_zona_se_asume_utc(self):
        # El sync a veces guarda la fecha sin sufijo.
        m = armar_mensajes([partido(1, "2026-08-26T20:00:00")], self.membresias, [])
        assert "14:00" in m["ana"]["body"]

    def test_nombra_el_primero_y_cuenta_el_resto(self):
        partidos = [partido(3, "2026-08-26T23:00:00Z", local="C", visita="D"),
                    partido(1, "2026-08-26T20:00:00Z", local="A", visita="B")]
        m = armar_mensajes(partidos, self.membresias, [])
        assert "Hoy hay 2 partidos" in m["ana"]["title"]
        assert "A vs B" in m["ana"]["body"]   # el más temprano
        assert "y 1 más" in m["ana"]["body"]

    def test_singular_con_un_solo_partido(self):
        m = armar_mensajes([partido(1, "2026-08-26T20:00:00Z")], self.membresias, [])
        assert "Hoy hay 1 partido ·" in m["ana"]["title"]
