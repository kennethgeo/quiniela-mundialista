"""La bitácora que deduplica los recordatorios (migración 82).

POR QUÉ EXISTE. La ventana [45, 60) solo evita solapamientos si el cron corre
con la cadencia ideal. Un reintento manual, dos peticiones a la vez o un atraso
desigual seleccionan el mismo partido dos veces, y la gente recibe el aviso
repetido. La barrera real está en Postgres —`ON CONFLICT DO NOTHING` antes del
push—; acá se prueba la mitad que vive en Python.

Todo es puro: no hay red ni base. El cliente de Supabase se reemplaza por un
doble que ANOTA lo que se le pide, para poder afirmar sobre el filtro exacto.
"""
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.notification_deliveries import (  # noqa: E402
    MINUTOS_PARA_RECLAMO_VENCIDO,
    TIPO_RECORDATORIO_SAQUE,
    DeduplicacionNoDisponible,
    cerrar_reclamos,
    clave_entrega,
    finalizar_reclamo,
    reclamar_entregas,
    reintentos_pendientes,
    resultado_de_entrega,
    seleccionar_candidatas,
)
from app.services.resumen_diario import (  # noqa: E402
    armar_recordatorios,
    entregas_recordatorio,
    mensajes_de_recordatorio,
)

AHORA = datetime(2026, 9, 21, 12, 0, tzinfo=timezone.utc)
ANA, BETO = "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"
LIGA_A, LIGA_B = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"


def _entrega(user, liga, match):
    return {"user_id": user, "league_id": liga, "match_id": match,
            "partido": {"id": match, "tournament_id": 2, "home_team": "A",
                        "away_team": "B", "kickoff_at": "2026-09-21T13:00:00Z"}}


class _Tabla:
    """Anota el filtro que se le pidió; devuelve lo que se le preparó."""

    def __init__(self, filas=None, revienta=None):
        self.filas, self.revienta, self.pedido = filas or [], revienta, {}
        self.actualizaciones = []

    def table(self, nombre):
        self.pedido["tabla"] = nombre
        return self

    def select(self, campos):
        self.pedido["select"] = campos
        return self

    def eq(self, campo, valor):
        self.pedido.setdefault("eq", {})[campo] = valor
        return self

    def or_(self, expr):
        self.pedido["or"] = expr
        return self

    def limit(self, n):
        self.pedido["limit"] = n
        return self

    def update(self, cambios):
        self.pedido["update"] = cambios
        return self

    def rpc(self, nombre, args):
        self.pedido["rpc"], self.pedido["args"] = nombre, args
        return self

    def execute(self):
        if self.revienta:
            raise self.revienta
        if "update" in self.pedido:
            self.actualizaciones.append({**self.pedido})
            self.pedido.pop("update")
            self.pedido.pop("eq", None)
        return type("R", (), {"data": self.filas})()


# ─────────────────────────────────────────────────────────────────────────────
# EL FALLO QUE ESTE ARCHIVO EXISTE PARA QUE NO VUELVA
#
# El cierre del reclamo leía `por_usuario[user_id]` con CORCHETES. Si el envío
# no dejaba detalle para alguien, saltaba un KeyError DESPUÉS de que el push ya
# había salido. Entonces las filas quedaban `claimed`, vencían a los cinco
# minutos y el aviso se mandaba OTRA VEZ: el duplicado que la bitácora existe
# para evitar, reintroducido por el camino de cierre.
# ─────────────────────────────────────────────────────────────────────────────
class TestElCierreNoPuedeReventar:

    def test_una_persona_sin_detalle_no_tumba_el_cierre(self):
        base = _Tabla()
        cierre = cerrar_reclamos(base, {ANA: "tok-a", BETO: "tok-b"},
                                 {ANA: {"enviados": 1}}, ahora=AHORA)
        assert cierre == {"cerrados": 2, "sin_cerrar": 0}
        assert len(base.actualizaciones) == 2

    def test_sin_detalle_se_cierra_como_fallido_para_que_se_reintente(self):
        """Y NO como entregado: afirmar que salió cuando no consta dejaría a
        esa persona sin su aviso y sin reintento."""
        entregado, error = resultado_de_entrega(None)
        assert (entregado, error) == (False, "push-fallido")

    def test_el_fallo_de_UNA_no_deja_abiertas_las_demas(self):
        class Caprichosa(_Tabla):
            def execute(self):
                if self.pedido.get("eq", {}).get("claim_token") == "tok-a":
                    raise RuntimeError("timeout")
                return super().execute()

        base = Caprichosa()
        cierre = cerrar_reclamos(base, {ANA: "tok-a", BETO: "tok-b"},
                                 {ANA: {"enviados": 1}, BETO: {"enviados": 1}}, ahora=AHORA)
        assert cierre == {"cerrados": 1, "sin_cerrar": 1}

    def test_sin_tokens_no_hace_nada(self):
        assert cerrar_reclamos(_Tabla(), {}, {}) == {"cerrados": 0, "sin_cerrar": 0}


