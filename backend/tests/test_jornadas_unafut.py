"""La jornada oficial viene de UNAFUT (pedido del dueño, 28 sep 2026).

Los datos de `datos/jornadas_crc_2026.json` son REALES: las 18 jornadas de
UNAFUT y los 90 partidos del torneo en la base, con la numeración ya corregida
y verificada a mano contra UNAFUT ese día (87 coinciden; 329/330 tienen fechas
distintas entre fuentes pero la misma jornada; 252 está anulado y UNAFUT no lo
lista).
"""
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.jornadas_unafut import (  # noqa: E402
    aplicar_jornada_oficial,
    emparejar_por_equipos,
    firma_de_diferencias,
    hay_que_refrescar,
)

DATOS = json.loads((Path(__file__).parent / "datos" / "jornadas_crc_2026.json").read_text())


def test_con_los_nombres_reales_empareja_todo_y_da_la_jornada_oficial():
    mapa = emparejar_por_equipos(DATOS["nuestros"], DATOS["oficiales"])
    faltan = [n["id"] for n in DATOS["nuestros"] if n["id"] not in mapa]
    assert faltan == [252], f"sin pareja: {faltan}"  # el anulado, que UNAFUT no lista
    distintas = [(n["id"], n["jornada"], mapa[n["id"]]) for n in DATOS["nuestros"] if n["id"] in mapa
                 and mapa[n["id"]] != n["jornada"]]
    assert distintas == []


def test_san_carlos_no_se_confunde_con_inter_san_carlos():
    """«A.D. San Carlos» e «Inter San Carlos» comparten tokens: el par entero desempata."""
    mapa = emparejar_por_equipos(DATOS["nuestros"], DATOS["oficiales"])
    por_id = {n["id"]: n for n in DATOS["nuestros"]}
    for mid, ronda in mapa.items():
        n = por_id[mid]
        if "San Carlos" in n["home_team"] + n["away_team"]:
            assert ronda == n["jornada"], n


def _p(eid, md, estado="pending"):
    return {"external_id": eid, "matchday": md, "status": estado, "home_team": "A", "away_team": "B",
            "stage": f"Jornada {md}"}


def test_se_aplica_si_no_empezo_y_no_hay_x2():
    parsed = [_p("e1", 11)]
    snap = {"e1": {"id": 1, "status": "pending", "matchday": 11, "jornada_oficial": 12}}
    d = aplicar_jornada_oficial(parsed, snap, con_x2=set())
    assert parsed[0]["matchday"] == 12 and parsed[0]["stage"] == "Jornada 12"
    assert d == [{"match_id": 1, "partido": "A vs B", "guardada": 11, "calculada": 11, "oficial": 12,
                  "aplicada": True}]


def test_con_un_x2_no_se_mueve_y_se_avisa():
    """Mover un ×2 de jornada lo cambiaría de bolsa de cupo: lo decide el admin."""
    parsed = [_p("e1", 11)]
    snap = {"e1": {"id": 1, "status": "pending", "matchday": 11, "jornada_oficial": 12}}
    d = aplicar_jornada_oficial(parsed, snap, con_x2={1})
    assert parsed[0]["matchday"] == 11
    assert d[0]["aplicada"] is False


def test_un_partido_jugado_no_cambia_de_jornada():
    parsed = [_p("e1", 11, "finished")]
    snap = {"e1": {"id": 1, "status": "finished", "matchday": 10, "jornada_oficial": 12}}
    d = aplicar_jornada_oficial(parsed, snap, con_x2=set())
    assert parsed[0]["matchday"] == 10, "conserva la guardada, ni la calculada ni la oficial"
    assert d[0]["aplicada"] is False


def test_sin_jornada_oficial_o_igual_no_hay_nada_que_decir():
    parsed = [_p("e1", 11), _p("e2", 12), {"external_id": "e3", "matchday": None, "status": "pending"}]
    snap = {"e1": {"id": 1, "jornada_oficial": None}, "e2": {"id": 2, "jornada_oficial": 12}}
    assert aplicar_jornada_oficial(parsed, snap, con_x2=set()) == []


