"""«Mandar el push a la quiniela» tiene tope (vigésima auditoría, 3.2).

EL FALLO: `notify-daily-league` no registraba nada. Cada toque —o cada uno de
los admins— volvía a mandar el resumen del día a todo el grupo: hasta 11
pushes por toque en Bundestica. El botón se deshabilita mientras envía, así
que un doble toque simultáneo no duplicaba; dos toques seguidos, sí. Un aviso
que se repite es el que hace que la gente apague TODOS los avisos, y con eso
se pierden también el recordatorio del saque y el resumen de las 6 am.

EL ARREGLO: la misma bitácora del recordatorio (migración 82), con el tipo
«resumen-manual». Una vez por persona, quiniela y partido.

El doble de la base IMPONE la semántica real del reclamo de la 108 —membresía,
partido del torneo de la quiniela, todavía abierto, `ON CONFLICT DO NOTHING`
y re-reclamo de fallidas o abandonadas—, no solo la anota. Con un doble que
devolviera siempre todo, «el segundo toque no manda nada» no se podría ver.
"""
import asyncio
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import app.routes.matches as rutas  # noqa: E402
import app.services.notifications as notif  # noqa: E402
import app.services.resumen_diario as resumen  # noqa: E402

LIGA = "2df51e3a-60a0-4824-a7aa-98b25c6e8350"
OTRA_LIGA = "9f0c0e7e-1111-4222-8333-444455556666"
CREADOR, COADMIN, ANA, BETO, SIN_CEL = "u-creador", "u-coadmin", "u-ana", "u-beto", "u-sincel"


class _R:
    def __init__(self, data):
        self.data = data


class _Consulta:
    """Filtra de verdad: eq/neq/in_/gte/lt/gt combinados con AND, y limit."""

    def __init__(self, base, tabla):
        self.base, self.tabla = base, tabla
        self.filtros, self.op, self.cambios, self.tope = [], "select", None, None

    def select(self, *_a, **_k):
        return self

    def update(self, cambios):
        self.op, self.cambios = "update", cambios
        return self

    def delete(self):
        self.op = "delete"
        return self

    def eq(self, c, v):
        self.filtros.append(lambda f: f.get(c) == v)
        return self

    def neq(self, c, v):
        self.filtros.append(lambda f: f.get(c) != v)
        return self

    def in_(self, c, vs):
        vs = list(vs)
        self.filtros.append(lambda f: f.get(c) in vs)
        return self

    def gte(self, c, v):
        self.filtros.append(lambda f: f.get(c) >= v)
        return self

    def lt(self, c, v):
        self.filtros.append(lambda f: f.get(c) < v)
        return self

    def limit(self, n):
        self.tope = n
        return self

    def execute(self):
        filas = self.base.tablas[self.tabla]
        elegidas = [f for f in filas if all(p(f) for p in self.filtros)]
        if self.op == "update":
            for f in elegidas:
                f.update(self.cambios)
            return _R([dict(f) for f in elegidas])
        if self.op == "delete":
            self.base.tablas[self.tabla] = [f for f in filas if f not in elegidas]
            return _R([])
        if self.tope is not None:
            elegidas = elegidas[:self.tope]
        return _R([dict(f) for f in elegidas])


class _Rpc:
    def __init__(self, base, nombre, args):
        self.base, self.nombre, self.args = base, nombre, args

    def execute(self):
        assert self.nombre == "claim_notification_deliveries"
        b = self.base
        if b.reclamo_revienta:
            raise RuntimeError("connection reset")
        b.llamadas_al_reclamo += 1
        ahora = datetime.now(timezone.utc)
        tipo = self.args["p_tipo"]
        devueltas = []
        vistos = set()
        for e in self.args["p_entregas"]:
            clave = (e["user_id"], e["league_id"], e["match_id"])
            if clave in vistos:
                continue
            vistos.add(clave)
            # Los JOIN de la 108: miembro, partido del torneo de la quiniela,
            # sin terminar y con las predicciones abiertas.
            if not any(m["user_id"] == e["user_id"] and m["league_id"] == e["league_id"]
                       for m in b.tablas["league_members"]):
                continue
            liga = next(lg for lg in b.tablas["leagues"] if lg["id"] == e["league_id"])
            partido = next(p for p in b.tablas["matches"] if p["id"] == e["match_id"])
            if partido["tournament_id"] != liga["tournament_id"]:
                continue
            if partido["status"] in ("finished", "cancelled", "postponed"):
                continue
            if datetime.fromisoformat(partido["kickoff_at"]) - timedelta(minutes=15) <= ahora:
                continue
            fila = next((d for d in b.tablas["notification_deliveries"]
                         if (d["user_id"], d["league_id"], d["match_id"], d["tipo"]) == (*clave, tipo)),
                        None)
            if fila is None:
                b.tablas["notification_deliveries"].append({
                    "user_id": e["user_id"], "league_id": e["league_id"], "match_id": e["match_id"],
                    "tipo": tipo, "status": "claimed", "claim_token": e["claim_token"],
                    "claimed_at": ahora, "attempts": 1})
            elif fila["status"] == "failed" or (
                    fila["status"] == "claimed" and fila["claimed_at"] < ahora - timedelta(minutes=5)):
                fila.update(status="claimed", claim_token=e["claim_token"], claimed_at=ahora,
                            attempts=fila["attempts"] + 1)
            else:
                continue  # ON CONFLICT DO NOTHING
            devueltas.append({"claimed_user_id": e["user_id"], "claimed_league_id": e["league_id"],
                              "claimed_match_id": e["match_id"], "claimed_token": e["claim_token"]})
        return _R(devueltas)