class TestQueSeGuardaAlCerrar:

    def test_un_envio_bueno_queda_delivered_con_su_hora(self):
        base = _Tabla()
        finalizar_reclamo(base, "tok", entregado=True, error=None, ahora=AHORA)
        cambios = base.actualizaciones[0]["update"]
        assert cambios["status"] == "delivered"
        assert cambios["delivered_at"] == AHORA.isoformat()

    def test_un_fallo_queda_failed_y_SIN_hora_de_entrega(self):
        """La tabla tiene un CHECK que ata las dos cosas; mandar una hora con
        `failed` reventaría el cierre entero."""
        base = _Tabla()
        finalizar_reclamo(base, "tok", entregado=False, error="push-fallido", ahora=AHORA)
        cambios = base.actualizaciones[0]["update"]
        assert cambios["status"] == "failed"
        assert cambios["delivered_at"] is None

    def test_solo_se_cierra_lo_que_TODAVIA_es_mio(self):
        """Por token Y por `status = claimed`. Si otro trabajador ya recuperó
        la fila vencida, este cierre no puede pisarle el resultado."""
        base = _Tabla()
        finalizar_reclamo(base, "tok", entregado=True, ahora=AHORA)
        filtro = base.actualizaciones[0]["eq"]
        assert filtro == {"claim_token": "tok", "status": "claimed"}

    def test_el_error_guardado_es_una_CATEGORIA_no_el_mensaje_del_proveedor(self):
        """Web Push devuelve endpoints y detalles del dispositivo en sus
        errores. Misma regla que los logs de login."""
        categorias = {
            resultado_de_entrega({"enviados": 1})[1],
            resultado_de_entrega({"enviados": 1, "fallidos": 1})[1],
            resultado_de_entrega({"sin_dispositivo": True})[1],
            resultado_de_entrega({"expirados": 2})[1],
            resultado_de_entrega({})[1],
        }
        assert categorias == {None, "entrega-parcial", "sin-dispositivo-vigente", "push-fallido"}
        for c in categorias - {None}:
            assert len(c) <= 120 and " " not in c


class TestResultadoDeEntrega:

    @pytest.mark.parametrize("estado,esperado", [
        ({"enviados": 2}, (True, None)),
        ({"enviados": 1, "fallidos": 1}, (True, "entrega-parcial")),
        ({"enviados": 1, "expirados": 1}, (True, "entrega-parcial")),
        ({"enviados": 0, "sin_dispositivo": True}, (False, "sin-dispositivo-vigente")),
        ({"enviados": 0, "expirados": 1}, (False, "sin-dispositivo-vigente")),
        ({"enviados": 0, "fallidos": 3}, (False, "push-fallido")),
    ])
    def test_casos(self, estado, esperado):
        assert resultado_de_entrega(estado) == esperado

    def test_si_llego_a_algun_dispositivo_cuenta_como_entregado(self):
        """Con dos teléfonos y uno caído, la persona SÍ recibió el aviso.
        Marcarlo `failed` lo repetiría en la corrida siguiente."""
        assert resultado_de_entrega({"enviados": 1, "fallidos": 1})[0] is True


