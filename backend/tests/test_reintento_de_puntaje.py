"""El puntaje que se perdía y no se reintentaba nunca.

EL FALLO (leído en el código el 22 sep 2026, a raíz de una auditoría externa):
`espn_tournament_sync` solo llamaba al motor de puntos cuando el partido
TRANSICIONABA a `finished` —comparando contra la foto tomada antes del upsert—
y envolvía la llamada en `except Exception: pass`.

La secuencia que dejaba a alguien sin sus puntos, para siempre y en silencio:

  1. El upsert escribe el partido como `finished`.
  2. El motor falla a mitad (el paso 4 de `calculate_and_update_scores` es un
     UPDATE por predicción, no una transacción) y el error se traga.
  3. Pasada siguiente: el partido YA figura `finished` con el mismo marcador →
     `changed = False` → no se vuelve a puntuar. Nunca.

Medido antes de arreglarlo: 62 partidos terminados con predicciones, 0 sin
puntuar. No había mordido todavía. Pero el vigilante de `score_check` caza «el
sync no escribió el resultado» y NADIE cazaba «el resultado está escrito y las
predicciones siguen en cero» — la alarma existía y miraba al lado, otra vez.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.scoring import partidos_sin_puntuar  # noqa: E402


class _Consulta:
    """Doble mínimo del cliente de Supabase: encadena y devuelve `filas`."""

    def __init__(self, filas, registro):
        self._filas, self._registro = filas, registro

    def select(self, *_a, **_k):
        return self

    def in_(self, columna, valores):
        self._registro["in_"] = (columna, list(valores))
        self._filas = [f for f in self._filas if f.get(columna) in valores]
        return self

    def is_(self, columna, valor):
        self._registro["is_"] = (columna, valor)
        assert valor == "null", "solo se consultan las que NO tienen puntos"
        self._filas = [f for f in self._filas if f.get(columna) is None]
        return self

    def execute(self):
        class R:
            pass
        r = R()
        r.data = self._filas
        return r


class FalsoSupabase:
    def __init__(self, predicciones):
        self.predicciones = predicciones
        self.registro = {}
        self.consultas = 0

    def table(self, nombre):
        assert nombre == "predictions"
        self.consultas += 1
        return _Consulta(list(self.predicciones), self.registro)


def test_un_partido_a_medio_puntuar_se_delata():
    """El caso del paso 2: unas predicciones con puntos y otras sin ellos."""
    sb = FalsoSupabase([
        {"match_id": 10, "points_earned": 3},
        {"match_id": 10, "points_earned": None},   # se quedó sin puntuar
        {"match_id": 11, "points_earned": 0},
    ])
    assert partidos_sin_puntuar(sb, [10, 11]) == {10}


def test_un_partido_que_nunca_se_puntuo_tambien():
    sb = FalsoSupabase([
        {"match_id": 20, "points_earned": None},
        {"match_id": 20, "points_earned": None},
    ])
    assert partidos_sin_puntuar(sb, [20, 21]) == {20}


def test_un_partido_bien_puntuado_no_se_reintenta():
    """Importa tanto como lo anterior: si devolviera de más, el sync llamaría
    al motor para todos los partidos terminados en cada pasada del cron."""
    sb = FalsoSupabase([
        {"match_id": 30, "points_earned": 3},
        {"match_id": 30, "points_earned": 0},      # 0 es un puntaje, no un hueco
    ])
    assert partidos_sin_puntuar(sb, [30]) == set()


def test_sin_partidos_no_se_consulta_la_base():
    """La ruta cara. El cron corre cada minuto: una pasada sin partidos
    terminados no puede costar una consulta."""
    sb = FalsoSupabase([{"match_id": 40, "points_earned": None}])
    assert partidos_sin_puntuar(sb, []) == set()
    assert partidos_sin_puntuar(sb, None) == set()
    assert sb.consultas == 0


def test_se_pregunta_solo_por_los_partidos_dados():
    """Se acota a la tanda: preguntar por todo traería las predicciones de los
    partidos por jugar, que están sin puntuar A PROPÓSITO."""
    sb = FalsoSupabase([{"match_id": 50, "points_earned": None},
                        {"match_id": 99, "points_earned": None}])
    assert partidos_sin_puntuar(sb, [50]) == {50}
    assert sb.registro["in_"] == ("match_id", [50])
    assert sb.registro["is_"] == ("points_earned", "null")


def test_el_sync_reintenta_los_pendientes_y_no_se_traga_el_error():
    """Lee el sync y exige las dos mitades del arreglo: que un partido ya
    `finished` y sin cambios se vuelva a puntuar si quedó pendiente, y que el
    `except` deje rastro en vez de un `pass`."""
    fuente = (Path(__file__).resolve().parents[1]
              / "app" / "services" / "espn_tournament_sync.py").read_text()
    assert "partidos_sin_puntuar" in fuente, "el sync no consulta los pendientes"
    assert "or mid in pendientes" in fuente, "los pendientes no entran en `changed`"
    assert "scoring_errors" in fuente, "los fallos de puntaje no se reportan"
    cuerpo = fuente[fuente.index("    scored = 0"):fuente.index("# Recalcular medallas")]
    assert "except Exception:  # noqa: BLE001\n                pass" not in cuerpo, \
        "el fallo de puntaje se vuelve a tragar en silencio"
