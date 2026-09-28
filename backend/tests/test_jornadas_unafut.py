"""La jornada oficial viene de UNAFUT (pedido del dueño, 28 sep 2026).

Los datos de `datos/jornadas_crc_2026.json` son REALES: las 18 jornadas de
UNAFUT y los 90 partidos del torneo en la base, con la numeración ya corregida
y verificada a mano contra UNAFUT ese día (87 coinciden; 329/330 tienen fechas
distintas entre fuentes pero la misma jornada; 252 está anulado y UNAFUT no lo
lista).
"""
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
    assert d == [{"match_id": 1, "partido": "A vs B", "calculada": 11, "oficial": 12, "aplicada": True}]


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
