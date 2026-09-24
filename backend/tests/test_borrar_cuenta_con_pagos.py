"""Borrar una cuenta no puede borrar la constancia de un pago.

EL FALLO (sexta auditoría, hallazgo 1): `delete-user` solo comprobaba ser
admin global y no borrarse a sí mismo. La cascada auth.users → users →
league_members se llevaba el pago confirmado, que salir y borrar la quiniela
sí protegen. La base ahora lo rechaza igual (migración 92), pero el endpoint
tiene que mirarlo ANTES: si no, borra primero las globales y las
suscripciones, Auth falla por el trigger, y lo borrado no vuelve.
"""
import asyncio
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import app.routes.admin as admin_mod  # noqa: E402


class _R:
    def __init__(self, data):
        self.data = data


class _Q:
    def __init__(self, base, tabla):
        self.base, self.tabla, self.borrar = base, tabla, False

    def select(self, *_a, **_k): return self
    def eq(self, *_a, **_k): return self
    def single(self): return self
    def upsert(self, *_a, **_k): return self

    @property
    def not_(self): return self

    def is_(self, *_a, **_k): return self

    def delete(self):
        self.borrar = True
        return self

    def execute(self):
        if self.borrar:
            self.base.borrados.append(self.tabla)
            return _R([{"id": "x"}])
        if self.tabla == "league_members":
            if self.base.falla_consulta:
                raise RuntimeError("se cortó")
            return _R(self.base.pagos)
        return _R({"display_name": "Ana", "email": "ana@x.com"})


class _Auth:
    def __init__(self, base): self.admin = self; self.base = base
    def delete_user(self, uid): self.base.borrados.append("auth:" + uid)


class Base:
    def __init__(self, pagos, falla_consulta=False):
        self.pagos, self.falla_consulta, self.borrados = pagos, falla_consulta, []
        self.auth = _Auth(self)

    def table(self, t): return _Q(self, t)


def _borrar(base, monkeypatch):
    monkeypatch.setattr(admin_mod, "get_supabase", lambda: base)
    return asyncio.run(admin_mod.delete_user(user_id="u1", ban=False, admin={"sub": "admin"}))


def test_con_un_pago_confirmado_no_se_borra_NADA(monkeypatch):
    base = Base(pagos=[{"league_id": "L"}])
    with pytest.raises(HTTPException) as e:
        _borrar(base, monkeypatch)
    assert e.value.status_code == 409
    assert base.borrados == [], f"se borró {base.borrados} antes de rechazar"


def test_si_no_se_puede_comprobar_tampoco_se_borra(monkeypatch):
    base = Base(pagos=[], falla_consulta=True)
    with pytest.raises(HTTPException) as e:
        _borrar(base, monkeypatch)
    assert e.value.status_code == 503
    assert base.borrados == []


def test_sin_pagos_se_borra_como_siempre(monkeypatch):
    base = Base(pagos=[])
    r = _borrar(base, monkeypatch)
    assert r["status"] == "ok"
    assert "auth:u1" in base.borrados


def test_la_base_tambien_lo_impide():
    """El endpoint no es la única puerta: la 92 pone el candado en la tabla."""
    sql = (Path(__file__).resolve().parents[2] / "database"
           / "92_pagos_que_sobreviven_y_puntaje_que_no_se_pierde.sql").read_text()
    assert "BEFORE DELETE ON public.league_members" in sql
    assert "OLD.pago_confirmado_at IS NOT NULL" in sql
