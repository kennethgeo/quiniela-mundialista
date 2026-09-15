"""El adaptador de la API de la UNAFUT (alineaciones de la liga tica).

Los fixtures son respuestas REALES, adelgazadas: la jornada 8 y el partido
Pérez Zeledón–A.D. San Carlos ya terminado, con los dos onces y sus cambios.
"""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import pytest  # noqa: E402

from app.services.unafut_lineups import (  # noqa: E402
    EQUIPOS, armar, buscar_partido, id_de_equipo,
)

DATOS = os.path.join(os.path.dirname(__file__), 'datos')


def cargar(nombre):
    with open(os.path.join(DATOS, f'unafut_{nombre}.json'), encoding='utf-8') as f:
        return json.load(f)


@pytest.fixture(scope='module')
def jornada():
    return cargar('jornada')


@pytest.fixture(scope='module')
def partido():
    return cargar('partido')


@pytest.fixture(scope='module')
def alineacion(partido):
    return armar(partido, id_de_equipo('Pérez Zeledón'), 'Pérez Zeledón', 'AD San Carlos')


# ─── Emparejar equipos ──────────────────────────────────────────────────────

def test_los_dos_san_carlos_son_equipos_DISTINTOS():
    """El fallo que este mapa existe para impedir.

    «Inter de San Carlos» y «A.D. San Carlos» comparten las dos palabras que
    los distinguen del resto de la liga, así que cualquier emparejamiento por
    texto puede cruzarlos — y cruzarlos significa enseñar la alineación del
    otro equipo, que es peor que no enseñar ninguna.
    """
    assert id_de_equipo('Inter de San Carlos') != id_de_equipo('AD San Carlos')
    assert id_de_equipo('Inter de San Carlos') == 15374
    assert id_de_equipo('AD San Carlos') == 14124


def test_el_nombre_se_normaliza_sin_tildes_ni_puntos():
    assert id_de_equipo('Pérez Zeledón') == id_de_equipo('perez zeledon')
    assert id_de_equipo('Cartaginés') == 14057


def test_un_equipo_desconocido_no_adivina():
    """Sin id no hay alineación. El modo de fallo correcto es quedarse sin la
    tarjeta, nunca enseñar la de otro."""
    assert id_de_equipo('Real Madrid') is None
    assert id_de_equipo('') is None


def test_el_mapa_cubre_los_diez_clubes():
    assert len(EQUIPOS) == 10
    assert len(set(EQUIPOS.values())) == 10


# ─── Encontrar el partido dentro de la jornada ──────────────────────────────

def test_encuentra_el_partido_por_el_PAR_de_equipos(jornada):
    m = buscar_partido(jornada, id_de_equipo('Sporting San José'), id_de_equipo('Saprissa'))
    assert m['matchId'] == 396157


def test_da_igual_quien_sea_local(jornada):
    """Se compara un conjunto de ids, así que el orden no importa: nuestra BD
    y la de ellos podrían no coincidir en quién figura primero."""
    a = buscar_partido(jornada, id_de_equipo('Saprissa'), id_de_equipo('Sporting San José'))
    b = buscar_partido(jornada, id_de_equipo('Sporting San José'), id_de_equipo('Saprissa'))
    assert a['matchId'] == b['matchId'] == 396157


def test_exige_el_par_COMPLETO(jornada):
    """Sporting juega en esta jornada, pero no contra Herediano. Conformarse
    con un equipo devolvería el partido equivocado."""
    assert buscar_partido(jornada, id_de_equipo('Sporting San José'), id_de_equipo('Herediano')) is None


def test_un_cruce_que_no_se_juega_esa_jornada_no_devuelve_nada(jornada):
    assert buscar_partido(jornada, id_de_equipo('Cartaginés'), id_de_equipo('Herediano')) is None
    assert buscar_partido([], 1, 2) is None


# ─── Armar la alineación ────────────────────────────────────────────────────

def test_once_completo_por_equipo(alineacion):
    assert len(alineacion) == 2
    for equipo in alineacion:
        assert len(equipo['titulares']) == 11


def test_el_local_va_primero_y_esta_marcado(alineacion):
    assert alineacion[0]['esLocal'] is True
    assert alineacion[1]['esLocal'] is False


def test_usa_NUESTROS_nombres_de_equipo(alineacion):
    """El encabezado de la pantalla dice «Pérez Zeledón»; si la pestaña dijera
    «Municipal Pérez Zeledón» sería el mismo equipo con dos nombres en la misma
    pantalla, y eso se lee como un fallo."""
    assert [e['equipo'] for e in alineacion] == ['Pérez Zeledón', 'AD San Carlos']


def test_no_se_declara_una_formacion_que_la_fuente_no_da(alineacion):
    """La UNAFUT no manda formación. Deducir «4-4-2» del recuento y enseñarlo
    como la formación del técnico sería inventarla."""
    for equipo in alineacion:
        assert equipo['formacion'] is None


def test_las_lineas_salen_de_las_posiciones_de_la_fuente(alineacion):
    """Esto NO es la formación: es agrupar lo que la fuente dice de cada
    jugador, para que la cancha no caiga al 4-4-2 de respaldo y dibuje cuatro
    defensas donde hay cinco."""
    assert alineacion[0]['lineas'] == [1, 4, 5, 1]
    assert alineacion[1]['lineas'] == [1, 5, 3, 2]
    for equipo in alineacion:
        assert sum(equipo['lineas']) == len(equipo['titulares'])


