"""El recordatorio de los 45 minutos le llega a TODOS los que tengan avisos.

Decisión del dueño (11 oct 2026): «la idea es que igual avise a quienes tengan
activado faltando 45 minutos». Antes salía solo a quien le faltaba predecir y,
con el grupo al día, no le llegaba a nadie. Medido el 10 oct con el partido
295: dos personas reclamadas, las dos SIN dispositivo, cerradas como fallidas y
vueltas a reclamar cada 15 minutos sin que saliera un solo push.

Se corre el endpoint ENTERO con un doble de Supabase que anota lo que se le
pide, en las dos versiones de la base que van a convivir: la 82 (el reclamo
descarta a quien ya predijo) y la 108 (no descarta).
"""
import asyncio
import logging
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import app.routes.matches as rutas  # noqa: E402
import app.services.notifications as notif  # noqa: E402

LIGA = "2df51e3a-60a0-4824-a7aa-98b25c6e8350"
SIN_DISPOSITIVO, PENDIENTE, AL_DIA = "u-sin", "u-pend", "u-aldia"


class _R:
    def __init__(self, data):
        self.data = data


class _Consulta:
    def __init__(self, base, tabla):
        self.base, self.tabla = base, tabla
        self.filtros, self.columnas, self.op, self.cambios = [], None, "select", None

    def select(self, columnas="*", **_k):
        self.columnas = columnas
        return self

    def update(self, cambios):
        self.op, self.cambios = "update", cambios
        return self

    def delete(self):
        self.op = "delete"
        return self

    def __getattr__(self, nombre):
        def filtro(*args, **_k):
            self.filtros.append((nombre, *args))
            return self
        return filtro

    def _en(self, columna):
        for f in self.filtros:
            if f[0] == "in_" and f[1] == columna:
                return f[2]
        return None

    def execute(self):
        b = self.base
        if self.tabla == "matches":
            frescos = any(f[0] == "gte" for f in self.filtros)
            return _R([b.partido] if frescos else [])
        if self.tabla == "notification_deliveries":
            if self.op == "update":
                b.cierres.append(self.cambios)
            return _R([])
        if self.tabla == "tournaments":
            return _R([{"id": 2}])
        if self.tabla == "leagues":
            return _R([{"id": LIGA, "tournament_id": 2}])
        if self.tabla == "league_members":
            return _R([{"league_id": LIGA, "user_id": u} for u in (SIN_DISPOSITIVO, PENDIENTE, AL_DIA)])
        if self.tabla == "predictions":
            b.lecturas_de_predicciones += 1
            filas = [{"user_id": AL_DIA, "league_id": LIGA, "match_id": 295}]
            # Quien predice entre la primera lectura y el reclamo.
            if b.predice_entre_medio and b.lecturas_de_predicciones > 1:
                filas.append({"user_id": PENDIENTE, "league_id": LIGA, "match_id": 295})
            return _R(filas)
        if self.tabla == "push_subscriptions":
            if self.columnas == "user_id" and b.falla_filtro:
                raise RuntimeError("se cortó la consulta del filtro")
            ids = self._en("user_id") or []
            return _R([s for s in b.dispositivos if s["user_id"] in ids])
        raise AssertionError(f"tabla inesperada {self.tabla}")


class _Rpc:
    def __init__(self, base, nombre, args):
        self.base, self.nombre, self.args = base, nombre, args

    def execute(self):
        assert self.nombre == "claim_notification_deliveries"
        entregas = self.args["p_entregas"]
        self.base.pedidas.extend(entregas)
        devueltas = []
        for e in entregas:
            # La 82 descarta a quien ya predijo (NOT EXISTS predictions); la 108 no.
            if self.base.version_base == 82 and e["user_id"] == AL_DIA:
                continue
            devueltas.append({"claimed_user_id": e["user_id"], "claimed_league_id": e["league_id"],
                              "claimed_match_id": e["match_id"], "claimed_token": e["claim_token"]})
        return _R(devueltas)


class Base:
    def __init__(self, version_base=108, falla_filtro=False, predice_entre_medio=False):
        ahora = datetime.now(timezone.utc)
        self.partido = {"id": 295, "tournament_id": 2, "home_team": "Saprissa", "away_team": "Herediano",
                        "kickoff_at": (ahora + timedelta(minutes=50)).isoformat(), "status": "pending"}
        self.dispositivos = [
            {"user_id": PENDIENTE, "endpoint": "https://fcm.googleapis.com/fcm/send/p", "p256dh": "k", "auth": "a"},
            {"user_id": AL_DIA, "endpoint": "https://web.push.apple.com/q", "p256dh": "k", "auth": "a"},
        ]
        self.version_base, self.falla_filtro = version_base, falla_filtro
        self.predice_entre_medio, self.lecturas_de_predicciones = predice_entre_medio, 0
        self.pedidas, self.cierres = [], []

    def table(self, nombre):
        return _Consulta(self, nombre)

    def rpc(self, nombre, args):
        return _Rpc(self, nombre, args)


