"""El puntaje que se perdía y no se reintentaba nunca.

EL FALLO (leído en el código el 22 sep 2026, a raíz de una auditoría externa):
`espn_tournament_sync` solo llamaba al motor de puntos cuando el partido
TRANSICIONABA a `finished` y envolvía la llamada en `except Exception: pass`.
Si el motor fallaba a mitad —el paso 4 es un UPDATE por predicción, no una
transacción—, la pasada siguiente veía el partido ya terminado y sin cambios y
no lo volvía a puntuar. Nunca.

ESTE ARCHIVO SE REESCRIBIÓ, y es la excepción consciente a «añadir, nunca
reescribir»: la primera versión probaba un arreglo que NO podía dispararse.
Buscaba `points_earned IS NULL` y sus datos de prueba usaban `None`, pero la
columna nace en 0 — medido, 0 NULL en toda la tabla. Las pruebas pasaban
sobre una base que no existe. Conservarlas sería dejar en verde algo que
afirma lo contrario de la realidad.

Regla que sale de acá: **los datos de una prueba tienen que ser los que la
base real produce**. Acá, predicciones que nacen con `points_earned = 0`.
"""
import asyncio
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import app.services.scoring as scoring  # noqa: E402
from app.services.scoring import (  # noqa: E402
    calculate_and_update_scores,
    firma_resultado,
    partidos_sin_puntuar,
)


# ---------------------------------------------------------------------------
# Doble de Supabase: tablas en memoria, con lo justo que usan el motor y el
# detector. Registra las escrituras y puede fallar a propósito.
# ---------------------------------------------------------------------------
class _R:
    def __init__(self, data):
        self.data = data


class _Q:
    def __init__(self, db, tabla):
        self.db, self.tabla = db, tabla
        self.filtros, self.valores, self.modo, self.unica = [], None, "select", False

    def select(self, *_a, **_k):
        return self

    def eq(self, col, val):
        self.filtros.append(lambda f, c=col, v=val: f.get(c) == v)
        return self

    def in_(self, col, vals):
        vals = list(vals)
        self.filtros.append(lambda f, c=col, v=vals: f.get(c) in v)
        return self

    def single(self):
        self.unica = True
        return self

    def gte(self, col, val):
        self.filtros.append(lambda f, c=col, v=val: f.get(c) is not None and f.get(c) >= v)
        return self

    def lte(self, col, val):
        self.filtros.append(lambda f, c=col, v=val: f.get(c) is not None and f.get(c) <= v)
        return self

    def order(self, col, **_k):
        self.orden = col
        return self

    def range(self, desde, hasta):
        self.rango = (desde, hasta)
        return self

    def update(self, valores):
        self.modo, self.valores = "update", valores
        return self

    def execute(self):
        if self.db.fallar_si and self.db.fallar_si(self):
            raise RuntimeError("corte con la base a mitad del lote")
        filas = [f for f in self.db.tablas[self.tabla] if all(g(f) for g in self.filtros)]
        if self.modo == "update":
            for f in filas:
                f.update(self.valores)
            self.db.escrituras.append((self.tabla, dict(self.valores), [f.get("id") for f in filas]))
            return _R(filas)
        if self.unica:
            # Una COPIA, como PostgREST: devolver la fila misma haría que un
            # cambio posterior en la «base» apareciera en lo que ya se leyó.
            return _R(dict(filas[0]) if filas else None)
        orden = getattr(self, "orden", None)
        if orden:
            filas = sorted(filas, key=lambda f: str(f.get(orden)))
        desde, hasta = getattr(self, "rango", (0, len(filas)))
        # El tope de PostgREST: nunca más de 1.000 filas por respuesta. Un doble
        # sin tope dejaría pasar el lote cortado que la base ahora rechaza.
        filas = filas[desde:hasta + 1][:1000]
        return _R([dict(f) for f in filas])