def test_los_nombres_no_vienen_gritados(alineacion):
    """La fuente mezcla cajas: el mismo partido trae «Sebastian Hernandez
    Ibarra» y «BRYAN ANDRES SEGURA CRUZ»."""
    nombres = [j['nombre'] for e in alineacion for j in e['titulares']]
    assert nombres, 'sin nombres no se prueba nada'
    for n in nombres:
        assert n != n.upper(), f'nombre en mayúsculas: {n}'


def test_la_ficha_lleva_el_PRIMER_apellido(alineacion):
    """En Costa Rica los dos apellidos van juntos: quedarse con el último
    dejaría «Cruz» en la ficha de alguien a quien todos llaman «Segura»."""
    porteros = [j for j in alineacion[0]['titulares'] if j['posicion'] == 'POR']
    assert porteros[0]['corto'] == 'Segura'
    assert porteros[0]['nombre'] == 'Bryan Andres Segura Cruz'


def test_dorsal_y_posicion_traducida(alineacion):
    primero = alineacion[0]['titulares'][0]
    assert primero['dorsal'] == '1'
    assert primero['posicion'] == 'POR'
    assert {j['posicion'] for e in alineacion for j in e['titulares']} <= {'POR', 'DEF', 'MED', 'DEL'}


def test_los_cambios_se_marcan(alineacion):
    """Se sacan de `actions`, no de un campo del jugador: la fuente no marca
    en el plantel quién entró."""
    entraron = [j['nombre'] for e in alineacion for j in e['suplentes'] if j['entro']]
    assert len(entraron) == 10, 'cinco cambios por equipo en este partido'


# ─── Modos de fallo ─────────────────────────────────────────────────────────

def test_sin_once_publicado_no_devuelve_nada(partido):
    """Antes del partido la fuente manda los equipos con la lista vacía. Media
    tarjeta es peor que ninguna: se lee como que el equipo no se presentó."""
    vacio = json.loads(json.dumps(partido))
    for c in vacio['competitors']:
        c['players'] = []
    assert armar(vacio, 14103, 'Pérez Zeledón', 'AD San Carlos') is None


def test_con_UN_SOLO_equipo_publicado_tampoco(partido):
    a_medias = json.loads(json.dumps(partido))
    a_medias['competitors'][1]['players'] = []
    assert armar(a_medias, 14103, 'Pérez Zeledón', 'AD San Carlos') is None


def test_menos_de_once_no_es_una_alineacion(partido):
    """El fallo que ya nos pasó con ESPN: 10 y 8 jugadores marcados «titular»
    —los que aparecieron en algún evento— dibujados como si fueran el once que
    anunció el equipo."""
    recortado = json.loads(json.dumps(partido))
    for c in recortado['competitors']:
        titulares = [p for p in c['players'] if p.get('isStarter')]
        titulares[0]['isStarter'] = 0
    assert armar(recortado, 14103, 'Pérez Zeledón', 'AD San Carlos') is None


def test_sin_arquero_identificado_no_se_reparte_la_cancha(partido):
    """La primera línea ES el arco. Sin saber quién lo ocupa, un defensa
    dibujado de portero es un error que se ve; mejor el reparto de respaldo."""
    sin_arquero = json.loads(json.dumps(partido))
    for c in sin_arquero['competitors']:
        for p in c['players']:
            if p.get('playingPosition') == 'GOALKEEPER':
                p['playingPosition'] = ''
    al = armar(sin_arquero, 14103, 'Pérez Zeledón', 'AD San Carlos')
    for equipo in al:
        assert equipo['lineas'] is None


def test_una_posicion_suelta_que_falta_no_tira_el_reparto(partido):
    """Medido con el partido EN VIVO: algunos vienen con la posición vacía.
    Con uno o dos huecos el resto del reparto sigue valiendo, así que van a la
    última línea en vez de perder también las posiciones que sí se saben."""
    incompleto = json.loads(json.dumps(partido))
    faltan = [p for p in incompleto['competitors'][0]['players']
              if p.get('isStarter') and p.get('playingPosition') == 'FORWARD'][:1]
    for p in faltan:
        p['playingPosition'] = ''
    al = armar(incompleto, 14103, 'Pérez Zeledón', 'AD San Carlos')
    assert sum(al[0]['lineas']) == 11


def test_con_casi_ninguna_posicion_NO_se_dibuja_una_fila_de_diez(partido):
    """El caso real de Escorpiones–Herediano: la fuente daba la posición del
    arquero y de nadie más. El reparto salía [1, 10] — que no es una cancha,
    es una pantalla que parece rota. Mejor el 4-4-2 de respaldo, que es lo que
    la cancha ya hace con cualquier equipo sin formación."""
    casi_vacio = json.loads(json.dumps(partido))
    for p in casi_vacio['competitors'][0]['players']:
        if p.get('playingPosition') != 'GOALKEEPER':
            p['playingPosition'] = ''
    al = armar(casi_vacio, 14103, 'Pérez Zeledón', 'AD San Carlos')
    assert al[0]['lineas'] is None
    assert len(al[0]['titulares']) == 11, 'la alineación se muestra igual: lo que se pierde es el reparto'