class Base:
    def __init__(self, torneo_terminado=False, partidos=None):
        ahora = datetime.now(timezone.utc)
        self.tablas = {
            "leagues": [{"id": LIGA, "name": "Bundestica", "admin_id": CREADOR, "tournament_id": 2},
                        {"id": OTRA_LIGA, "name": "Otra", "admin_id": ANA, "tournament_id": 2}],
            "league_members": [
                {"league_id": LIGA, "user_id": u, "es_admin": u == COADMIN}
                for u in (CREADOR, COADMIN, ANA, BETO, SIN_CEL)
            ] + [{"league_id": OTRA_LIGA, "user_id": ANA, "es_admin": True}],
            "users": [{"id": u, "is_admin": False} for u in (CREADOR, COADMIN, ANA, BETO, SIN_CEL)],
            "tournaments": [{"id": 2, "status": "finished" if torneo_terminado else "active"}],
            "matches": partidos if partidos is not None else [
                {"id": 293, "tournament_id": 2, "home_team": "Saprissa", "away_team": "Herediano",
                 "kickoff_at": (ahora + timedelta(hours=3)).isoformat(), "status": "pending"},
                {"id": 294, "tournament_id": 2, "home_team": "Alajuelense", "away_team": "Cartaginés",
                 "kickoff_at": (ahora + timedelta(hours=5)).isoformat(), "status": "pending"},
            ],
            "predictions": [{"user_id": ANA, "league_id": LIGA, "match_id": 293}],
            "push_subscriptions": [
                {"user_id": u, "endpoint": f"https://fcm.googleapis.com/fcm/send/{u}",
                 "p256dh": "k", "auth": "a"}
                for u in (CREADOR, COADMIN, ANA, BETO)
            ],
            "notification_deliveries": [],
        }
        self.reclamo_revienta = False
        self.llamadas_al_reclamo = 0

    def table(self, nombre):
        return _Consulta(self, nombre)

    def rpc(self, nombre, args):
        return _Rpc(self, nombre, args)


@pytest.fixture
def entorno(monkeypatch):
    """Devuelve `tocar(base, quien)` y la lista de lo enviado. El «hoy» se
    fija a ±12 h para que la prueba no dependa de la hora a la que corre CI
    (el día de Costa Rica cambia a las 06:00 UTC)."""
    enviados = []
    fallan = set()

    def falso_envio(info, payload, ttl=None):
        enviados.append((info["endpoint"].rsplit("/", 1)[-1], payload))
        return info["endpoint"].rsplit("/", 1)[-1] not in fallan
    monkeypatch.setattr(notif, "send_push_notification", falso_envio)
    monkeypatch.setattr(resumen, "ventana_del_dia",
                        lambda ahora: (ahora - timedelta(hours=12), ahora + timedelta(hours=12)))

    def tocar(base, quien=CREADOR, liga=LIGA):
        monkeypatch.setattr(rutas, "get_supabase", lambda: base)
        return asyncio.run(rutas.notify_daily_league(league_id=liga, user={"sub": quien}))
    return tocar, enviados, fallan


def test_el_primer_toque_avisa_a_todos_los_que_tienen_dispositivo(entorno):
    tocar, enviados, _ = entorno
    r = tocar(Base())
    assert sorted(u for u, _ in enviados) == sorted([CREADOR, COADMIN, ANA, BETO])
    assert r["enviados"] == 4 and r["ya_avisados"] == 0
    # Quien no tiene dispositivo se informa, no se reclama.
    assert r["sin_dispositivo"] == 1
    assert "Te falta 1 por predecir" in dict(enviados)[ANA]["title"]


