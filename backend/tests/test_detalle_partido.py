"""El recorte del detalle de ESPN.

Los fixtures son respuestas REALES de ESPN (Champions, 8 sep 2026),
adelgazadas a lo que el recorte mira. Uno de un partido EN CURSO —con
alineaciones y estadísticas— y otro POR JUGAR, que es el caso interesante:
ESPN devuelve el plantel completo con `starter: false` hasta que publica el
once, así que un recorte ingenuo mostraría 20 «titulares» inventados.
"""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import pytest  # noqa: E402

from app.services.espn_match_detail import (  # noqa: E402
    PARAMS_ESPN, recortar, ttl_para, TTL_EN_CURSO, TTL_POR_JUGAR, TTL_TERMINADO,
)

DATOS = os.path.join(os.path.dirname(__file__), 'datos')


def cargar(nombre):
    with open(os.path.join(DATOS, f'espn_summary_{nombre}.json'), encoding='utf-8') as f:
        return json.load(f)


@pytest.fixture(scope='module')
def en_curso():
    return recortar(cargar('en_vivo'))


@pytest.fixture(scope='module')
def por_jugar():
    return recortar(cargar('por_jugar'))


@pytest.fixture(scope='module')
def once_publicado():
    """Barcelona–Feyenoord a 28 minutos del saque, pedido SIN `lang=es`."""
    return recortar(cargar('once_publicado'))


def test_alineaciones_con_once_completo(en_curso):
    al = en_curso['alineaciones']
    assert al and len(al) == 2
    for eq in al:
        assert len(eq['titulares']) == 11, eq['equipo']
        assert eq['formacion']            # 4-4-2, 3-1-4-2…
        assert eq['suplentes']
        assert all(j['nombre'] for j in eq['titulares'])


def test_hay_un_local_y_un_visitante(en_curso):
    assert sorted(eq['esLocal'] for eq in en_curso['alineaciones']) == [False, True]


def test_SIN_once_publicado_no_se_inventa_una_alineacion(por_jugar):
    """ESPN manda el plantel entero con starter=false antes de publicar el
    equipo. Si se tomara eso por una alineación, la pantalla mostraría un once
    que nadie anunció — y en una quiniela por plata alguien predeciría con él."""
    assert por_jugar['alineaciones'] is None


def test_estadisticas_solo_las_elegidas_y_con_nombre_propio(en_curso):
    es = en_curso['estadisticas']
    assert es and len(es) == 2
    etiquetas = [v['etiqueta'] for v in es[0]['valores']]
    assert 'Posesión' in etiquetas
    # ESPN mezcla idiomas en la misma respuesta ("Fouls" junto a "POSESIÓN"),
    # así que el nombre lo ponemos nosotros.
    assert 'Faltas' in etiquetas
    assert not any(e.lower() == 'fouls' for e in etiquetas)


def test_no_se_expone_nada_de_apuestas(en_curso, por_jugar):
    """Decisión del dueño: fuera las cuotas. Se comprueba sobre el JSON entero
    para que no vuelvan por una sección nueva."""
    for d in (en_curso, por_jugar):
        crudo = json.dumps(d, ensure_ascii=False).lower()
        for palabra in ('odds', 'moneyline', 'cuota', 'pickcenter', 'spread'):
            assert palabra not in crudo, palabra


def test_no_se_exponen_noticias(en_curso):
    """Las «noticias» de ESPN son de la LIGA, no del partido: en el resumen del
    Real Madrid venían previas de Porto–City. Mostrarlas como noticias del
    partido sería mentir, así que el recorte no las trae."""
    assert 'noticias' not in en_curso and 'news' not in en_curso


def test_forma_reciente_de_los_dos_equipos(por_jugar):
    fo = por_jugar['forma']
    assert fo and len(fo) == 2
    for eq in fo:
        assert 1 <= len(eq['partidos']) <= 5
        for p in eq['partidos']:
            assert p['resultado'] in ('G', 'P', 'E', None)


def test_la_forma_esta_disponible_antes_del_partido(por_jugar):
    """Es lo que hace útil el panel cuando todavía no hay alineación."""
    assert por_jugar['alineaciones'] is None
    assert por_jugar['forma']


def test_estadio(en_curso):
    assert en_curso['estadio']


def test_ttl_por_estado():
    assert ttl_para('in_progress') == TTL_EN_CURSO
    assert ttl_para('pending') == TTL_POR_JUGAR
    for s in ('finished', 'cancelled', 'postponed'):
        assert ttl_para(s) == TTL_TERMINADO
    # Un partido en curso tiene que refrescarse mucho más seguido que uno por
    # jugar: si no, el marcador y las stats se ven congelados.
    assert TTL_EN_CURSO < TTL_POR_JUGAR < TTL_TERMINADO