def test_la_firma_solo_cambia_si_cambian_las_diferencias():
    a = [{"match_id": 1, "calculada": 11, "oficial": 12, "aplicada": True}]
    b = [{"match_id": 1, "calculada": 11, "oficial": 12, "aplicada": False}]
    assert firma_de_diferencias(a) == firma_de_diferencias(list(a))
    assert firma_de_diferencias(a) != firma_de_diferencias(b)


def test_se_refresca_cada_6_horas_y_solo_con_unafut_configurado():
    from datetime import datetime, timedelta, timezone
    ahora = datetime(2026, 9, 28, 12, tzinfo=timezone.utc)
    t = {"unafut_league_slug": "costarica", "unafut_competition_id": "2373"}
    assert hay_que_refrescar(t, ahora)
    assert not hay_que_refrescar({**t, "unafut_jornadas_at": (ahora - timedelta(hours=2)).isoformat()}, ahora)
    assert hay_que_refrescar({**t, "unafut_jornadas_at": (ahora - timedelta(hours=7)).isoformat()}, ahora)
    assert not hay_que_refrescar({"unafut_league_slug": None}, ahora)


def test_la_fecha_frena_a_un_san_carlos_sin_su_partido():
    """Solo el 252 (AD San Carlos–Escorpiones, anulado, que UNAFUT no lista):
    sin el tope de fecha calzaba con Inter San Carlos–Escorpiones de la jornada 14."""
    solo = [n for n in DATOS["nuestros"] if n["id"] == 252]
    assert emparejar_por_equipos(solo, DATOS["oficiales"]) == {}


def test_un_partido_de_unafut_no_se_asigna_dos_veces():
    """Inter–Escorpiones (314) y AD San Carlos–Escorpiones (252 con fecha cercana)
    compiten por el mismo partido de UNAFUT: gana el de puntaje y fecha mejor."""
    inter = next(n for n in DATOS["nuestros"] if n["id"] == 314)
    impostor = dict(next(n for n in DATOS["nuestros"] if n["id"] == 252), kickoff_at=inter["kickoff_at"])
    mapa = emparejar_por_equipos([impostor, inter], DATOS["oficiales"])
    assert mapa.get(314) == 14
    assert 252 not in mapa


def test_el_aviso_al_admin_no_se_repite_con_las_mismas_diferencias(monkeypatch):
    import asyncio
    import app.services.espn_tournament_sync as sync

    enviados, actualizaciones = [], []

    class _Q:
        def __init__(self, tabla): self.tabla = tabla
        def select(self, *_a, **_k): return self
        def eq(self, *_a, **_k): return self
        def update(self, fila):
            actualizaciones.append((self.tabla, fila))
            return self
        def execute(self):
            class R: data = [{"id": "admin"}]
            return R()

    class _Db:
        def table(self, t): return _Q(t)

    async def falso_push(_db, ids, titulo, cuerpo, url="/"):
        enviados.append(cuerpo)
        return 1
    monkeypatch.setattr(sync, "broadcast_push_to_users", falso_push)

    torneo = {"id": 2}
    difs = [{"match_id": 305, "partido": "A vs B", "calculada": 11, "oficial": 12, "aplicada": False}]
    asyncio.run(sync._avisar_jornadas(_Db(), torneo, difs))
    asyncio.run(sync._avisar_jornadas(_Db(), torneo, difs))
    assert len(enviados) == 1, "el mismo aviso salió dos veces"
    assert "SIN tocar" in enviados[0] and "J11→J12" in enviados[0]
    assert ("tournaments", {"unafut_aviso_firma": sync.firma_de_diferencias(difs)}) in actualizaciones