def _correr(monkeypatch, base):
    enviados = []

    def falso_envio(info, payload, ttl=None):
        enviados.append((info["endpoint"], payload))
        return True
    monkeypatch.setattr(notif, "send_push_notification", falso_envio)
    monkeypatch.setattr(rutas, "get_supabase", lambda: base)
    monkeypatch.setattr(rutas.settings, "CRON_SECRET", "s")
    respuesta = asyncio.run(rutas.notify_kickoff(authorization="Bearer s"))
    return respuesta, {ep: p for ep, p in enviados}


def test_con_la_108_le_llega_tambien_a_quien_ya_predijo(monkeypatch):
    base = Base(version_base=108)
    respuesta, enviados = _correr(monkeypatch, base)
    al_dia = enviados["https://web.push.apple.com/q"]
    # El saque está a 50 min: el título dice los minutos que faltan de verdad.
    assert al_dia["title"] == "⚽ Arranca en 50 min"
    assert "Saprissa vs Herediano" in al_dia["body"] and "ya está guardada" in al_dia["body"]
    assert "No has predicho" in enviados["https://fcm.googleapis.com/fcm/send/p"]["body"]
    assert respuesta["enviados"] == 2


def test_a_quien_no_tiene_dispositivo_ni_se_lo_reclama(monkeypatch):
    """Sin esto quedaba fallido y se re-reclamaba cada 15 minutos."""
    base = Base()
    respuesta, _ = _correr(monkeypatch, base)
    assert SIN_DISPOSITIVO not in {e["user_id"] for e in base.pedidas}
    assert respuesta["sin_dispositivo_previo"] == 1
    assert all(c.get("status") == "delivered" for c in base.cierres), base.cierres


def test_con_la_base_VIEJA_sigue_como_antes(monkeypatch):
    """El código se despliega antes que la migración 108: con la 82 quien ya
    predijo no se reclama y no recibe nada, el resto como siempre."""
    base = Base(version_base=82)
    respuesta, enviados = _correr(monkeypatch, base)
    assert list(enviados) == ["https://fcm.googleapis.com/fcm/send/p"]
    assert respuesta["enviados"] == 1


def test_si_el_filtro_falla_se_avisa_igual(monkeypatch):
    base = Base(falla_filtro=True)
    respuesta, enviados = _correr(monkeypatch, base)
    assert len(enviados) == 2
    assert respuesta["sin_dispositivo_previo"] is None
    # Sin filtro, quien no tiene dispositivo se reclama y queda fallido: lo de antes.
    assert SIN_DISPOSITIVO in {e["user_id"] for e in base.pedidas}


def test_cada_corrida_deja_una_linea_en_el_log(monkeypatch, caplog):
    """Un push que sale bien no deja rastro (pywebpush usa requests). Sin esta
    línea no se podía saber desde Vercel si los avisos salían."""
    with caplog.at_level(logging.INFO, logger="app.routes.matches"):
        _correr(monkeypatch, Base())
    lineas = [m for m in caplog.messages if m.startswith("Recordatorio de saque:")]
    assert len(lineas) == 1 and "'enviados': 2" in lineas[0]


@pytest.mark.parametrize("version", [82, 108])
def test_quien_ya_predijo_nunca_recibe_el_texto_de_pendiente(monkeypatch, version):
    _, enviados = _correr(monkeypatch, Base(version_base=version))
    al_dia = enviados.get("https://web.push.apple.com/q")
    assert al_dia is None or "No has predicho" not in al_dia["body"]


def test_quien_predice_justo_antes_del_reclamo_no_recibe_no_has_predicho(monkeypatch):
    """La 108 ya no descarta en la base a quien predijo entre la lectura y el
    reclamo: el backend relee lo reclamado antes de componer el texto."""
    _, enviados = _correr(monkeypatch, Base(predice_entre_medio=True))
    pendiente = enviados["https://fcm.googleapis.com/fcm/send/p"]
    assert pendiente["title"].startswith("⚽ Arranca"), pendiente


def test_un_reintento_dice_los_minutos_que_faltan_de_verdad():
    from datetime import datetime, timezone
    from app.services.resumen_diario import mensajes_de_recordatorio
    ahora = datetime(2026, 10, 10, 20, 40, tzinfo=timezone.utc)
    partido = {"id": 1, "home_team": "A", "away_team": "B", "kickoff_at": "2026-10-10T21:00:00Z"}
    m = mensajes_de_recordatorio([
        {"user_id": "u", "league_id": "l", "match_id": 1, "partido": partido, "predicha": True},
        {"user_id": "v", "league_id": "l", "match_id": 1, "partido": partido, "predicha": False},
    ], ahora)
    assert m["u"]["title"] == "⚽ Arranca en 20 min"
    assert m["v"]["title"] == "⏰ Faltan 20 min"