def test_un_resumen_vacio_no_revienta():
    """ESPN a veces devuelve secciones ausentes. El panel tiene que quedar sin
    datos, no romper la pantalla."""
    d = recortar({})
    assert d['alineaciones'] is None and d['estadisticas'] is None
    assert d['forma'] is None and d['historial'] is None
    assert d['actualizado']


def test_la_cache_es_una_mejora_no_una_dependencia():
    """Si la tabla de caché no existe —la migración todavía no se corrió— o la
    consulta falla, el endpoint tiene que seguir y preguntarle a ESPN.

    Esto pasó en producción: se mergeó el código antes de aplicar la migración,
    la lectura de la caché reventó sin `try` y el endpoint devolvió 500. La
    escritura sí estaba protegida; la lectura no.

    Se lee el ARCHIVO en vez de importar el módulo: `app.routes.matches` arrastra
    fastapi y el resto de las dependencias, que no hacen falta para comprobar
    esto y harían que la prueba solo corriera donde estén instaladas.
    """
    ruta = os.path.join(os.path.dirname(__file__), '..', 'app', 'routes', 'matches.py')
    with open(ruta, encoding='utf-8') as f:
        fuente = f.read()

    cuerpo = fuente[fuente.index('async def detalle_del_partido'):]
    lectura = cuerpo.index('.select("payload, fetched_at")')

    # El `try` que la cubre tiene que estar ANTES de la lectura, no solo en la
    # escritura de más abajo.
    assert 'try:' in cuerpo[:lectura], 'la lectura de la cache quedo sin try'
    assert 'No se pudo leer la cache' in cuerpo


def test_historial_con_marcador(en_curso, por_jugar):
    """La primera versión leía `summary`/`shortName` del evento, que NO existen
    en `seasonseries`: la pantalla mostraba la fecha y nada más. El marcador
    está en `competitors`."""
    h = por_jugar['historial'] or en_curso['historial']
    if not h:
        pytest.skip('ninguno de los dos fixtures trae enfrentamientos previos')
    for p in h['partidos']:
        assert len(p['equipos']) == 2
        for e in p['equipos']:
            assert e['equipo']
            assert e['goles'] is not None


def test_cerca_del_saque_la_respuesta_dura_menos():
    """A 15 minutos del pitazo la alineación es justo lo que está por salir:
    guardar la respuesta un cuarto de hora la deja vieja todo ese rato."""
    from app.services.espn_match_detail import TTL_CERCA_DEL_SAQUE
    assert ttl_para('pending', 20) == TTL_CERCA_DEL_SAQUE
    assert ttl_para('pending', 90) == TTL_CERCA_DEL_SAQUE
    # Lejos del partido no hace falta insistir.
    assert ttl_para('pending', 600) == TTL_POR_JUGAR
    assert ttl_para('pending', None) == TTL_POR_JUGAR
    # Ya empezado manda el estado, no el reloj.
    assert ttl_para('in_progress', 5) == TTL_EN_CURSO
    assert TTL_CERCA_DEL_SAQUE < TTL_POR_JUGAR


def test_no_se_pide_la_edicion_en_espanol():
    """El parámetro que dejó el panel sin alineaciones desde el primer día.

    Medido el 9 sep 2026 sobre Barcelona–Feyenoord y Stuttgart–Viking, a 28
    minutos del saque y con el once ya publicado: la misma petición devuelve 11
    titulares y formación sin `lang`, y 0 titulares con `lang=es&region=es`.
    `_alineaciones` descartaba los dos equipos y el panel decía «todavía no se
    publicaron» para siempre.

    Esto no demuestra nada sobre ESPN —no hay red acá—: es un candado para que
    el parámetro no vuelva a entrar sin que nadie lo note.
    """
    assert 'lang' not in PARAMS_ESPN
    assert 'region' not in PARAMS_ESPN


def test_la_alineacion_publicada_SI_llega_a_la_pantalla(once_publicado):
    """El caso que el panel nunca pudo mostrar: partido por jugar, once ya
    anunciado. Es la ventana de ~30 minutos que hace útil todo el panel."""
    al = once_publicado['alineaciones']
    assert al and len(al) == 2
    for eq in al:
        assert len(eq['titulares']) == 11, eq['equipo']
        assert eq['formacion'], eq['equipo']
        assert all(j['nombre'] for j in eq['titulares'])
    assert sorted(eq['esLocal'] for eq in al) == [False, True]


def test_el_resultado_de_la_forma_se_traduce(once_publicado):
    """Sin `lang=es` ESPN manda W/L/D. La pantalla solo entiende G/P/E y pinta
    un punto gris para lo demás, así que las cinco casillas de «Cómo vienen» se
    habrían quedado en gris — un arreglo que rompía otra cosa."""
    fo = once_publicado['forma']
    assert fo
    vistos = {p['resultado'] for eq in fo for p in eq['partidos']}
    assert vistos <= {'G', 'P', 'E'}
    assert vistos, 'el fixture no trae ningún resultado'