class _RPC:
    def __init__(self, db, nombre, params):
        self.db, self.nombre, self.params = db, nombre, params

    def execute(self):
        if self.nombre == "partidos_pendientes_de_puntaje":
            # La LISTA la decide SQL (migración 92, probada contra Postgres);
            # el doble solo entrega la que se le dé.
            return _R(list(self.db.pendientes))
        assert self.nombre == "aplicar_puntaje", self.nombre
        if self.db.fallar_rpc:
            raise RuntimeError("se cortó la conexión con la base")
        return _R(self.db.aplicar_puntaje(**self.params))


class FalsaBase:
    def __init__(self, matches, predictions, leagues=()):
        self.tablas = {"matches": matches, "predictions": predictions, "leagues": list(leagues)}
        self.escrituras = []
        self.fallar_si = None
        self.fallar_rpc = False
        self.durante_el_calculo = None  # para intercalar otra ejecución
        self.pendientes = []
        self.consultas = 0

    def table(self, nombre):
        self.consultas += 1
        if nombre == "leagues" and self.durante_el_calculo:
            # A ya leyó el partido y sus predicciones; lo que pase ahora ocurre
            # MIENTRAS calcula en memoria, antes de escribir. Es la ventana real.
            gancho, self.durante_el_calculo = self.durante_el_calculo, None
            gancho()
        return _Q(self, nombre)

    def rpc(self, nombre, params):
        return _RPC(self, nombre, params)

    def aplicar_puntaje(self, p_match_id, p_home, p_away, p_penales, p_ganador_penales, p_firma, p_puntos):
        """La MISMA regla que la función SQL de la migración 90 (probada contra
        producción): si el resultado del partido ya no es el usado para
        calcular, no escribe NADA; si lo es, escribe puntos y firma juntos."""
        m = next(x for x in self.tablas["matches"] if x["id"] == p_match_id)
        vigente = (m.get("home_goals_actual"), m.get("away_goals_actual"),
                   bool(m.get("goes_to_penalties")), m.get("penalties_winner_real"))
        if m.get("status") != "finished" or vigente != (p_home, p_away, bool(p_penales), p_ganador_penales):
            return "desactualizado"
        # Migración 91: EXACTAMENTE las predicciones del partido, ids únicos y
        # puntos enteros no negativos; si no, no escribe nada.
        ids = [x.get("id") for x in p_puntos]
        del_partido = {pr["id"] for pr in self.tablas["predictions"] if pr["match_id"] == p_match_id}
        if (len(ids) != len(set(ids)) or set(ids) != del_partido
                or any(not isinstance(x.get("puntos"), int) or x["puntos"] < 0 for x in p_puntos)):
            return "incompleto"
        # Migración 92: cada predicción con el marcador que se usó.
        if any(not all(k in x for k in ("h", "a", "pw", "x2")) for x in p_puntos):
            return "incompleto"
        por_id = {pr["id"]: pr for pr in self.tablas["predictions"]}
        for x in p_puntos:
            pr = por_id[x["id"]]
            if (pr.get("home_goals_pred"), pr.get("away_goals_pred"), pr.get("penalties_winner_pred"),
                    bool(pr.get("use_powerup_x2"))) != (x["h"], x["a"], x["pw"], bool(x["x2"])):
                return "desactualizado"
        n = 0
        for x in p_puntos:
            for pr in self.tablas["predictions"]:
                if pr["id"] == x["id"] and pr["match_id"] == p_match_id and pr.get("points_earned") != x["puntos"]:
                    pr["points_earned"] = x["puntos"]; n += 1
        m["puntuado_con"] = p_firma
        return f"ok:{n}"


def _partido(**k):
    base = {"id": 7, "home_team": "Saprissa", "away_team": "Alajuelense",
            "home_goals_actual": 2, "away_goals_actual": 1, "status": "finished",
            "goes_to_penalties": False, "penalties_winner_real": None, "puntuado_con": None}
    base.update(k)
    return base


def _prediccion(pid, h, a, **k):
    """Como nace en la base de verdad: `points_earned` en 0, nunca None."""
    base = {"id": pid, "user_id": f"u{pid}", "league_id": "L", "match_id": 7,
            "home_goals_pred": h, "away_goals_pred": a, "use_powerup_x2": False,
            "penalties_winner_pred": None, "points_earned": 0}
    base.update(k)
    return base