class TestReclamar:

    def test_el_token_es_POR_PERSONA_no_por_unidad(self):
        """El push sale UNO por persona aunque le falten tres partidos, así que
        el cierre tiene que poder marcar sus tres filas juntas."""
        base = _Tabla(filas=[])
        reclamar_entregas(base, [_entrega(ANA, LIGA_A, 1), _entrega(ANA, LIGA_A, 2),
                                 _entrega(BETO, LIGA_A, 1)])
        tokens = {f["user_id"]: f["claim_token"] for f in base.pedido["args"]["p_entregas"]}
        enviados = base.pedido["args"]["p_entregas"]
        assert tokens[ANA] == [f for f in enviados if f["user_id"] == ANA][0]["claim_token"]
        assert len({f["claim_token"] for f in enviados if f["user_id"] == ANA}) == 1
        assert tokens[ANA] != tokens[BETO]

    def test_SOLO_se_envia_lo_que_la_base_devolvio(self):
        """La barrera es el RETURNING: si la RPC no devolvió una fila, es que
        otra corrida se la llevó y mandarla igual sería el duplicado."""
        base = _Tabla(filas=[{"claimed_user_id": ANA, "claimed_league_id": LIGA_A,
                              "claimed_match_id": 1, "claimed_token": "t"}])
        reclamadas, tokens = reclamar_entregas(
            base, [_entrega(ANA, LIGA_A, 1), _entrega(BETO, LIGA_A, 1)])
        assert [clave_entrega(e) for e in reclamadas] == [(ANA, LIGA_A, 1)]
        assert set(tokens) == {ANA}

    def test_sin_nada_que_reclamar_no_se_llama_a_la_base(self):
        base = _Tabla()
        assert reclamar_entregas(base, []) == ([], {})
        assert base.pedido == {}

    def test_va_con_el_tipo_de_aviso(self):
        base = _Tabla(filas=[])
        reclamar_entregas(base, [_entrega(ANA, LIGA_A, 1)])
        assert base.pedido["rpc"] == "claim_notification_deliveries"
        assert base.pedido["args"]["p_tipo"] == TIPO_RECORDATORIO_SAQUE

    def test_si_falta_la_migracion_se_dice_con_su_excepcion(self):
        """Para que el endpoint pueda caer al comportamiento anterior en vez de
        dejar al grupo sin avisos."""
        base = _Tabla(revienta=Exception("Could not find the function public.claim_..."))
        with pytest.raises(DeduplicacionNoDisponible):
            reclamar_entregas(base, [_entrega(ANA, LIGA_A, 1)])

    def test_un_fallo_CUALQUIERA_no_se_disfraza_de_migracion_ausente(self):
        base = _Tabla(revienta=RuntimeError("connection reset"))
        with pytest.raises(RuntimeError):
            reclamar_entregas(base, [_entrega(ANA, LIGA_A, 1)])


class TestReintentos:

    def test_pide_los_fallidos_y_los_reclamos_abandonados(self):
        base = _Tabla(filas=[])
        reintentos_pendientes(base, AHORA)
        vencido = (AHORA - timedelta(minutes=MINUTOS_PARA_RECLAMO_VENCIDO)).isoformat()
        assert base.pedido["eq"] == {"tipo": TIPO_RECORDATORIO_SAQUE}
        assert base.pedido["or"] == f"status.eq.failed,and(status.eq.claimed,claimed_at.lt.{vencido})"

    def test_devuelve_las_claves_tal_cual_las_usa_el_resto(self):
        base = _Tabla(filas=[{"user_id": ANA, "league_id": LIGA_A, "match_id": 7,
                              "status": "failed", "claimed_at": None}])
        assert reintentos_pendientes(base, AHORA) == {(ANA, LIGA_A, 7)}

    def test_sin_la_tabla_se_dice_con_su_excepcion(self):
        base = _Tabla(revienta=Exception('relation "public.notification_deliveries" does not exist'))
        with pytest.raises(DeduplicacionNoDisponible):
            reintentos_pendientes(base, AHORA)


class TestQueSeSelecciona:
    """Un reintento puntual NO puede convertirse en un aviso nuevo para todos."""

    def test_entra_lo_fresco(self):
        entregas = [_entrega(ANA, LIGA_A, 1), _entrega(BETO, LIGA_A, 2)]
        assert len(seleccionar_candidatas(entregas, {1, 2}, set())) == 2

    def test_entra_un_reintento_aunque_su_partido_ya_no_este_en_la_ventana(self):
        entregas = [_entrega(ANA, LIGA_A, 9)]
        assert len(seleccionar_candidatas(entregas, set(), {(ANA, LIGA_A, 9)})) == 1

    def test_NO_entra_otra_persona_del_mismo_partido_del_reintento(self):
        """El reintento es de Ana. Beto no perdió ningún aviso: mandárselo
        sería inventarle uno."""
        entregas = [_entrega(ANA, LIGA_A, 9), _entrega(BETO, LIGA_A, 9)]
        elegidas = seleccionar_candidatas(entregas, set(), {(ANA, LIGA_A, 9)})
        assert [clave_entrega(e) for e in elegidas] == [(ANA, LIGA_A, 9)]

    def test_sin_nada_fresco_ni_pendiente_no_se_manda_nada(self):
        assert seleccionar_candidatas([_entrega(ANA, LIGA_A, 1)], set(), set()) == []