# ── Vigésima auditoría (4.2): se decide contra la jornada GUARDADA ──────────
# Los tres casos los dejó escritos la auditoría (scratchpad/auditoria20/x2 y
# verif_J1) y los tres caían con el código de la 107: la guarda solo actuaba
# cuando oficial ≠ calculada.

def test_x2_no_se_mueve_si_la_calculada_ya_coincide_con_la_oficial_nueva():
    """UNAFUT pasa el 305 a la J11 y ESPN mueve la fecha a esa semana a la vez:
    calculada = oficial = 11, guardada 12, con ×2. Antes se movía sin aviso."""
    snap = {"e1": {"id": 305, "status": "pending", "matchday": 12, "jornada_oficial": 11}}
    parsed = [_p("e1", 11)]
    d = aplicar_jornada_oficial(parsed, snap, con_x2={305})
    assert parsed[0]["matchday"] == 12 and parsed[0]["stage"] == "Jornada 12"
    assert [(x["match_id"], x["guardada"], x["oficial"], x["aplicada"]) for x in d] == [(305, 12, 11, False)]


def test_x2_no_se_mueve_sin_jornada_oficial():
    snap = {"e1": {"id": 305, "status": "pending", "matchday": 12, "jornada_oficial": None}}
    parsed = [_p("e1", 11)]
    d = aplicar_jornada_oficial(parsed, snap, con_x2={305})
    assert parsed[0]["matchday"] == 12
    assert [(x["match_id"], x["guardada"], x["calculada"], x["aplicada"]) for x in d] == [(305, 12, 11, False)]


def test_un_partido_jugado_no_cambia_de_jornada_aunque_calculada_igual_oficial():
    snap = {"e1": {"id": 1, "status": "finished", "matchday": 10, "jornada_oficial": 11}}
    parsed = [_p("e1", 11, "finished")]
    d = aplicar_jornada_oficial(parsed, snap, con_x2=set())
    assert parsed[0]["matchday"] == 10
    assert len(d) == 1 and d[0]["aplicada"] is False


def test_lo_que_ya_esta_en_la_oficial_no_se_reporta_como_trabado():
    """4.3 b: la guardada YA es la oficial (se corrigió en una pasada anterior)
    y después alguien puso un ×2: no hay nada que tocar ni que avisar."""
    snap = {"e1": {"id": 1, "status": "pending", "matchday": 12, "jornada_oficial": 12}}
    parsed = [_p("e1", 11)]
    assert aplicar_jornada_oficial(parsed, snap, con_x2={1}) == []
    assert parsed[0]["matchday"] == 12


def test_un_congelado_no_se_reporta():
    snap = {"e1": {"id": 252, "status": "cancelled", "matchday": 1, "jornada_oficial": None,
                   "score_locked": True}}
    parsed = [_p("e1", 2, "finished")]
    assert aplicar_jornada_oficial(parsed, snap, con_x2=set()) == []
    assert parsed[0]["matchday"] == 1


def test_solo_se_buscan_x2_donde_algo_se_moveria():
    from app.services.jornadas_unafut import partidos_a_mover
    snap = {"a": {"id": 1, "matchday": 12, "jornada_oficial": 11},      # oficial ≠ guardada
            "b": {"id": 2, "matchday": 12, "jornada_oficial": None},    # calculada ≠ guardada
            "c": {"id": 3, "matchday": 11, "jornada_oficial": 11},      # nada que mover
            "d": {"id": 4, "matchday": 11, "jornada_oficial": None}}
    parsed = [_p("a", 11), _p("b", 11), _p("c", 12), _p("d", 11)]
    assert partidos_a_mover(parsed, snap) == [1, 2]