@pytest.fixture(autouse=True)
def _sin_push(monkeypatch):
    async def nada(*_a, **_k):
        return None
    monkeypatch.setattr(scoring, "broadcast_push_to_users", nada)


def _correr(coro):
    return asyncio.run(coro)


def _correr_en_otro_hilo(coro):
    """B corre mientras A está a medio camino: otro hilo, otro bucle."""
    import threading
    fuera = {}
    h = threading.Thread(target=lambda: fuera.setdefault("r", asyncio.run(coro)))
    h.start(); h.join()
    return fuera.get("r")


# ---------------------------------------------------------------------------
# La firma
# ---------------------------------------------------------------------------
def test_la_firma_cambia_con_todo_lo_que_decide_los_puntos():
    base = firma_resultado(_partido())
    assert firma_resultado(_partido(home_goals_actual=3)) != base
    assert firma_resultado(_partido(goes_to_penalties=True)) != base
    assert (firma_resultado(_partido(goes_to_penalties=True, penalties_winner_real="Saprissa"))
            != firma_resultado(_partido(goes_to_penalties=True, penalties_winner_real="Alajuelense")))


def test_la_firma_no_depende_de_lo_que_no_puntua():
    assert firma_resultado(_partido(home_team="X")) == firma_resultado(_partido())


# ---------------------------------------------------------------------------
# El detector
# ---------------------------------------------------------------------------
def test_un_partido_terminado_que_nunca_se_marco_se_reintenta():
    db = FalsaBase([_partido(puntuado_con=None)], [])
    assert partidos_sin_puntuar(db, [7]) == {7}


def test_un_cero_legitimo_NO_se_reintenta():
    """EL CASO QUE LA PRIMERA VERSIÓN CONFUNDÍA: todas las predicciones en 0
    porque nadie acertó. El partido está bien puntuado y no hay nada que hacer."""
    p = _partido()
    p["puntuado_con"] = firma_resultado(p)
    db = FalsaBase([p], [_prediccion(1, 0, 0), _prediccion(2, 0, 3)])
    assert partidos_sin_puntuar(db, [7]) == set()


def test_un_resultado_corregido_despues_de_puntuar_se_reintenta():
    """El admin corrige 2-1 por 2-2 y el re-puntaje falla: la firma vieja ya
    no coincide con el resultado nuevo."""
    p = _partido(home_goals_actual=2, away_goals_actual=2)
    p["puntuado_con"] = firma_resultado(_partido(home_goals_actual=2, away_goals_actual=1))
    db = FalsaBase([p], [])
    assert partidos_sin_puntuar(db, [7]) == {7}


def test_un_partido_por_jugar_no_se_reintenta():
    db = FalsaBase([_partido(status="pending", home_goals_actual=None, away_goals_actual=None)], [])
    assert partidos_sin_puntuar(db, [7]) == set()


def test_sin_partidos_no_se_consulta_la_base():
    """El cron corre cada minuto: una pasada sin terminados no cuesta nada."""
    db = FalsaBase([_partido()], [])
    assert partidos_sin_puntuar(db, []) == set()
    assert partidos_sin_puntuar(db, None) == set()
    assert db.consultas == 0


def test_si_la_columna_no_existe_todavia_no_revienta():
    """Código desplegado antes que la migración: se sigue sin reintento, sin 500."""
    db = FalsaBase([_partido()], [])
    db.fallar_si = lambda q: q.tabla == "matches"
    assert partidos_sin_puntuar(db, [7]) == set()


# ---------------------------------------------------------------------------
# El motor marca AL FINAL
# ---------------------------------------------------------------------------
def test_un_puntaje_completo_deja_la_firma():
    db = FalsaBase([_partido()], [_prediccion(1, 2, 1), _prediccion(2, 0, 0)],
                   [{"id": "L", "points_exact": 3, "points_correct": 1}])
    _correr(calculate_and_update_scores(db, 7))
    assert db.tablas["matches"][0]["puntuado_con"] == firma_resultado(_partido())
    assert partidos_sin_puntuar(db, [7]) == set()