def test_se_traducen_las_dos_formas_de_escribirlo():
    """La respuesta en español ya usaba G/P/E: la traducción no puede romperla,
    porque una copia vieja en la caché todavía viene así."""
    ingles = {'lastFiveGames': [{'team': {'displayName': 'X'}, 'events': [
        {'gameDate': '2026-09-01', 'gameResult': r, 'score': '1-0'} for r in ('W', 'L', 'D')]}]}
    espanol = {'lastFiveGames': [{'team': {'displayName': 'X'}, 'events': [
        {'gameDate': '2026-09-01', 'gameResult': r, 'score': '1-0'} for r in ('G', 'P', 'E')]}]}
    esperado = ['G', 'P', 'E']
    for crudo in (ingles, espanol):
        assert [p['resultado'] for p in recortar(crudo)['forma'][0]['partidos']] == esperado

    # Algo que no se reconoce queda en None, no se inventa un resultado.
    raro = {'lastFiveGames': [{'team': {'displayName': 'X'}, 'events': [
        {'gameDate': '2026-09-01', 'gameResult': 'ZZ', 'score': '1-0'}]}]}
    assert recortar(raro)['forma'][0]['partidos'][0]['resultado'] is None


# ─── La liga tica: la fuente NO tiene alineaciones ──────────────────────────
# Medido el 13 sep 2026 contra la API, no supuesto:
#   · Belén–Herediano (jornada 8, YA TERMINADO) -> `rosters` con 0 jugadores.
#   · Inter de San Carlos–Puntarenas (misma fecha) -> 16 y 12 nombres SIN
#     dorsal, SIN formación y todos con posición "SUB". Es la lista de quienes
#     aparecieron en algún evento, no un once anunciado. Ese es este fixture.
#   · La misma petición en esp.1, eng.1 y uefa.champions -> 11 titulares por
#     equipo y formación ("4-3-3").
# O sea: no es que tarde, es que no está.

@pytest.fixture(scope='module')
def liga_tica():
    return recortar(cargar('liga_tica'), 'crc.1')


def test_la_liga_tica_no_dibuja_una_alineacion_inventada(liga_tica):
    """10 y 8 jugadores marcados «titular» NO son un once.

    Con el corte viejo (`if not titulares`) esto pasaba el filtro y se
    dibujaba en la cancha como si el equipo lo hubiera anunciado, sin dorsales
    y con todos de "SUB". Enseñar una alineación inventada es peor que no
    enseñar ninguna: alguien predice con eso.
    """
    assert liga_tica['alineaciones'] is None


def test_se_dice_CUANDO_publica_la_fuente_de_ese_torneo(liga_tica):
    """La pantalla tiene que poder distinguir «en una hora» de «al pitazo».

    La liga tica se sirve ahora de la API de la UNAFUT, que sí tiene el once
    pero lo publica AL ARRANCAR el partido (medido: vacío a 25 minutos del
    saque, los 22 titulares a un minuto de empezado). Decir «en cuanto salgan
    aparecen acá» ahí deja a alguien recargando hasta el saque por algo que no
    va a llegar a tiempo: las predicciones cierran 15 minutos antes.
    """
    assert liga_tica['alineaciones_cuando'] == 'al-saque'


def test_una_liga_normal_no_recibe_ninguna_afirmacion():
    """Champions publica ~1 h antes, que es lo que dice el texto de siempre.

    No lleva entrada propia: el mapa solo marca las ligas que se salen de esa
    norma, así que una liga desconocida tampoco recibe una afirmación
    inventada."""
    assert recortar(cargar('once_publicado'), 'uefa.champions')['alineaciones_cuando'] is None


def test_sin_saber_la_liga_tampoco_se_afirma_nada(once_publicado):
    assert once_publicado['alineaciones_cuando'] is None


def test_un_once_de_verdad_sigue_llegando_entero(once_publicado):
    """El corte de 11 no puede llevarse por delante el caso bueno."""
    for equipo in once_publicado['alineaciones']:
        assert len(equipo['titulares']) == 11


# ─────────────────────────────────────────────────────────────────────────────
# EL MARCADOR DE «CÓMO VIENEN» SALÍA AL REVÉS EN LAS DERROTAS (20 sep 2026)
#
# `score` de ESPN es del GANADOR, no del equipo. Medido sobre AD San Carlos–
# Cartaginés (crc.1): San Carlos PERDIÓ 1-2 con Puntarenas y ese evento trae
# `score: "2-1"`. La pantalla lo pintaba crudo al lado de una P, y cualquiera
# lo lee como que San Carlos hizo 2. Justo en las filas que más se miran.
#
# `espn_summary_forma_invertida.json` es esa respuesta real adelgazada, y
# conserva a propósito las dos cosas que hacen falta para probarlo: la derrota
# con el `score` dado vuelta, y el resumen del historial en inglés.
# ─────────────────────────────────────────────────────────────────────────────
@pytest.fixture
def forma_invertida():
    return recortar(cargar('forma_invertida'), 'crc.1')