def test_con_el_calendario_real_no_hay_avisos_de_mas():
    """Los 90 partidos reales, guardados con su jornada oficial: no tiene que
    salir ninguna diferencia (el aviso no puede volverse ruido)."""
    from app.services.espn_tournament_sync import _assign_stages
    parsed, snap = [], {}
    for n in DATOS["nuestros"]:
        estado = "finished" if n["kickoff_at"] < "2026-10-12" else "pending"
        eid = str(n["id"])
        parsed.append({"external_id": eid, "kickoff_at": n["kickoff_at"], "home_team": n["home_team"],
                       "away_team": n["away_team"], "status": estado, "stage_base": None, "leg": ""})
        snap[eid] = {"id": n["id"], "status": estado, "matchday": n["jornada"],
                     "jornada_oficial": None if n["id"] == 252 else n["jornada"],
                     "score_locked": n["id"] == 252}
    _assign_stages(parsed)
    assert aplicar_jornada_oficial(parsed, snap, con_x2=set()) == []
    assert all(p["matchday"] == snap[p["external_id"]]["matchday"] for p in parsed)


# ── 4.3: el aviso al admin ──────────────────────────────────────────────────

class _Q2:
    def __init__(self, db, tabla):
        self.db, self.tabla = db, tabla

    def select(self, *_a, **_k):
        return self

    def eq(self, *_a, **_k):
        return self

    def update(self, fila):
        self.db.actualizaciones.append((self.tabla, fila))
        return self

    def execute(self):
        class R:
            data = [{"id": "admin"}]
        return R()


class _Db2:
    def __init__(self):
        self.actualizaciones = []

    def table(self, t):
        return _Q2(self, t)


def _push_que_devuelve(monkeypatch, valor, enviados):
    import app.services.espn_tournament_sync as sync

    async def falso_push(_db, ids, titulo, cuerpo, url="/"):
        enviados.append(cuerpo)
        return valor
    monkeypatch.setattr(sync, "broadcast_push_to_users", falso_push)
    return sync


def test_si_no_sale_ningun_push_la_firma_no_se_guarda_y_se_reintenta(monkeypatch):
    """4.3 a: con 0 envíos (o sin dispositivos, que devuelve None) el aviso no
    se da por entregado: la próxima pasada lo vuelve a intentar."""
    for valor in (0, None):
        enviados = []
        sync = _push_que_devuelve(monkeypatch, valor, enviados)
        db, torneo = _Db2(), {"id": 2}
        difs = [{"match_id": 305, "partido": "A vs B", "guardada": 12, "calculada": 11,
                 "oficial": 11, "aplicada": False}]
        assert asyncio.run(sync._avisar_jornadas(db, torneo, difs)) == "sin-envio"
        assert asyncio.run(sync._avisar_jornadas(db, torneo, difs)) == "sin-envio"
        assert len(enviados) == 2
        assert db.actualizaciones == []
        assert "J12→J11" in enviados[0]


def test_sin_diferencias_la_firma_se_limpia_sin_mandar_nada(monkeypatch):
    enviados = []
    sync = _push_que_devuelve(monkeypatch, 1, enviados)
    db, torneo = _Db2(), {"id": 2, "unafut_aviso_firma": "305:12:11>11:0"}
    assert asyncio.run(sync._avisar_jornadas(db, torneo, [])) == "limpiada"
    assert enviados == []
    assert db.actualizaciones == [("tournaments", {"unafut_aviso_firma": ""})]
    # …y ya limpia, no vuelve a escribir en cada pasada.
    assert asyncio.run(sync._avisar_jornadas(db, torneo, [])) == "sin-cambios"
    assert len(db.actualizaciones) == 1


# ── 4.1: saques de ESPN más tarde que los de UNAFUT ────────────────────────