def test_si_la_escritura_falla_no_queda_NADA_y_se_reintenta():
    """Desde la migración 90 puntos y firma van en UNA transacción: si se corta,
    no quedan puntos a medias ni firma. La pasada siguiente lo completa."""
    db = FalsaBase([_partido()], [_prediccion(1, 2, 1), _prediccion(2, 2, 1)],
                   [{"id": "L", "points_exact": 3, "points_correct": 1}])
    db.fallar_rpc = True
    with pytest.raises(RuntimeError):
        _correr(calculate_and_update_scores(db, 7))
    assert [p["points_earned"] for p in db.tablas["predictions"]] == [0, 0]
    assert db.tablas["matches"][0]["puntuado_con"] is None
    assert partidos_sin_puntuar(db, [7]) == {7}, "el partido tiene que reintentarse"

    db.fallar_rpc = False
    _correr(calculate_and_update_scores(db, 7))
    assert [p["points_earned"] for p in db.tablas["predictions"]] == [3, 3]
    assert partidos_sin_puntuar(db, [7]) == set()


def test_dos_recalculos_cruzados_no_dejan_puntos_viejos_con_firma_nueva():
    """EL CASO DE LA CUARTA AUDITORÍA. A calcula con 2-1; mientras tanto el
    resultado pasa a 0-1 y B puntúa entero con el nuevo; recién entonces A
    intenta escribir. Antes A dejaba sus 3 puntos bajo la firma de B («0-1») y
    el reintento ya no lo veía. Ahora la base rechaza a A por desactualizado."""
    db = FalsaBase([_partido()], [_prediccion(1, 2, 1)],
                   [{"id": "L", "points_exact": 3, "points_correct": 1}])

    def llega_el_resultado_corregido_y_puntua_b():
        m = db.tablas["matches"][0]
        m["home_goals_actual"], m["away_goals_actual"] = 0, 1
        _correr_en_otro_hilo(calculate_and_update_scores(db, 7))   # B

    db.durante_el_calculo = llega_el_resultado_corregido_y_puntua_b
    resultado_a = _correr(calculate_and_update_scores(db, 7))      # A

    assert resultado_a["status"] == "stale"
    assert db.tablas["predictions"][0]["points_earned"] == 0, "quedaron los puntos del resultado viejo"
    assert db.tablas["matches"][0]["puntuado_con"] == firma_resultado(db.tablas["matches"][0])
    assert partidos_sin_puntuar(db, [7]) == set()


def test_un_partido_sin_predicciones_tambien_queda_marcado():
    """Si no, se reintentaría en cada pasada del cron para siempre."""
    db = FalsaBase([_partido()], [])
    _correr(calculate_and_update_scores(db, 7))
    assert partidos_sin_puntuar(db, [7]) == set()


# ---------------------------------------------------------------------------
# El sync usa el detector y no se traga el error
# ---------------------------------------------------------------------------
def test_el_sync_reintenta_los_pendientes_y_no_se_traga_el_error():
    fuente = (Path(__file__).resolve().parents[1]
              / "app" / "services" / "espn_tournament_sync.py").read_text()
    assert "partidos_sin_puntuar" in fuente, "el sync no consulta los pendientes"
    assert "or mid in pendientes" in fuente, "los pendientes no entran en `changed`"
    assert "scoring_errors" in fuente, "los fallos de puntaje no se reportan"
    cuerpo = fuente[fuente.index("    scored = 0"):fuente.index("# Recalcular medallas")]
    assert "except Exception:  # noqa: BLE001\n                pass" not in cuerpo, \
        "el fallo de puntaje se vuelve a tragar en silencio"


# ---------------------------------------------------------------------------
# Quinta auditoría: lote completo y recuperación desde la base (migración 91)
# ---------------------------------------------------------------------------
def test_con_mas_de_mil_predicciones_el_lote_va_entero():
    """PostgREST corta en 1.000 filas y la base ahora rechaza un lote
    incompleto: sin paginar, un partido con 1.500 predicciones no se puntuaría
    nunca. El doble impone el mismo tope."""
    preds = [_prediccion(f"p{i:05d}", 2, 1) for i in range(1500)]
    db = FalsaBase([_partido()], preds, [{"id": "L", "points_exact": 3, "points_correct": 1}])
    r = _correr(calculate_and_update_scores(db, 7))
    assert r["status"] == "ok"
    assert all(p["points_earned"] == 3 for p in db.tablas["predictions"])
    assert partidos_sin_puntuar(db, [7]) == set()


