"""La alerta de puntajes trabados (B60, migración 104).

Antes la recuperación reintentaba un puntaje fallido durante 3 días y lo
soltaba sin avisar. Estas pruebas fijan que el aviso sale, a quién, que no
tumba el sync si falla, y que la base y el backend siguen hablando de la
misma lista.
"""
import asyncio
import logging
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import app.services.scoring as scoring  # noqa: E402

RAIZ = Path(__file__).resolve().parents[2]


class _R:
    def __init__(self, data):
        self.data = data


class _Q:
    def __init__(self, filas):
        self.filas = filas

    def select(self, *_a, **_k):
        return self

    def eq(self, col, val):
        self.filas = [f for f in self.filas if f.get(col) == val]
        return self

    def execute(self):
        return _R(self.filas)


class _Rpc:
    def __init__(self, base, nombre, args):
        self.base, self.nombre, self.args = base, nombre, args

    def execute(self):
        self.base.llamadas.append((self.nombre, self.args))
        if self.base.falla_rpc:
            raise RuntimeError("function reclamar_alertas_de_puntaje does not exist")
        return _R(self.base.trabados)


class FalsaBase:
    def __init__(self, trabados=(), falla_rpc=False):
        self.trabados = list(trabados)
        self.falla_rpc = falla_rpc
        self.llamadas = []
        self.reprogramadas = []
        self.users = [{"id": "admin", "is_admin": True}, {"id": "socio", "is_admin": False}]

    def rpc(self, nombre, args):
        return _Rpc(self, nombre, args)

    def table(self, nombre):
        if nombre == "alertas_de_puntaje":
            return _Reprogramar(self)
        assert nombre == "users"
        return _Q(list(self.users))


class _Reprogramar:
    """El UPDATE que deja la alerta para dentro de una hora. Anota lo pedido."""

    def __init__(self, base):
        self.base, self.pedido = base, {}

    def update(self, cambios):
        self.pedido["update"] = cambios
        return self

    def in_(self, col, vals):
        self.pedido["in"] = (col, list(vals))
        return self

    def gt(self, col, val):
        self.pedido["gt"] = (col, val)
        return self

    def execute(self):
        if getattr(self.base, "falla_reprogramar", False):
            raise RuntimeError("sin red")
        self.base.reprogramadas.append(self.pedido)
        return _R([])


def _correr(coro):
    return asyncio.run(coro)


def _espiar_push(monkeypatch, devuelve=1):
    enviados = []

    async def falso(supabase, user_ids, title, body, url="/"):
        enviados.append({"ids": list(user_ids), "title": title, "body": body, "url": url})
        return devuelve
    monkeypatch.setattr(scoring, "broadcast_push_to_users", falso)
    return enviados


def test_sin_trabados_no_se_avisa(monkeypatch):
    enviados = _espiar_push(monkeypatch)
    r = _correr(scoring.alertar_puntajes_trabados(FalsaBase()))
    assert r == {"partidos": [], "enviados": 0}
    assert enviados == []


def test_un_trabado_le_llega_solo_a_los_admins(monkeypatch):
    enviados = _espiar_push(monkeypatch)
    db = FalsaBase([{"match_id": 297, "partido": "Saprissa vs Herediano", "avisos": 1}])
    r = _correr(scoring.alertar_puntajes_trabados(db))
    assert r["partidos"] == [297] and r["enviados"] == 1
    assert len(enviados) == 1
    assert enviados[0]["ids"] == ["admin"], "la alerta es del admin, no del grupo"
    assert "Saprissa vs Herediano" in enviados[0]["body"]
    assert db.llamadas == [("reclamar_alertas_de_puntaje", {"p_horas": scoring.HORAS_PARA_ALERTAR})]


def test_si_la_base_falla_no_revienta_y_lo_dice(monkeypatch, caplog):
    enviados = _espiar_push(monkeypatch)
    with caplog.at_level(logging.ERROR):
        r = _correr(scoring.alertar_puntajes_trabados(FalsaBase(falla_rpc=True)))
    assert "error" in r and enviados == []
    assert any("puntajes trabados" in m for m in caplog.messages)


def test_si_no_llega_a_nadie_queda_un_error_en_el_log(monkeypatch, caplog):
    _espiar_push(monkeypatch, devuelve=None)  # admin sin dispositivos
    db = FalsaBase([{"match_id": 1, "partido": "A vs B", "avisos": 1}])
    with caplog.at_level(logging.ERROR):
        r = _correr(scoring.alertar_puntajes_trabados(db))
    assert r["enviados"] == 0
    assert any("no llegó a ningún dispositivo" in m for m in caplog.messages)


# Revisión de Codex (12 oct 2026): que el envío no reviente no es que haya
# llegado. Con 0 entregas sin excepción el reclamo quedaba anotado y la alerta
# se callaba 20 h. Revisión de la auditoría 20: soltarlo del todo la repetía
# en la pasada siguiente —un minuto, con el cron en día de partidos—, así que
# lo que no consta que llegó se reintenta en UNA hora.
def _una_hora_antes_de_volver(pedido):
    from datetime import datetime, timedelta, timezone
    ultimo = datetime.fromisoformat(pedido["update"]["ultimo_aviso_at"])
    vuelve = ultimo + timedelta(hours=scoring.HORAS_ENTRE_AVISOS) - datetime.now(timezone.utc)
    return timedelta(minutes=55) < vuelve <= timedelta(minutes=60)


