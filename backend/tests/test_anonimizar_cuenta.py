"""Anonimizar una cuenta que no se puede borrar (B59, migración 104).

Los RESTRICT de las migraciones 92/94/95/96 hacen imborrable a quien pagó,
creó una quiniela, votó o confirmó pagos. Anonimizar es su salida: se borra lo
personal y se conserva lo histórico. Lo que importa fijar es el ORDEN: primero
se bloquea la cuenta, y si eso falla no se toca nada; nunca queda alguien
anonimizado que pueda seguir entrando.
"""
import asyncio
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import app.routes.admin as admin_mod  # noqa: E402

RAIZ = Path(__file__).resolve().parents[2]


class _R:
    def __init__(self, data):
        self.data = data


class _Q:
    def __init__(self, base, tabla):
        self.base, self.tabla = base, tabla

    def select(self, *_a, **_k): return self
    def eq(self, *_a, **_k): return self

    def upsert(self, fila, *_a, **_k):
        self.base.pasos.append(("upsert:" + self.tabla, fila))
        return self

    def execute(self):
        if self.tabla == "users":
            return _R(self.base.perfil)
        return _R([])


class _Rpc:
    def __init__(self, base, nombre, args):
        self.base, self.nombre, self.args = base, nombre, args

    def execute(self):
        self.base.pasos.append(("rpc:" + self.nombre, self.args))
        if self.base.falla_rpc:
            raise RuntimeError("se cortó")
        return _R({"status": "ok", "nombre": "Ex-miembro ABCD", "push_borradas": 1})


class _AuthAdmin:
    def __init__(self, base): self.base = base

    def update_user_by_id(self, uid, atributos):
        clave = "auth:ban" if "ban_duration" in atributos else "auth:datos"
        self.base.pasos.append((clave, atributos))
        if clave in self.base.falla_auth:
            raise RuntimeError("Auth no responde")


class _Auth:
    def __init__(self, base): self.admin = _AuthAdmin(base)


class Base:
    def __init__(self, perfil=None, falla_auth=(), falla_rpc=False):
        self.perfil = [{"display_name": "Ana", "email": "Ana@x.com", "is_admin": False}] \
            if perfil is None else perfil
        self.falla_auth, self.falla_rpc = set(falla_auth), falla_rpc
        self.pasos = []
        self.auth = _Auth(self)

    def table(self, t): return _Q(self, t)
    def rpc(self, n, a): return _Rpc(self, n, a)


def _anonimizar(base, monkeypatch, user_id="u1", ban=False):
    monkeypatch.setattr(admin_mod, "get_supabase", lambda: base)
    return asyncio.run(admin_mod.anonymize_user(user_id=user_id, ban=ban, admin={"sub": "admin"}))


def _nombres(base):
    return [p[0] for p in base.pasos]


def test_bloquea_primero_y_anonimiza_despues(monkeypatch):
    base = Base()
    r = _anonimizar(base, monkeypatch)
    assert r["status"] == "ok" and r["auth_datos"] == "borrados"
    assert _nombres(base) == ["auth:ban", "auth:datos", "rpc:anonimizar_usuario"]
    ban = base.pasos[0][1]
    assert ban["ban_duration"] == admin_mod.BLOQUEO_PERMANENTE
    datos = base.pasos[1][1]
    assert "Ana" not in str(datos) and "x.com" not in datos["email"]


def test_si_no_se_puede_bloquear_no_se_toca_nada(monkeypatch):
    base = Base(falla_auth={"auth:ban"})
    with pytest.raises(HTTPException) as e:
        _anonimizar(base, monkeypatch)
    assert e.value.status_code == 502
    assert _nombres(base) == ["auth:ban"], "se anonimizó a alguien que puede seguir entrando"


def test_si_falla_el_correo_en_auth_sigue_y_lo_dice(monkeypatch):
    base = Base(falla_auth={"auth:datos"})
    r = _anonimizar(base, monkeypatch)
    assert r["auth_datos"] == "sin-cambiar"
    assert "rpc:anonimizar_usuario" in _nombres(base)


def test_si_falla_la_base_avisa_que_quedo_bloqueada(monkeypatch):
    base = Base(falla_rpc=True)
    with pytest.raises(HTTPException) as e:
        _anonimizar(base, monkeypatch)
    assert e.value.status_code == 502 and "BLOQUEADA" in e.value.detail


def test_no_a_si_mismo_ni_a_un_admin_global(monkeypatch):
    base = Base()
    with pytest.raises(HTTPException) as e:
        _anonimizar(base, monkeypatch, user_id="admin")
    assert e.value.status_code == 400
    base = Base(perfil=[{"display_name": "Jefe", "email": "j@x.com", "is_admin": True}])
    with pytest.raises(HTTPException) as e:
        _anonimizar(base, monkeypatch)
    assert e.value.status_code == 409 and base.pasos == []


def test_cuenta_inexistente(monkeypatch):
    base = Base(perfil=[])
    with pytest.raises(HTTPException) as e:
        _anonimizar(base, monkeypatch)
    assert e.value.status_code == 404 and base.pasos == []


def test_con_ban_veta_el_correo_ORIGINAL(monkeypatch):
    base = Base()
    r = _anonimizar(base, monkeypatch, ban=True)
    assert r["banned_email"] == "ana@x.com"
    assert ("upsert:banned_emails" in _nombres(base))


def test_la_base_conserva_lo_historico():
    """La función SQL no borra nada que haga cuadrar la Tabla, el pozo o las votaciones."""
    sql = (RAIZ / "database" / "104_alerta_de_puntajes_y_anonimizar_cuentas.sql").read_text()
    cuerpo = sql[sql.index("FUNCTION public.anonimizar_usuario"):
                 sql.index("REVOKE ALL ON FUNCTION public.anonimizar_usuario")]
    for tabla in ("predictions", "league_members", "tournament_predictions",
                  "rule_votes", "rule_proposals", "powerup_credits"):
        assert f"FROM public.{tabla}" not in cuerpo and f"UPDATE public.{tabla}" not in cuerpo, tabla
    assert "DELETE FROM public.push_subscriptions" in cuerpo
    assert "GRANT EXECUTE ON FUNCTION public.anonimizar_usuario(uuid) TO service_role" in sql


def test_el_correo_de_los_metadatos_tambien_se_borra(monkeypatch):
    base = Base()
    _anonimizar(base, monkeypatch)
    datos = base.pasos[1][1]
    assert "email" in datos["user_metadata"] and datos["user_metadata"]["email"] is None


def test_si_el_veto_falla_se_dice(monkeypatch):
    """Después de anonimizar el correo original ya no está en ningún lado:
    un veto fallido no se puede reintentar, así que no se calla."""
    base = Base()
    original = _Q.upsert

    def falla(self, fila, *a, **k):
        if self.tabla == "banned_emails":
            raise RuntimeError("se cortó")
        return original(self, fila, *a, **k)
    monkeypatch.setattr(_Q, "upsert", falla)
    r = _anonimizar(base, monkeypatch, ban=True)
    assert r["banned_email"] is None and r["ban_error"]