def test_si_la_base_rechaza_el_lote_no_se_da_por_puntuado(monkeypatch):
    """`incompleto` no es un «ok»: se lanza, no se avisa a nadie y el partido
    queda pendiente para la pasada siguiente."""
    db = FalsaBase([_partido()], [_prediccion(1, 2, 1)], [{"id": "L", "points_exact": 3, "points_correct": 1}])
    avisos = []

    async def push(*a, **k):
        avisos.append(a)
    monkeypatch.setattr(scoring, "broadcast_push_to_users", push)
    db.aplicar_puntaje = lambda **_k: "incompleto"
    with pytest.raises(RuntimeError, match="incompleto"):
        _correr(calculate_and_update_scores(db, 7))
    assert avisos == []
    assert partidos_sin_puntuar(db, [7]) == {7}


def _base_para_recuperar():
    partidos = [
        # El del viernes 9: terminó, el puntaje falló, ESPN ya no lo devuelve.
        _partido(id=297, tournament_id=5),
        # Congelado por el admin: también se puntúa.
        _partido(id=298, tournament_id=5, score_locked=True),
    ]
    preds = [_prediccion(1, 2, 1, match_id=297), _prediccion(2, 2, 1, match_id=298)]
    ligas = [{"id": "L", "tournament_id": 5, "points_exact": 3, "points_correct": 1}]
    db = FalsaBase(partidos, preds, ligas)
    db.pendientes = [297, 298]
    return db


def test_la_recuperacion_puntua_lo_que_la_base_dice_sin_preguntarle_a_la_fuente():
    """EL CASO DE LA QUINTA AUDITORÍA: el último partido en curso termina, el
    puntaje falla y ya no hay otro partido ni eventos de ESPN. Desde la 92 la
    lista la da `partidos_pendientes_de_puntaje()` (la misma de la puerta del
    cron) y el backend solo la recorre."""
    db = _base_para_recuperar()
    r = _correr(scoring.puntuar_pendientes(db))
    assert sorted(x["match_id"] for x in r["puntuados"]) == [297, 298]
    assert r["errores"] == []
    assert {p["match_id"]: p["points_earned"] for p in db.tablas["predictions"]} == {297: 3, 298: 3}


def test_un_fallo_no_tapa_a_los_demas_y_no_se_cuenta_como_exito():
    db = _base_para_recuperar()
    original = db.aplicar_puntaje

    def falla_el_297(**k):
        if k["p_match_id"] == 297:
            raise RuntimeError("se cortó")
        return original(**k)
    db.aplicar_puntaje = falla_el_297
    r = _correr(scoring.puntuar_pendientes(db))
    assert [e["match_id"] for e in r["errores"]] == [297]
    assert [x["match_id"] for x in r["puntuados"]] == [298]


def test_un_partido_sin_goles_es_un_error_no_un_puntuado():
    """Sexta auditoría: un `status: error` del motor se contaba entre los
    puntuados y `errores` salía vacío."""
    db = _base_para_recuperar()
    db.tablas["matches"][0]["home_goals_actual"] = None
    r = _correr(scoring.puntuar_pendientes(db))
    assert [e["match_id"] for e in r["errores"]] == [297]
    assert 297 not in [x["match_id"] for x in r["puntuados"]]


def test_desactualizado_queda_para_reintentar_no_es_exito_ni_error():
    db = _base_para_recuperar()
    db.aplicar_puntaje = lambda **_k: "desactualizado"
    r = _correr(scoring.puntuar_pendientes(db))
    assert r["puntuados"] == [] and r["errores"] == []
    assert sorted(x["match_id"] for x in r["reintentar"]) == [297, 298]


