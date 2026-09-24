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
        if self.tabla == "leagues":
            return _R(list(getattr(self.base, "creadas", [])))
        if self.tabla == "rule_proposals":
            return _R(list(getattr(self.base, "propuestas", [])))
        if self.tabla == "rule_votes":
            return _R(list(getattr(self.base, "votos", [])))
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


# ---------------------------------------------------------------------------
# Séptima auditoría: nada se borra ANTES de que la cascada sea aprobada
# ---------------------------------------------------------------------------
class _AuthQueFalla(_Auth):
    def delete_user(self, uid):
        raise RuntimeError("User not found")


class _QConCandado(_Q):
    """El trigger de la 92: la cascada desde users choca con un pago que se
    confirmó DESPUÉS de la comprobación inicial."""
    def execute(self):
        if self.borrar and self.tabla == "users":
            raise RuntimeError("Esta membresía tiene un pago confirmado: borrarla borraría la constancia del pago.")
        return super().execute()


class BaseConCarrera(Base):
    def __init__(self):
        super().__init__(pagos=[])
        self.auth = _AuthQueFalla(self)

    def table(self, t): return _QConCandado(self, t)


def test_si_el_pago_se_confirma_en_medio_no_queda_un_borrado_a_medias(monkeypatch):
    """La comprobación inicial ve cero pagos; se confirma uno; Auth falla por el
    trigger y el respaldo también. Antes ya se habían borrado las globales y
    las suscripciones, y se había vetado el correo."""
    base = BaseConCarrera()
    monkeypatch.setattr(admin_mod, "get_supabase", lambda: base)
    with pytest.raises(HTTPException) as e:
        asyncio.run(admin_mod.delete_user(user_id="u1", ban=True, admin={"sub": "admin"}))
    assert e.value.status_code == 409
    assert base.borrados == [], f"quedó un borrado a medias: {base.borrados}"


def test_el_endpoint_no_borra_tablas_por_su_cuenta():
    """Las globales y las suscripciones caen en la MISMA cascada (FK a
    public.users con ON DELETE CASCADE, comprobado en producción)."""
    fuente = (Path(__file__).resolve().parents[1] / "app" / "routes" / "admin.py").read_text()
    cuerpo = fuente[fuente.index("async def delete_user"):]
    cuerpo = cuerpo[:cuerpo.index("\n@router")] if "\n@router" in cuerpo else cuerpo
    assert 'for tbl in ("tournament_predictions", "push_subscriptions")' not in cuerpo
    assert cuerpo.index("delete_user(user_id)") < cuerpo.index('table("banned_emails")'), \
        "el veto del correo vuelve a ir antes del borrado"



# ---------------------------------------------------------------------------
# Octava auditoría: borrar al creador borraba su quiniela entera
# ---------------------------------------------------------------------------
def test_al_creador_de_una_quiniela_no_se_lo_borra(monkeypatch):
    """`leagues.admin_id` era ON DELETE CASCADE: la cuenta del creador se
    llevaba la quiniela con las predicciones de todos (Champions 26-27: 7
    miembros, 289 predicciones, sin pagos que lo frenaran)."""
    base = Base(pagos=[])
    base.creadas = [{"name": "Champions 26-27"}]
    with pytest.raises(HTTPException) as e:
        _borrar(base, monkeypatch)
    assert e.value.status_code == 409
    assert "Champions 26-27" in e.value.detail
    assert base.borrados == []


def test_la_base_tambien_lo_impide_para_el_creador():
    sql = (Path(__file__).resolve().parents[2] / "database"
           / "94_borrar_al_creador_no_borra_la_quiniela.sql").read_text()
    assert "REFERENCES public.users(id) ON DELETE RESTRICT" in sql



# ---------------------------------------------------------------------------
# Cuentas sin perfil: el respaldo borraba solo el perfil si Auth fallaba
# ---------------------------------------------------------------------------
class _AuthCaida(_Auth):
    def delete_user(self, uid):
        raise RuntimeError("Connection reset by peer")


class _AuthSinUsuario(_Auth):
    def delete_user(self, uid):
        raise RuntimeError("User not found")


def test_si_auth_falla_por_otra_cosa_no_se_borra_el_perfil(monkeypatch):
    """Así quedaron 2 cuentas en producción: Auth falló, el respaldo borró el
    perfil y respondió «eliminado». La cuenta seguía pudiendo entrar."""
    base = Base(pagos=[])
    base.auth = _AuthCaida(base)
    with pytest.raises(HTTPException) as e:
        _borrar(base, monkeypatch)
    assert e.value.status_code == 502
    assert base.borrados == []


def test_si_auth_ya_no_tiene_la_cuenta_se_borra_el_perfil_huerfano(monkeypatch):
    base = Base(pagos=[])
    base.auth = _AuthSinUsuario(base)
    r = _borrar(base, monkeypatch)
    assert r["via"] == "users_table"
    assert base.borrados == ["users"]


class _AuthRechazadaPorLaBase(_Auth):
    def delete_user(self, uid):
        raise RuntimeError("Database error deleting user")


def test_si_la_base_rechaza_la_cascada_de_auth_no_se_borra_nada(monkeypatch):
    """El trigger de pagos (92) o la FK del creador (94) rechazan la cascada
    que dispara Auth: GoTrue responde «Database error». Nada se borra."""
    base = Base(pagos=[])
    base.auth = _AuthRechazadaPorLaBase(base)
    with pytest.raises(HTTPException) as e:
        _borrar(base, monkeypatch)
    assert e.value.status_code == 409
    assert base.borrados == []


# ---------------------------------------------------------------------------
# Novena auditoría: borrar una cuenta borraba decisiones del grupo
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("campo", ["propuestas", "votos"])
def test_a_quien_participo_en_una_votacion_no_se_lo_borra(monkeypatch, campo):
    """Borrar al co-admin que propuso se llevaba la propuesta con todos sus
    votos; borrar a un votante le quitaba el voto a una mayoría ya emitida."""
    base = Base(pagos=[])
    setattr(base, campo, [{"id": "p"}])
    with pytest.raises(HTTPException) as e:
        _borrar(base, monkeypatch)
    assert e.value.status_code == 409
    assert "votaciones" in e.value.detail
    assert base.borrados == []


def test_la_base_tambien_lo_impide_para_las_votaciones():
    sql = (Path(__file__).resolve().parents[2] / "database"
           / "95_votaciones_que_sobreviven_y_anulacion_sin_carreras.sql").read_text()
    assert "rule_proposals_proposed_by_fkey" in sql and "rule_votes_user_id_fkey" in sql
    assert sql.count("REFERENCES public.users(id) ON DELETE RESTRICT") == 2