def test_el_segundo_toque_no_le_manda_nada_a_nadie(entorno):
    tocar, enviados, _ = entorno
    base = Base()
    tocar(base)
    enviados.clear()
    r = tocar(base)
    assert enviados == []
    assert r["enviados"] == 0 and r["personas"] == 0
    assert r["ya_avisados"] == 4 and r["omitidas_por_duplicado"] == 8
    # El panel muestra este texto en vez de «enviado a 0 dispositivos».
    assert r["mensaje"] == "Ya les había llegado este aviso a todos: no se repite."


def test_otro_admin_tampoco_lo_repite(entorno):
    """El tope es por persona y partido, no por quién toca."""
    tocar, enviados, _ = entorno
    base = Base()
    tocar(base, quien=CREADOR)
    enviados.clear()
    tocar(base, quien=COADMIN)
    assert enviados == []


def test_los_reclamos_quedan_cerrados_como_entregados(entorno):
    tocar, _, _ = entorno
    base = Base()
    tocar(base)
    filas = base.tablas["notification_deliveries"]
    assert len(filas) == 8
    assert {f["tipo"] for f in filas} == {"resumen-manual"}
    assert {f["status"] for f in filas} == {"delivered"}


def test_a_quien_le_fallo_se_le_puede_reintentar_con_otro_toque(entorno):
    """Una vez por persona y partido ENTREGADO: un envío fallido queda
    `failed` y el toque siguiente lo vuelve a reclamar — solo a esa persona."""
    tocar, enviados, fallan = entorno
    base = Base()
    fallan.add(BETO)
    tocar(base)
    fallan.clear()
    enviados.clear()
    r = tocar(base)
    assert [u for u, _ in enviados] == [BETO]
    assert r["ya_avisados"] == 3


def test_un_partido_nuevo_del_dia_si_se_avisa(entorno):
    """Lo ya avisado no se repite, pero un partido que aparece después (el
    sync lo trae a media mañana) sí. El texto cuenta solo ese y lo dice NUEVO:
    «Hoy hay 1 partido» sería falso, hoy se juegan tres."""
    tocar, enviados, _ = entorno
    base = Base()
    tocar(base)
    enviados.clear()
    base.tablas["matches"].append({
        "id": 295, "tournament_id": 2, "home_team": "Herediano", "away_team": "Liberia",
        "kickoff_at": (datetime.now(timezone.utc) + timedelta(hours=7)).isoformat(),
        "status": "pending"})
    tocar(base)
    assert len(enviados) == 4
    assert all(p["title"].startswith("⚽ 1 partido nuevo hoy · ") for _, p in enviados)
    assert not any("Hoy hay" in p["title"] for _, p in enviados)
    assert all("Herediano vs Liberia" in p["body"] for _, p in enviados)


def test_el_primer_aviso_del_dia_sigue_diciendo_hoy_hay(entorno):
    """Sin nada avisado antes, el título es el del resumen de siempre."""
    tocar, enviados, _ = entorno
    tocar(Base())
    assert all(p["title"].startswith("⚽ Hoy hay 2 partidos · ") for _, p in enviados)


def test_un_torneo_terminado_no_avisa(entorno):
    """Mismo corte que el resumen de las 6 am: la liga tica reusa el mismo
    tournament_id temporada tras temporada."""
    tocar, enviados, _ = entorno
    base = Base(torneo_terminado=True)
    r = tocar(base)
    assert enviados == [] and r["enviados"] == 0
    assert base.llamadas_al_reclamo == 0


def test_partidos_ya_cerrados_no_se_avisan(entorno):
    tocar, enviados, _ = entorno
    ahora = datetime.now(timezone.utc)
    base = Base(partidos=[
        {"id": 293, "tournament_id": 2, "home_team": "Saprissa", "away_team": "Herediano",
         "kickoff_at": (ahora + timedelta(minutes=10)).isoformat(), "status": "pending"},
    ])
    r = tocar(base)
    assert enviados == []
    assert r["mensaje"] == "Las predicciones de los partidos de hoy ya cerraron"


def test_sin_la_bitacora_NO_se_manda_nada(entorno):
    """Al revés que el recordatorio del saque: esto es un refuerzo, y mandar
    sin deduplicar es justo el agujero que se cierra."""
    tocar, enviados, _ = entorno
    base = Base()
    base.reclamo_revienta = True
    with pytest.raises(HTTPException) as e:
        tocar(base)
    assert e.value.status_code == 503
    assert enviados == []


def test_quien_no_es_admin_sigue_sin_poder(entorno):
    tocar, enviados, _ = entorno
    with pytest.raises(HTTPException) as e:
        tocar(Base(), quien=BETO)
    assert e.value.status_code == 404
    assert enviados == []