@pytest.mark.parametrize("devuelve", [0, None], ids=["cero-entregas", "sin-dispositivos"])
def test_si_no_llega_a_nadie_se_reintenta_en_una_hora(monkeypatch, devuelve):
    _espiar_push(monkeypatch, devuelve=devuelve)
    db = FalsaBase([{"match_id": 3, "partido": "A vs B", "avisos": 1},
                    {"match_id": 4, "partido": "C vs D", "avisos": 2}])
    r = _correr(scoring.alertar_puntajes_trabados(db))
    assert r["enviados"] == 0 and r.get("error") == "sin-entrega"
    assert len(db.reprogramadas) == 1
    pedido = db.reprogramadas[0]
    assert pedido["in"] == ("match_id", [3, 4])
    assert pedido["gt"][0] == "ultimo_aviso_at", "solo lo que ESTA pasada reclamó"
    assert _una_hora_antes_de_volver(pedido)


def test_si_llego_a_alguien_NO_se_reprograma(monkeypatch):
    """La otra mitad: con una entrega, las 20 h de silencio son lo correcto."""
    _espiar_push(monkeypatch, devuelve=1)
    db = FalsaBase([{"match_id": 3, "partido": "A vs B", "avisos": 1}])
    r = _correr(scoring.alertar_puntajes_trabados(db))
    assert r["enviados"] == 1 and "error" not in r
    assert db.reprogramadas == []


def test_si_tampoco_se_puede_reprogramar_no_revienta(monkeypatch, caplog):
    _espiar_push(monkeypatch, devuelve=0)
    db = FalsaBase([{"match_id": 3, "partido": "A vs B"}])
    db.falla_reprogramar = True
    with caplog.at_level(logging.ERROR):
        r = _correr(scoring.alertar_puntajes_trabados(db))
    assert r["enviados"] == 0
    assert any("Tampoco se pudo reprogramar" in m for m in caplog.messages)


def test_un_proveedor_lento_no_repite_la_alerta_cada_minuto(monkeypatch):
    """El caso de la revisión, con la semántica real del reclamo (104): el
    proveedor entrega pero responde tarde, así que cada pasada ve 0 enviados.
    Cinco pasadas de un minuto: antes, cinco avisos; ahora, uno."""
    from datetime import datetime, timedelta, timezone
    enviados = _espiar_push(monkeypatch, devuelve=0)

    class ConReloj(FalsaBase):
        """`reclamar_alertas_de_puntaje` de verdad: entrega el partido si nunca
        se avisó o si el último aviso tiene más de 20 h, y anota now()."""

        def __init__(self):
            super().__init__()
            self.ultimo = None

        def rpc(self, nombre, args):
            base = self

            class _X:
                def execute(self_inner):
                    ahora = datetime.now(timezone.utc)
                    if base.ultimo is None or base.ultimo < ahora - timedelta(hours=20):
                        base.ultimo = ahora
                        return _R([{"match_id": 297, "partido": "A vs B", "avisos": 1}])
                    return _R([])
            return _X()

    db = ConReloj()

    def aplicar_reprogramacion():
        for pedido in db.reprogramadas:
            db.ultimo = datetime.fromisoformat(pedido["update"]["ultimo_aviso_at"])
        db.reprogramadas.clear()

    for _ in range(5):
        _correr(scoring.alertar_puntajes_trabados(db))
        aplicar_reprogramacion()
        db.ultimo -= timedelta(minutes=1)   # pasa un minuto
    assert len(enviados) == 1


def test_las_20_horas_son_las_del_reclamo():
    sql = (RAIZ / "database" / "104_alerta_de_puntajes_y_anonimizar_cuentas.sql").read_text()
    assert f"interval '{scoring.HORAS_ENTRE_AVISOS} hours'" in sql
    assert scoring.MINUTOS_PARA_REINTENTAR_ALERTA < scoring.HORAS_ENTRE_AVISOS * 60


def test_el_aviso_sale_antes_de_que_la_recuperacion_suelte_el_partido():
    assert scoring.HORAS_PARA_ALERTAR < scoring.DIAS_DE_RECUPERACION * 24


def test_el_cron_avisa_despues_de_reintentar():
    fuente = (RAIZ / "backend" / "app" / "routes" / "matches.py").read_text()
    cuerpo = fuente[fuente.index("async def sync_live"):fuente.index('@router.post("/notify-daily")')]
    reintento = cuerpo.index("await puntuar_pendientes(supabase)")
    alerta = cuerpo.index("await alertar_puntajes_trabados(supabase)")
    assert reintento < alerta, "avisar antes de reintentar alertaría de lo que esta pasada arregla"


def test_la_alerta_usa_la_misma_lista_que_la_recuperacion():
    sql = (RAIZ / "database" / "104_alerta_de_puntajes_y_anonimizar_cuentas.sql").read_text()
    funcion = sql[sql.index("FUNCTION public.reclamar_alertas_de_puntaje"):
                  sql.index("REVOKE ALL ON FUNCTION public.reclamar_alertas_de_puntaje")]
    assert "partidos_pendientes_de_puntaje()" in funcion, "una segunda definición de «pendiente»"
    assert "interval '20 hours'" in funcion
    assert "ON CONFLICT" in funcion, "el reclamo tiene que ser atómico"


def test_si_el_envio_revienta_se_reintenta_en_una_hora(monkeypatch):
    """Auditoría 19: antes el reclamo quedaba anotado y la alerta callaba 20 h."""
    async def revienta(*_a, **_k):
        raise RuntimeError("proveedor caído")
    monkeypatch.setattr(scoring, "broadcast_push_to_users", revienta)
    db = FalsaBase([{"match_id": 7, "partido": "A vs B", "avisos": 1}])
    r = _correr(scoring.alertar_puntajes_trabados(db))
    assert r["enviados"] == 0 and "error" in r
    assert len(db.reprogramadas) == 1 and db.reprogramadas[0]["in"] == ("match_id", [7])
    assert _una_hora_antes_de_volver(db.reprogramadas[0])