def _por_rival(equipo, rival):
    return next(p for p in equipo['partidos'] if p['rival'] == rival)


class TestElMarcadorVaOrientadoAlEquipo:

    def test_en_una_derrota_los_goles_propios_van_primero(self, forma_invertida):
        """EL CASO DEL FALLO. San Carlos perdió 1-2 y ESPN manda «2-1»."""
        p = _por_rival(forma_invertida['forma'][0], 'PUN')
        assert p['resultado'] == 'P'
        assert (p['goles'], p['goles_rival']) == (1, 2)

    def test_el_marcador_nunca_contradice_al_resultado(self, forma_invertida):
        """La comprobación que cierra la familia entera: con `score` crudo,
        las tres derrotas y empates de este fixture caen."""
        for equipo in forma_invertida['forma']:
            for p in equipo['partidos']:
                gp, gr = p['goles'], p['goles_rival']
                assert gp is not None and gr is not None, p
                if p['resultado'] == 'G':
                    assert gp > gr, p
                elif p['resultado'] == 'P':
                    assert gp < gr, p
                elif p['resultado'] == 'E':
                    assert gp == gr, p

    def test_se_dice_si_fue_de_local_o_de_visita(self, forma_invertida):
        """Sale de `atVs`, que es el ÚNICO campo que lo dice: `homeAway` viene
        en None en todos los eventos de `lastFiveGames`."""
        sc = forma_invertida['forma'][0]
        assert _por_rival(sc, 'PUN')['de_local'] is True
        assert _por_rival(sc, 'ALA')['de_local'] is False

    def test_sin_saber_de_que_lado_jugo_no_se_inventa_el_marcador(self):
        """Sin `atVs` no hay forma de orientar los goles. Se devuelve el
        resultado —que sí es cierto— y los goles en None, para que la pantalla
        dibuje la letra sin números en vez de un marcador inventado."""
        crudo = {'lastFiveGames': [{'team': {'displayName': 'X'}, 'events': [
            {'gameResult': 'L', 'score': '2-1', 'homeTeamScore': '1',
             'awayTeamScore': '2', 'atVs': None,
             'opponent': {'abbreviation': 'PUN'}}]}]}
        p = recortar(crudo)['forma'][0]['partidos'][0]
        assert p['resultado'] == 'P'
        assert (p['goles'], p['goles_rival']) == (None, None)

    def test_tampoco_se_inventa_si_faltan_los_goles(self):
        crudo = {'lastFiveGames': [{'team': {'displayName': 'X'}, 'events': [
            {'gameResult': 'W', 'atVs': 'vs', 'homeTeamScore': None,
             'awayTeamScore': '0', 'opponent': {'abbreviation': 'HER'}}]}]}
        p = recortar(crudo)['forma'][0]['partidos'][0]
        assert (p['goles'], p['goles_rival']) == (None, None)


class TestElBalanceDelHistorialNoSaleEnIngles:
    """ESPN manda «CAR leads series 4-0-1» y eso llegaba crudo a la pantalla.

    Viene en inglés desde que se quitó `lang=es`; `_forma` ya traducía
    `gameResult` por lo mismo y a este campo nadie lo miró."""

    def test_no_se_reenvia_el_texto_de_espn(self, forma_invertida):
        assert 'resumen' not in forma_invertida['historial']
        assert 'leads series' not in json.dumps(forma_invertida, ensure_ascii=False)

    def test_se_cuenta_sobre_los_partidos_que_se_muestran(self, forma_invertida):
        """Contar lo que se dibuja es lo único que no puede contradecir a la
        lista de abajo: el «4-0-1» de ESPN abarca lo que ESPN quiera."""
        b = forma_invertida['historial']['balance']
        assert b['de'] == len(forma_invertida['historial']['partidos'])
        assert sum(e['ganados'] for e in b['equipos']) + b['empates'] == b['de']

    def test_los_numeros_son_los_reales(self, forma_invertida):
        b = forma_invertida['historial']['balance']
        assert b['empates'] == 1
        assert {e['equipo']: e['ganados'] for e in b['equipos']} == {
            'Cartaginés': 4, 'AD San Carlos': 0}

    def test_el_que_no_gano_ninguno_sale_igual(self, forma_invertida):
        """«CAR 4 · ADSC 0» dice más que «CAR 4» y no obliga a restar."""
        assert len(forma_invertida['historial']['balance']['equipos']) == 2
