"""La tabla de posiciones que se calcula de nuestros propios partidos.

Lo que se cuida acá: el orden (que es el desempate que la pantalla promete al
pie) y la racha, que es lo único que mira el estado del partido.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.tabla_posiciones import FORMA_PARTIDOS, armar_tabla  # noqa: E402


def _p(local, visita, gl, gv, status="finished", grupo=None):
    return {"group_name": grupo, "home_team": local, "away_team": visita,
            "home_flag_url": None, "away_flag_url": None,
            "home_goals_actual": gl, "away_goals_actual": gv, "status": status}


def _fila(tabla, equipo, grupo=0):
    return next(r for r in tabla[grupo]["rows"] if r["team"] == equipo)


def test_puntos_y_diferencia_de_gol():
    tabla = armar_tabla([_p("Saprissa", "Herediano", 3, 1), _p("Cartaginés", "Saprissa", 0, 0)])
    sap = _fila(tabla, "Saprissa")
    assert (sap["played"], sap["wins"], sap["draws"], sap["losses"]) == (2, 1, 1, 0)
    assert (sap["gf"], sap["ga"], sap["gd"], sap["points"]) == (3, 1, 2, 4)


def test_un_partido_sin_marcador_no_cuenta():
    """Un partido en curso al que el sync todavía no le escribió el marcador
    llega con goles en None. Contarlo como 0-0 inventaría un empate."""
    tabla = armar_tabla([_p("Saprissa", "Herediano", None, None, status="in_progress")])
    assert tabla == []


def test_el_partido_EN_CURSO_sí_suma_puntos():
    """Es la razón de ser de esta tabla: verse en vivo. Si esperáramos al
    pitazo final, no tendría ninguna ventaja sobre la tabla oficial."""
    tabla = armar_tabla([_p("Saprissa", "Herediano", 2, 0, status="in_progress")])
    assert _fila(tabla, "Saprissa")["points"] == 3


# ─── El desempate, que es el que la pantalla explica al pie ─────────────────

def test_a_igual_puntos_manda_la_diferencia_de_gol():
    """El caso real de la jornada 8: Cartaginés y Saprissa con 18 los dos, y
    el orden lo decide el +9 contra el +8."""
    tabla = armar_tabla([
        _p("Cartaginés", "Puntarenas FC", 5, 0),      # +5, 3 pts
        _p("Saprissa", "Pérez Zeledón", 4, 0),        # +4, 3 pts
    ])
    assert [r["team"] for r in tabla[0]["rows"][:2]] == ["Cartaginés", "Saprissa"]


def test_con_la_misma_diferencia_mandan_los_goles_a_favor():
    """LOS NOMBRES ESTÁN ELEGIDOS PARA QUE EL ORDEN ALFABÉTICO DIGA LO
    CONTRARIO. Con «Cartaginés» arriba, esta prueba pasaba igual quitando el
    criterio de goles a favor —el desempate final por nombre lo ponía primero
    de todas formas— y no probaba nada. Comprobado a la contra."""
    tabla = armar_tabla([
        _p("Saprissa", "Herediano", 3, 2),            # +1, 3 goles a favor
        _p("Alajuelense", "Puntarenas FC", 1, 0),     # +1, 1 gol a favor
    ])
    assert [r["team"] for r in tabla[0]["rows"][:2]] == ["Saprissa", "Alajuelense"]


def test_el_orden_es_estable_entre_dos_cargas_iguales():
    """Sin un criterio final, dos equipos idénticos podrían intercambiarse
    entre recargas y la tabla parecería bailar sola."""
    partidos = [_p("Alajuelense", "Herediano", 1, 0), _p("Saprissa", "Cartaginés", 1, 0)]
    assert [r["team"] for r in armar_tabla(partidos)[0]["rows"]] == \
           [r["team"] for r in armar_tabla(list(reversed(partidos)))[0]["rows"]]


def test_las_posiciones_se_numeran_desde_uno():
    tabla = armar_tabla([_p("Saprissa", "Herediano", 1, 0)])
    assert [r["rank"] for r in tabla[0]["rows"]] == [1, 2]


# ─── La racha ───────────────────────────────────────────────────────────────

def test_la_racha_va_del_mas_viejo_al_mas_nuevo():
    """Se lee de izquierda a derecha como una línea de tiempo, así que depende
    de que los partidos lleguen ordenados por fecha."""
    tabla = armar_tabla([
        _p("Saprissa", "A", 1, 0), _p("Saprissa", "B", 0, 0), _p("C", "Saprissa", 2, 0),
    ])
    assert _fila(tabla, "Saprissa")["form"] == ["G", "E", "P"]


def test_la_racha_es_de_CINCO_y_se_queda_con_los_ultimos():
    partidos = [_p("Saprissa", f"Rival {i}", 0, 1) for i in range(5)]
    partidos.append(_p("Saprissa", "Último", 3, 0))
    forma = _fila(armar_tabla(partidos), "Saprissa")["form"]
    assert len(forma) == FORMA_PARTIDOS
    assert forma[-1] == "G", 'el más reciente va al final'
    assert forma[0] == "P"


def test_un_partido_EN_CURSO_no_entra_en_la_racha():
    """Lo contrario que los puntos, y a propósito: un partido en marcha pasa
    de G a E y a P según quién marque. Una racha que parpadea no dice nada."""
    tabla = armar_tabla([
        _p("Saprissa", "Herediano", 1, 0),
        _p("Saprissa", "Cartaginés", 2, 0, status="in_progress"),
    ])
    sap = _fila(tabla, "Saprissa")
    assert sap["form"] == ["G"], 'el partido en curso no suma a la racha'
    assert sap["points"] == 6, 'pero sí a los puntos'


def test_un_equipo_sin_partidos_terminados_no_tiene_racha():
    tabla = armar_tabla([_p("Saprissa", "Herediano", 1, 0, status="in_progress")])
    assert _fila(tabla, "Saprissa")["form"] == []


# ─── Grupos ─────────────────────────────────────────────────────────────────

def test_cada_grupo_lleva_su_propia_tabla():
    tabla = armar_tabla([
        _p("México", "Canadá", 2, 0, grupo="A"),
        _p("Brasil", "Serbia", 1, 0, grupo="B"),
    ])
    assert [g["name"] for g in tabla] == ["A", "B"]
    assert all(len(g["rows"]) == 2 for g in tabla)
    assert tabla[0]["rows"][0]["rank"] == 1 and tabla[1]["rows"][0]["rank"] == 1


def test_una_liga_sin_grupos_da_una_sola_tabla():
    tabla = armar_tabla([_p("Saprissa", "Herediano", 1, 0)])
    assert len(tabla) == 1 and tabla[0]["name"] is None


def test_el_escudo_se_toma_del_primer_partido_que_lo_traiga():
    """Un partido puede venir sin escudo y otro con él; quedarse con el None
    del primero dejaría la fila sin logo para siempre."""
    sin, con = _p("Saprissa", "Herediano", 1, 0), _p("Saprissa", "Cartaginés", 1, 0)
    con["home_flag_url"] = "https://escudo.png"
    assert _fila(armar_tabla([sin, con]), "Saprissa")["logo"] == "https://escudo.png"