def test_con_los_horarios_reales_avisa_los_saques_atrasados_pendientes():
    """Con los datos del 28 sep: el 308 (AD San Carlos–Saprissa) estaba 2 h
    más tarde en ESPN. El 254 también difería, pero ya se jugó: no se avisa."""
    from app.services.jornadas_unafut import _emparejar, saques_atrasados
    nuestros = [dict(n, status="finished" if n["kickoff_at"] < "2026-10-12" else "pending")
                for n in DATOS["nuestros"]]
    atrasados = saques_atrasados(nuestros, DATOS["oficiales"], _emparejar(nuestros, DATOS["oficiales"]))
    por_id = {a["match_id"]: a["minutos"] for a in atrasados}
    assert por_id[308] == 120
    assert 254 not in por_id
    assert set(por_id) == {308, 313, 322, 323, 324, 325, 329, 330, 331, 332}
    assert all(m > 15 for m in por_id.values())


def test_un_saque_atrasado_15_minutos_o_uno_adelantado_no_se_avisa():
    from app.services.jornadas_unafut import saques_atrasados
    oficiales = [{"local": "A", "visita": "B", "fecha": "2026-10-25 22:00:00", "ronda": 13}]
    for nuestro, avisa in (("2026-10-25T22:15:00Z", False), ("2026-10-25T22:16:00Z", True),
                           ("2026-10-25T20:00:00Z", False)):
        n = [{"id": 1, "home_team": "A", "away_team": "B", "kickoff_at": nuestro, "status": "pending"}]
        assert bool(saques_atrasados(n, oficiales, {1: 0})) is avisa, nuestro


def test_las_dos_firmas_conviven_sin_pisarse(monkeypatch):
    enviados = []
    sync = _push_que_devuelve(monkeypatch, 1, enviados)
    db, torneo = _Db2(), {"id": 2, "unafut_aviso_firma": "305:12:11>11:0"}   # firma vieja, sin saques
    atrasados = [{"match_id": 308, "partido": "AD San Carlos vs Saprissa", "nuestro": "2026-10-26T00:00:00+00:00",
                  "unafut": "2026-10-25T22:00:00+00:00", "minutos": 120}]
    assert asyncio.run(sync._avisar_saques(db, torneo, atrasados)) == "enviado"
    assert "+120 min" in enviados[0]
    assert asyncio.run(sync._avisar_saques(db, torneo, atrasados)) == "sin-cambios"
    from app.services.jornadas_unafut import partes_de_firma
    jornadas, saques = partes_de_firma(torneo["unafut_aviso_firma"])
    assert jornadas == "305:12:11>11:0", "el aviso de saques pisó la firma de jornadas"
    assert saques == sync.firma_de_saques(atrasados)
    # Y el de jornadas, al limpiarse, no se lleva la de saques.
    asyncio.run(sync._avisar_jornadas(db, torneo, []))
    assert partes_de_firma(torneo["unafut_aviso_firma"]) == ("", saques)


# ── 4.3 c y d: UNAFUT en paralelo, con tope, y en la respuesta ─────────────

RONDAS = json.loads((Path(__file__).parent / "datos" / "unafut_rondas_crc_2026.json").read_text())["rondas"]


class _ClienteUnafut:
    def __init__(self, demora=0.01):
        self.demora, self.abiertas, self.max_abiertas, self.pedidas = demora, 0, 0, []

    async def get(self, url, params=None):
        r = int(url.rsplit("/", 1)[1])
        self.pedidas.append(r)
        self.abiertas += 1
        self.max_abiertas = max(self.max_abiertas, self.abiertas)
        await asyncio.sleep(self.demora)
        self.abiertas -= 1

        class Resp:
            def raise_for_status(self):
                pass

            def json(self):
                return RONDAS.get(str(r), [])
        return Resp()


def test_las_rondas_se_piden_en_paralelo_con_tope_y_cortan_en_las_vacias():
    from app.services.jornadas_unafut import PETICIONES_A_LA_VEZ, traer_jornadas
    cliente = _ClienteUnafut()
    salida = asyncio.run(traer_jornadas(cliente, "costarica", "2373"))
    assert len(salida) == 89 and {o["ronda"] for o in salida} == set(range(1, 19))
    assert 1 < cliente.max_abiertas <= PETICIONES_A_LA_VEZ, cliente.max_abiertas
    assert max(cliente.pedidas) <= 20, "siguió pidiendo después de las dos vacías"


