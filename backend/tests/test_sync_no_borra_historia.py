"""El botón «Sync partidos» no puede borrar la historia de una quiniela (B11).

La limpieza de temporadas viejas borraba TODO lo anterior a `season_start`, y
además las predicciones a mano. La liga tica corre temporada tras temporada
sobre el MISMO `tournament_id`, y `predictions` cae en CASCADA al borrar un
partido: el día que ESPN cambie de temporada (medido el 22 sep 2026: la actual
va de julio 2026 a julio 2027), pulsar el botón se llevaba la temporada entera
con sus predicciones. Ahora solo se borra lo que nadie predijo.

EL DOBLE IMITA EL TOPE DE 1.000 FILAS DE POSTGREST, y no es un detalle: una
temporada de la liga tica son ~90 partidos × 17 personas ≈ 1.500 predicciones.
Un doble que devolviera todas las filas sería MÁS PERMISIVO que el servidor
real y dejaría pasar justo el arreglo ingenuo que borra de más (regla anotada
en CLAUDE.md para el login con Google).
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.espn_tournament_sync import (  # noqa: E402
    congelados_terminados,
    partidos_sin_predicciones,
)

TOPE_POSTGREST = 1000


class _R:
    def __init__(self, data, count=None):
        self.data, self.count = data, count


class _Q:
    def __init__(self, filas):
        self.filas, self.contar, self.tope = filas, False, TOPE_POSTGREST

    def select(self, *_a, count=None, **_k):
        self.contar = count == "exact"
        return self

    def eq(self, col, val):
        self.filas = [f for f in self.filas if f.get(col) == val]
        return self

    def in_(self, col, vals):
        vals = set(vals)
        self.filas = [f for f in self.filas if f.get(col) in vals]
        return self

    def limit(self, n):
        self.tope = min(self.tope, n)
        return self

    def execute(self):
        # Como PostgREST: el conteo exacto es de TODO; los datos, cortados.
        return _R(self.filas[: self.tope], len(self.filas) if self.contar else None)


class FalsaBase:
    def __init__(self, predicciones):
        self.predicciones = predicciones

    def table(self, nombre):
        assert nombre == "predictions"
        return _Q(list(self.predicciones))


def _temporada(partidos, personas, sin_predicciones=()):
    """Predicciones de una temporada entera, salvo los partidos indicados."""
    return [{"id": f"{m}-{u}", "match_id": m, "user_id": u}
            for m in partidos if m not in sin_predicciones
            for u in range(personas)]


def test_un_partido_con_predicciones_nunca_es_borrable():
    db = FalsaBase(_temporada([1, 2, 3], 17, sin_predicciones={2}))
    assert partidos_sin_predicciones(db, [1, 2, 3]) == [2]


def test_una_temporada_real_no_cae_en_el_tope_de_1000_filas():
    """EL CASO QUE SE ROMPERÍA con una sola consulta: 90 partidos × 17 = 1.530
    predicciones. Pedidas de una vez, las últimas 530 no llegan y los partidos
    del final parecen vacíos. Acá solo el 91 está vacío de verdad."""
    partidos = list(range(1, 92))
    db = FalsaBase(_temporada(partidos, 17, sin_predicciones={91}))
    assert len(db.predicciones) > TOPE_POSTGREST
    assert partidos_sin_predicciones(db, partidos) == [91]


def test_sin_partidos_viejos_no_se_borra_nada():
    assert partidos_sin_predicciones(FalsaBase([]), []) == []
    assert partidos_sin_predicciones(FalsaBase([]), None) == []


def test_los_congelados_terminados_entran_al_reintento():
    snap = {
        "a": {"id": 1, "status": "finished", "score_locked": True},   # el caso
        "b": {"id": 2, "status": "pending", "score_locked": True},    # sin jugar
        "c": {"id": 3, "status": "finished", "score_locked": False},  # ya lo cubre el bucle
    }
    assert congelados_terminados(snap, {"a", "b"}) == [1]


def test_el_sync_ya_no_borra_predicciones_ni_salta_a_los_congelados():
    fuente = (Path(__file__).resolve().parents[1]
              / "app" / "services" / "espn_tournament_sync.py").read_text()
    limpieza = fuente[fuente.index("# Limpieza: si acotamos"):]
    assert 'table("predictions").delete()' not in limpieza, \
        "la limpieza vuelve a borrar predicciones a mano"
    assert "partidos_sin_predicciones(" in limpieza, \
        "la limpieza ya no comprueba qué partidos tienen predicciones"
    assert "partidos_sin_puntuar(supabase, finalizados + congelados)" in fuente, \
        "los congelados no entran al detector de puntaje pendiente"
    assert "set(congelados) & pendientes" in fuente, \
        "los congelados pendientes no se vuelven a puntuar"
