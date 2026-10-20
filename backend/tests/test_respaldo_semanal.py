"""El respaldo semanal en MD no se calla tablas ni columnas nuevas.

`consultas.sql` nombraba columnas a mano y se quedó atrás: a `matches` le
faltaban `destapado_at` y `jornada_oficial`, a `tournaments` tres columnas, y
`live_sync_state` no estaba ni contada (medido contra el catálogo de
producción el 20 oct 2026). Ahora la consulta 2 recorre las tablas de
`public` con todas sus columnas menos las excluidas, y `generar.py` se niega
a escribir el MD si una tabla no viene ni está excluida a propósito.

La consulta se probó contra un PostgreSQL 16 local (nombres con < & > ñ y
emoji intactos, correo fuera, tabla vacía como []) y su mecanismo contra
producción con una variante que solo devuelve conteos y nombres de columna.
Acá se fija lo que CI puede comprobar sin base: el generador y la forma de la
consulta.
"""
import importlib.util
import json
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parents[2]
SQL = (RAIZ / "scripts/respaldo/consultas.sql").read_text(encoding="utf-8")


def _generar():
    spec = importlib.util.spec_from_file_location("generar_respaldo", RAIZ / "scripts/respaldo/generar.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _consulta_2(**extra):
    datos = {
        "users": [{"id": "u1", "display_name": "Ana <&> ñ"}],
        "leagues": [{"id": "L", "name": "Bundestica", "tournament_id": 5, "admin_id": "u1",
                     "invitation_code": "abc123", "cuota": 10000, "moneda": "CRC"}],
        "league_members": [{"league_id": "L", "user_id": "u1", "es_admin": False,
                            "pago_confirmado_at": "2026-09-01T00:00:00Z", "pago_confirmado_monto": 10000}],
        "tournament_predictions": [],
        "tournaments": [{"id": 5, "name": "Liga tica", "unafut_aviso_firma": "x"}],
        "matches": [{"id": 1, "destapado_at": "2026-10-20T00:00:00+00:00", "jornada_oficial": 13}],
        "live_sync_state": [{"id": 1, "last_sync": "2026-10-20T00:00:00Z"}],
    }
    d = {"generado_at": "2026-10-20T03:00:00Z",
         "tablas_publicas": sorted([*datos, "predictions", "banned_emails"]),
         "excluidas": ["banned_emails", "predictions"],
         "datos": datos,
         "conteos_excluidos": {"banned_emails": 2}}
    d.update(extra)
    return d


def test_el_md_lleva_las_columnas_y_tablas_nuevas():
    g = _generar()
    d = g.combinar({"predictions": [{"league_id": "L", "user_id": "u1", "points_earned": 3}]}, _consulta_2())
    md, filas = g.armar_md(d)
    assert '"destapado_at": "2026-10-20T00:00:00+00:00"' in md
    assert '"jornada_oficial": 13' in md
    assert "### `live_sync_state` (1 filas)" in md
    assert "pagos confirmados: 1 (10,000 CRC)" in md
    assert "no un respaldo restaurable" in md
    assert filas == 7  # 1 por tabla con datos (tournament_predictions vacía)


def test_una_tabla_que_no_viene_ni_esta_excluida_corta_el_respaldo():
    g = _generar()
    d = _consulta_2()
    d["tablas_publicas"].append("historial_pagos")  # la 109 aplicada, consulta vieja
    with pytest.raises(g.RespaldoIncompleto, match="historial_pagos"):
        g.combinar({"predictions": []}, d)


def test_la_consulta_vieja_sin_inventario_no_pasa_por_completa():
    g = _generar()
    d = _consulta_2()
    del d["tablas_publicas"]
    with pytest.raises(g.RespaldoIncompleto):
        g.combinar({"predictions": []}, d)


def test_main_no_escribe_nada_si_esta_incompleto(tmp_path):
    g = _generar()
    d = _consulta_2()
    d["tablas_publicas"].append("tabla_nueva")
    a, b, salida = tmp_path / "1.json", tmp_path / "2.json", tmp_path / "r.md"
    a.write_text(json.dumps({"datos": json.dumps({"predictions": []})}))
    b.write_text(json.dumps({"datos": json.dumps(d)}))
    assert g.main(["generar.py", str(a), str(b), str(salida)]) == 2
    assert not salida.exists()


def test_la_consulta_2_no_nombra_columnas_a_mano():
    """La lista explícita de columnas de `matches` y `tournaments` es lo que
    dejó afuera `destapado_at`. La consulta tiene que tomar la fila entera
    (`to_jsonb`) menos lo excluido, y recorrer el catálogo."""
    c2 = SQL.split("=== CONSULTA 2")[1]
    assert "to_jsonb(x) - %L::text[]" in c2
    assert "'tablas_publicas'" in c2 and "pg_class" in c2
    assert "select id,tournament_id,external_id" not in c2.replace(" ", "")
    # Lo que no tiene que salir nunca, excluido explícitamente.
    assert "('users',   array['email'])" in c2
    for t in ("banned_emails", "push_subscriptions"):
        assert f"('{t}')" in c2