def test_si_unafut_tarda_el_sync_sigue_sin_el_refresco(monkeypatch):
    import time
    import app.services.espn_tournament_sync as sync

    async def lento(*_a, **_k):
        await asyncio.sleep(5)
        return {"oficiales": 1}
    monkeypatch.setattr(sync, "refrescar_jornadas_oficiales", lento)
    monkeypatch.setattr(sync, "SEGUNDOS_PARA_REFRESCAR", 0.05)
    t0 = time.monotonic()
    info = asyncio.run(sync._refrescar_unafut(None, {"id": 2}))
    assert time.monotonic() - t0 < 2
    assert "error" in info


def test_el_resultado_del_refresco_queda_en_la_respuesta_del_sync(monkeypatch):
    """4.3 d: lo de UNAFUT va en la respuesta de /sync-live, que queda en
    net._http_response (Vercel guarda una hora)."""
    import app.services.espn_tournament_sync as sync
    from test_penales_y_series_espn import EVENTOS, _correr_sync

    async def refresco(*_a, **_k):
        return {"oficiales": 89, "emparejados": 89, "sin_pareja": 1, "actualizados": 0,
                "saques_atrasados": []}
    monkeypatch.setattr(sync, "_refrescar_unafut", refresco)
    monkeypatch.setattr(sync, "hay_que_refrescar", lambda _t: True)
    salida, *_ = _correr_sync(monkeypatch, [EVENTOS["762650"]], [])
    assert salida["unafut"]["emparejados"] == 89
    assert salida["avisos_unafut"] == {"saques": "sin-cambios"}


def test_el_sync_limpia_la_firma_cuando_ya_no_hay_diferencias(monkeypatch):
    """4.3 b, por la vía del sync: antes `_avisar_jornadas` solo se llamaba con
    diferencias, así que la firma vieja quedaba puesta y, si las mismas
    diferencias volvían, no se avisaba."""
    import copy
    from test_penales_y_series_espn import EVENTOS, _correr_sync
    ev = copy.deepcopy(EVENTOS["762650"])
    ev["season"]["slug"] = "apertura"          # fase regular: lleva jornada
    guardado = {"id": 7, "tournament_id": 2, "external_id": ev["id"], "status": "pending",
                "home_goals_actual": None, "away_goals_actual": None, "score_locked": False,
                "kickoff_at": ev["date"], "phase": "groups", "home_team": "Saprissa",
                "away_team": "Alajuelense", "matchday": 1, "jornada_oficial": 1,
                "goes_to_penalties": False, "penalties_winner_real": None}
    torneo = {"id": 2, "external_ref": "crc.1", "unafut_aviso_firma": "7:1:2>3:0"}
    salida, _por_eid, _p, base = _correr_sync(monkeypatch, [ev], [guardado], torneo)
    assert salida["avisos_unafut"]["jornadas"] == "limpiada"
    assert base.tablas["tournaments"][0]["unafut_aviso_firma"] == ""


def test_el_sync_busca_el_x2_aunque_la_oficial_coincida_con_la_calculada():
    """El caso de la auditoría por la vía que usa el sync: si los ×2 solo se
    buscan donde oficial ≠ calculada, el 305 no entra en la consulta y se mueve."""
    import app.services.espn_tournament_sync as sync
    from test_penales_y_series_espn import _Base
    base = _Base({"predictions": [{"match_id": 305, "use_powerup_x2": True}]})
    snap = {"e1": {"id": 305, "status": "pending", "matchday": 12, "jornada_oficial": 11}}
    parsed = [_p("e1", 11)]
    d = sync._usar_jornada_oficial(base, parsed, snap)
    assert parsed[0]["matchday"] == 12
    assert d and d[0]["aplicada"] is False
