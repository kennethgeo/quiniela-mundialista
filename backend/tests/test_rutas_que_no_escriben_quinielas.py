"""El backend no escribe quinielas ni membresías por fuera de las RPC.

POR QUÉ (vigésima auditoría, 5.5): `/api/leagues` seguía montada aunque
ningún cliente la llamaba. Con service_role, cualquier sesión válida podía
crear una quiniela sin torneo (sin pasar por `create_group`), unirse sin las
reglas de `join_group_by_code` y BORRAR una quiniela con un DELETE directo,
sin la comprobación de pagos de `delete_group` ni el orden de candados de la
91. Los pagos los salvaba solo el trigger de la 92, con un 500 genérico.

Y la migración 109 le quita a service_role el TRUNCATE sobre `league_members`
y `leagues` (TRUNCATE no corre los triggers de fila: vaciaría los pagos sin que
el candado se entere). Eso solo es seguro mientras el backend no vacíe tablas.
"""
import os
import re
import sys

RAIZ = os.path.join(os.path.dirname(__file__), '..')
sys.path.insert(0, RAIZ)


def test_no_hay_rutas_de_ligas_montadas():
    from app.main import app

    rutas = list(app.openapi()['paths'])
    assert rutas, 'la app no expone ninguna ruta: la prueba no estaría mirando nada'
    assert any(r.startswith('/api/admin') for r in rutas)
    assert not [r for r in rutas if r.startswith('/api/leagues')]


def test_el_backend_no_vacia_tablas():
    encontrados = []
    for base, _, archivos in os.walk(os.path.join(RAIZ, 'app')):
        for nombre in archivos:
            if not nombre.endswith('.py'):
                continue
            ruta = os.path.join(base, nombre)
            with open(ruta, encoding='utf-8') as f:
                for n, linea in enumerate(f, 1):
                    if re.search(r'\btruncate\b', linea, re.IGNORECASE):
                        encontrados.append(f'{ruta}:{n}')
    assert not encontrados, encontrados


def test_la_109_le_quita_el_truncate_a_service_role():
    ruta = os.path.join(RAIZ, '..', 'database', '109_bitacora_de_pagos_y_permisos_por_defecto.sql')
    with open(ruta, encoding='utf-8') as f:
        sql = f.read()
    assert re.search(
        r'REVOKE TRUNCATE ON public\.league_members, public\.leagues FROM service_role;', sql)
