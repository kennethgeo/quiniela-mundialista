"""Que el paquete que va al serverless no vuelva a engordar.

POR QUÉ: Vercel avisó al 75% de los 10 GB de Function Storage. Medido, el
paquete pesaba 147 MB con los extras `[standard]` y 93 MB sin ellos — 54 MB por
despliegue, y el storage es acumulado. `uvloop` solo son 14 MB, y en un
serverless no corre nunca: Vercel habla ASGI directo, sin servidor.

Estas pruebas no miden tamaño (dependería de la máquina), miden la CAUSA: que
las dependencias pesadas no estén declaradas ni se importen.
"""
import os
import sys

import pytest

RAIZ = os.path.join(os.path.dirname(__file__), '..')
sys.path.insert(0, RAIZ)

# Lo que arrastran `fastapi[standard]` y `uvicorn[standard]` y la app no usa.
#
# `websockets` NO está en la lista aunque venga con esos extras: lo usa de
# verdad `supabase` para realtime, y sacarlo rompería la app. Lo cazó esta
# misma prueba cuando lo incluí por suponer.
PESADAS = ('uvicorn', 'uvloop', 'httptools', 'watchfiles',
           'rich', 'typer', 'fastapi_cli', 'jinja2', 'email_validator',
           'multipart')


def _requisitos(nombre):
    with open(os.path.join(RAIZ, nombre), encoding='utf-8') as f:
        return [l.strip() for l in f
                if l.strip() and not l.strip().startswith('#')]


def test_produccion_sin_extras_standard():
    """`[standard]` es justo el paquete de cosas que el serverless no usa."""
    for linea in _requisitos('requirements.txt'):
        assert '[standard]' not in linea, (
            f'{linea!r} trae el extra [standard]: son ~54 MB por despliegue '
            f'que el runtime no usa. Si hace falta en local, va en '
            f'requirements-dev.txt')


def test_uvicorn_no_va_a_produccion():
    """En Vercel no corre un servidor: el runtime invoca la app ASGI."""
    nombres = [l.split('>')[0].split('=')[0].split('[')[0].lower()
               for l in _requisitos('requirements.txt')]
    assert 'uvicorn' not in nombres


def test_uvicorn_sigue_disponible_para_local():
    """Quitarlo de producción no puede dejar a nadie sin poder levantar la API."""
    dev = ' '.join(_requisitos('requirements-dev.txt'))
    assert 'uvicorn' in dev
    assert '-r requirements.txt' in dev   # dev incluye producción


def test_la_app_no_importa_ninguna_pesada():
    """La prueba de fondo: aunque alguien las instale, la app no debe usarlas.

    Se mira `sys.modules` DESPUÉS de importar la app, así que si mañana alguien
    agrega `from jinja2 import ...` esto lo caza aunque la dependencia esté
    declarada."""
    # Sin las dependencias instaladas no hay nada que medir. En CI están
    # (el job instala requirements.txt), así que ahí la prueba sí corre.
    pytest.importorskip('fastapi')

    os.environ.setdefault('SUPABASE_URL', 'https://x.supabase.co')
    os.environ.setdefault('SUPABASE_SERVICE_KEY', 'x')
    os.environ.setdefault('SUPABASE_ANON_KEY', 'x')

    antes = set(sys.modules)
    import app.main  # noqa: F401
    nuevas = set(sys.modules) - antes

    coladas = sorted({m.split('.')[0] for m in nuevas} & set(PESADAS))
    assert not coladas, f'la app importa dependencias pesadas: {coladas}'