class TestDesgloseDelRecordatorio:
    """Partir el mensaje en unidades no puede cambiar ni un texto."""

    PARTIDOS = [
        {"id": 1, "tournament_id": 2, "home_team": "Saprissa", "away_team": "Herediano",
         "kickoff_at": "2026-09-21T13:00:00Z"},
        {"id": 2, "tournament_id": 2, "home_team": "Alajuelense", "away_team": "Cartaginés",
         "kickoff_at": "2026-09-21T14:00:00Z"},
    ]
    MIEMBROS = [{"user_id": ANA, "league_id": LIGA_A, "tournament_id": 2}]

    def test_una_unidad_por_persona_quiniela_y_partido(self):
        entregas = entregas_recordatorio(self.PARTIDOS, self.MIEMBROS, [])
        assert [clave_entrega(e) for e in entregas] == [(ANA, LIGA_A, 1), (ANA, LIGA_A, 2)]

    def test_quien_ya_predijo_no_genera_unidad(self):
        entregas = entregas_recordatorio(
            self.PARTIDOS, self.MIEMBROS,
            [{"user_id": ANA, "league_id": LIGA_A, "match_id": 1}])
        assert [clave_entrega(e) for e in entregas] == [(ANA, LIGA_A, 2)]

    def test_la_misma_persona_en_DOS_quinielas_del_mismo_torneo_debe_las_dos(self):
        """Predijo en una sola: en la otra el partido sigue pendiente de verdad."""
        miembros = [{"user_id": ANA, "league_id": LIGA_A, "tournament_id": 2},
                    {"user_id": ANA, "league_id": LIGA_B, "tournament_id": 2}]
        entregas = entregas_recordatorio(
            self.PARTIDOS[:1], miembros,
            [{"user_id": ANA, "league_id": LIGA_A, "match_id": 1}])
        assert [clave_entrega(e) for e in entregas] == [(ANA, LIGA_B, 1)]

    def test_el_texto_es_EXACTAMENTE_el_de_siempre(self):
        viejo = armar_recordatorios(self.PARTIDOS, self.MIEMBROS, [])
        nuevo = mensajes_de_recordatorio(entregas_recordatorio(self.PARTIDOS, self.MIEMBROS, []))
        assert nuevo == viejo

    def test_el_conteo_sale_de_lo_RECLAMADO_no_de_lo_seleccionado(self):
        """Si otra corrida se llevó un partido, no puede seguir contándose en
        el «te faltan N por predecir»: la persona recibiría un número que no
        corresponde con lo que ve."""
        entregas = entregas_recordatorio(self.PARTIDOS, self.MIEMBROS, [])
        solo_una = mensajes_de_recordatorio(entregas[:1])
        assert "Te faltan 2" in mensajes_de_recordatorio(entregas)[ANA]["body"]
        assert "No has predicho" in solo_una[ANA]["body"]

    def test_sin_unidades_no_hay_mensajes(self):
        assert mensajes_de_recordatorio([]) == {}


# ---------------------------------------------------------------------------
# La puerta del cron (migración 88) tiene que pensar lo mismo que el backend.
# `hay_avisos_por_reintentar` repite en SQL el tipo de aviso y el vencimiento
# del reclamo; si se separan de las constantes de Python, la puerta se abre
# por avisos que el backend no reintenta, o —peor— no se abre por los que sí.
# Misma técnica que test_sync_por_meses con la migración 81: leer el SQL.
# ---------------------------------------------------------------------------
def _puerta_sql():
    import re
    sql = (Path(__file__).resolve().parents[2] / "database"
           / "88_pagos_puntaje_y_reintentos_que_si_se_ven.sql").read_text()
    i = sql.index("CREATE OR REPLACE FUNCTION public.hay_avisos_por_reintentar()")
    return sql[i:sql.index("$function$;", i)], re


def test_la_puerta_del_cron_usa_el_mismo_tipo_de_aviso():
    from app.services.notification_deliveries import TIPO_RECORDATORIO_SAQUE
    cuerpo, _ = _puerta_sql()
    assert f"nd.tipo = '{TIPO_RECORDATORIO_SAQUE}'" in cuerpo


def test_la_puerta_del_cron_usa_el_mismo_vencimiento_de_reclamo():
    from app.services.notification_deliveries import MINUTOS_PARA_RECLAMO_VENCIDO
    cuerpo, _ = _puerta_sql()
    assert f"now() - interval '{MINUTOS_PARA_RECLAMO_VENCIDO} minutes'" in cuerpo


def test_la_puerta_del_cron_se_cierra_con_las_predicciones():
    """Un aviso que llega con las predicciones cerradas no sirve de nada: el
    backend exige 15 minutos, la puerta también."""
    cuerpo, _ = _puerta_sql()
    assert "m.kickoff_at - interval '15 minutes' > now()" in cuerpo