def test_sin_predicciones_y_la_base_dice_incompleto_no_es_un_exito():
    """Sexta auditoría: la rama «no hay predicciones» ignoraba la respuesta de
    la base y devolvía `ok` aunque la firma no se hubiera escrito (p. ej.
    porque entró una predicción entre la lectura y la escritura)."""
    db = FalsaBase([_partido(id=7)], [])
    db.pendientes = [7]
    db.aplicar_puntaje = lambda **_k: "incompleto"
    r = _correr(scoring.puntuar_pendientes(db))
    assert [e["match_id"] for e in r["errores"]] == [7]
    assert r["puntuados"] == []


def test_si_la_lista_no_se_puede_leer_se_dice():
    db = _base_para_recuperar()

    def rota(*_a, **_k):
        raise RuntimeError("la función no existe")
    db.rpc = rota
    r = _correr(scoring.puntuar_pendientes(db))
    assert r["pendientes"] == 0 and r["errores"], "un fallo al leer la lista quedó mudo"


def test_el_lote_lleva_el_marcador_con_el_que_se_calculo():
    """Migración 92: la base rechaza (desactualizado) un lote calculado con un
    marcador que ya no es el de la predicción, así que hay que mandarlo."""
    enviados = []
    db = FalsaBase([_partido()], [_prediccion(1, 2, 1, use_powerup_x2=True, penalties_winner_pred="X")],
                   [{"id": "L", "points_exact": 3, "points_correct": 1}])
    original = db.aplicar_puntaje

    def espia(**k):
        enviados.extend(k["p_puntos"])
        return original(**k)
    db.aplicar_puntaje = espia
    _correr(calculate_and_update_scores(db, 7))
    assert enviados == [{"id": 1, "puntos": 6, "h": 2, "a": 1, "pw": "X", "x2": True}]


def test_una_prediccion_corregida_durante_el_calculo_no_se_firma():
    """El admin corrige una predicción mientras el motor calcula: la base ve
    que el marcador enviado ya no es el vigente y no escribe nada."""
    db = FalsaBase([_partido()], [_prediccion(1, 2, 1)],
                   [{"id": "L", "points_exact": 3, "points_correct": 1}])

    def corrige():
        db.tablas["predictions"][0]["home_goals_pred"] = 0
    db.durante_el_calculo = corrige
    r = _correr(calculate_and_update_scores(db, 7))
    assert r["status"] == "stale"
    assert db.tablas["predictions"][0]["points_earned"] == 0
    assert db.tablas["matches"][0]["puntuado_con"] is None


def test_la_ventana_de_recuperacion_es_la_de_la_base_y_la_del_sync():
    """La ventana vive en SQL (una sola definición, la usan la puerta y el
    backend) y tiene que seguir siendo la del sync."""
    from app.services.espn_tournament_sync import DIAS_HACIA_ATRAS
    sql = (Path(__file__).resolve().parents[2] / "database"
           / "92_pagos_que_sobreviven_y_puntaje_que_no_se_pierde.sql").read_text()
    lista = sql[sql.index("FUNCTION public.partidos_pendientes_de_puntaje"):
                sql.index("REVOKE ALL ON FUNCTION public.partidos_pendientes_de_puntaje")]
    assert f"interval '{scoring.DIAS_DE_RECUPERACION} days'" in lista
    assert scoring.DIAS_DE_RECUPERACION == DIAS_HACIA_ATRAS
    assert "t.status" not in lista, "filtrar por torneo terminado deja afuera su último partido"
    assert "puntaje_pendiente_desde" in lista, "la ventana volvió a contarse desde el saque"
    puerta = sql[sql.index("FUNCTION public.hay_puntajes_pendientes"):]
    assert "partidos_pendientes_de_puntaje()" in puerta[:400], "la puerta y el backend volvieron a ser dos listas"


def test_el_endpoint_del_cron_corre_la_recuperacion():
    fuente = (Path(__file__).resolve().parents[1] / "app" / "routes" / "matches.py").read_text()
    cuerpo = fuente[fuente.index("async def sync_live"):fuente.index('@router.post("/notify-daily")')]
    # La LLAMADA, no el nombre: el import solo también lo contiene.
    assert "await puntuar_pendientes(supabase)" in cuerpo
