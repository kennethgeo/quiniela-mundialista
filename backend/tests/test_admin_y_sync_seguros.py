"""Aislamiento de torneos, lecturas completas y ediciones sin pisar correcciones.

Base en memoria que aplica los filtros y proyecta las columnas pedidas: no
devuelve filas o columnas que el servidor real habría descartado.
"""
import asyncio
import copy
import socket
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import auth
from app.main import app
from app.models import MatchStatusUpdate
import app.routes.admin as admin
import app.routes.matches as routes
import app.services.live_sync as live
import app.services.bracket_resolver as bracket


class Query:
    def __init__(self, db, table):
        self.db, self.table = db, table
        self.filters, self.fields, self.payload, self.maximum = [], '*', None, None

    def select(self, fields):
        self.fields = fields
        return self

    def update(self, payload):
        self.payload = payload
        return self

    def limit(self, n):
        self.maximum = n
        return self

    def eq(self, key, value):
        self.filters.append(('eq', key, value))
        return self

    def is_(self, key, value):
        self.filters.append(('eq', key, None if value == 'null' else value))
        return self

    def gt(self, key, value):
        self.filters.append(('gt', key, value))
        return self

    def execute(self):
        self.db.reads.append((self.table, self.fields, self.filters.copy(), self.payload is not None))
        if self.payload is None and self.table == 'matches' and self.db.fail_read:
            raise RuntimeError('lectura transitoria fallida')
        if self.payload is not None and self.db.before_write:
            callback, self.db.before_write = self.db.before_write, None
            callback(self.db)
        rows = self.db.tables.get(self.table, [])
        for op, key, value in self.filters:
            rows = [r for r in rows if (r.get(key) == value if op == 'eq' else r.get(key, '') > value)]
        if self.maximum is not None:
            rows = rows[:self.maximum]
        if self.payload is not None:
            self.db.writes.append((self.table, copy.deepcopy(self.payload), self.filters.copy()))
            for row in rows:
                row.update(self.payload)
            return SimpleNamespace(data=copy.deepcopy(rows))
        if self.fields != '*':
            columns = [k.strip() for k in self.fields.split(',')]
            rows = [{k: r.get(k) for k in columns} for r in rows]
        return SimpleNamespace(data=copy.deepcopy(rows))


class DB:
    def __init__(self, matches=(), predictions=()):
        self.tables = {'matches': copy.deepcopy(list(matches)), 'predictions': list(predictions),
                       'users': [{'id': 'persona', 'is_admin': True}]}
        self.reads, self.writes, self.rpcs = [], [], []
        self.fail_read, self.before_write = False, None

    def table(self, table):
        return Query(self, table)

    def rpc(self, name, args):
        self.rpcs.append((name, args))
        if name == 'actualizar_equipos_cruce':
            return SimpleNamespace(execute=lambda: self._equipos_atomicos(args['p_cambio']))
        return SimpleNamespace(execute=lambda: SimpleNamespace(data=[]))

    def _equipos_atomicos(self, change):
        # Doble del contrato de la RPC, no prueba de su implementación SQL.
        class ErrorRPC(RuntimeError):
            def __init__(self, code):
                self.code = code
        if getattr(self, 'rpc_missing', False):
            raise ErrorRPC('PGRST202')
        if self.before_write:
            callback, self.before_write = self.before_write, None
            callback(self)
        row = next((r for r in self.tables['matches'] if r['id'] == change['match_id'] and r['tournament_id'] == change['tournament_id']), None)
        if row is None:
            raise ErrorRPC('P0002')
        fields = ('home_team', 'away_team', 'home_team_code', 'away_team_code')
        if any(row.get(k) != change['expected'][k] for k in fields) or any(p['match_id'] == row['id'] for p in self.tables['predictions']):
            raise ErrorRPC('P0001')
        changes = {k: change[k] for k in fields}
        self.writes.append(('matches', changes, []))
        row.update(changes)
        if getattr(self, 'rpc_reply_lost', False):
            raise RuntimeError('Respuesta perdida después de confirmar la transacción')
        return SimpleNamespace(data=copy.deepcopy(row))


def match(**extra):
    return {'id': 1, 'tournament_id': 1, 'phase': 'quarter_finals', 'group_name': None, 'stage': None,
            'home_team': 'Local', 'away_team': 'Visita', 'home_team_code': 'lo', 'away_team_code': 'vi',
            'kickoff_at': (datetime.now(timezone.utc) + timedelta(hours=3)).isoformat(),
            'status': 'pending', 'score_locked': False, 'destapado_at': None, 'events_json': [],
            'home_goals_actual': None, 'away_goals_actual': None,
            'goes_to_penalties': False, 'penalties_winner_real': None, **extra}


def game(**extra):
    return {'home': 'Local', 'away': 'Visita', 'status': 'finished', 'home_score': 2,
            'away_score': 1, 'minute': None, 'events': [], **extra}


@pytest.fixture(autouse=True)
def sin_red(monkeypatch):
    def no_conectar(*_args, **_kwargs):
        raise AssertionError('Estas pruebas no pueden conectarse a la red')
    monkeypatch.setattr(socket, 'create_connection', no_conectar)


@pytest.fixture
def sync(monkeypatch):
    provider = AsyncMock(return_value=([game()], 'falso'))
    score = AsyncMock()
    monkeypatch.setattr(live, '_get_games', provider)
    monkeypatch.setattr(live, 'calculate_and_update_scores', score)
    monkeypatch.setattr(live, 'persist_resolved_knockouts', lambda *_: 0)
    return provider, score


def test_no_se_pide_fuente_fuera_del_mundial(sync):
    provider, score = sync
    db = DB([match(tournament_id=7)])
    result = asyncio.run(live.sync_live_scores(db))
    assert result['updated'] == 0
    provider.assert_not_awaited()
    score.assert_not_awaited()
    assert not db.writes


def test_una_lectura_fallida_no_tiene_respaldo_con_menos_columnas(sync):
    provider, _ = sync
    db = DB([match()]); db.fail_read = True
    with pytest.raises(RuntimeError):
        asyncio.run(live.sync_live_scores(db))
    assert len(db.reads) == 1
    assert all(col in db.reads[0][1] for col in ('score_locked', 'goes_to_penalties', 'penalties_winner_real'))
    assert not db.writes
    provider.assert_not_awaited()


def test_fuera_de_fecha_no_hay_peticiones_a_proveedores(sync):
    provider, _ = sync
    db = DB([match(kickoff_at='2026-06-01T12:00:00Z')])
    asyncio.run(live.sync_live_scores(db))
    provider.assert_not_awaited()


def test_no_toca_otro_torneo_con_los_mismos_nombres(sync):
    _, score = sync
    db = DB([match(), match(id=2, tournament_id=7)])
    asyncio.run(live.sync_live_scores(db))
    assert db.tables['matches'][0]['home_goals_actual'] == 2
    assert db.tables['matches'][1]['home_goals_actual'] is None
    score.assert_awaited_once_with(db, 1)
    assert ('eq', 'tournament_id', 1) in db.writes[0][2]


@pytest.mark.parametrize('change', [{'score_locked': True}, {'home_goals_actual': 9}, {'home_team': 'Corrección'}])
def test_no_pisa_la_correccion_del_admin_mientras_espera_la_fuente(sync, change):
    _, score = sync
    db = DB([match()])
    db.before_write = lambda d: d.tables['matches'][0].update(change)
    result = asyncio.run(live.sync_live_scores(db))
    assert result['updated'] == 0
    assert all(db.tables['matches'][0][k] == v for k, v in change.items())
    score.assert_not_awaited()


def test_no_borra_un_marcador_valido_por_un_resultado_incompleto(sync):
    provider, score = sync
    provider.return_value = ([game(home_score=None)], 'falso')
    db = DB([match(home_goals_actual=2, away_goals_actual=1)])
    result = asyncio.run(live.sync_live_scores(db))
    assert result['errors']
    assert not db.writes
    score.assert_not_awaited()


def test_un_aplazamiento_no_fijado_puede_reanudarse(sync):
    provider, _ = sync
    provider.return_value = ([game(status='in_progress', home_score=0, away_score=0)], 'falso')
    db = DB([match(status='postponed')])
    asyncio.run(live.sync_live_scores(db))
    assert db.tables['matches'][0]['status'] == 'in_progress'


def test_un_respaldo_sin_fecha_no_adivina_entre_dos_partidos_del_mismo_par(sync):
    _, score = sync
    db = DB([match(), match(id=2, kickoff_at='2026-06-01T12:00:00Z')])
    result = asyncio.run(live.sync_live_scores(db))
    assert result['unmatched']
    assert not db.writes
    score.assert_not_awaited()


def test_la_fecha_de_la_fuente_desambigua_el_par_repetido(sync):
    provider, _ = sync
    actual = match()
    provider.return_value = ([game(kickoff_at=actual['kickoff_at'])], 'falso')
    db = DB([actual, match(id=2, kickoff_at='2026-06-01T12:00:00Z')])
    asyncio.run(live.sync_live_scores(db))
    assert db.tables['matches'][0]['home_goals_actual'] == 2
    assert db.tables['matches'][1]['home_goals_actual'] is None


def test_resolvedor_no_toca_otro_torneo_ni_un_cruce_fijado(monkeypatch):
    db = DB([match(home_team='W74'), match(id=2, tournament_id=7, home_team='W74'),
             match(id=3, home_team='W74', score_locked=True)])
    monkeypatch.setattr(bracket, 'resolve_knockout', lambda _: {1: {'home_team': 'Resuelto'}, 2: {'home_team': 'Resuelto'}, 3: {'home_team': 'Resuelto'}})
    assert bracket.persist_resolved_knockouts(db) == 1
    assert [r['home_team'] for r in db.tables['matches']] == ['Resuelto', 'W74', 'W74']


@pytest.fixture
def client(monkeypatch):
    db = DB([match(tournament_id=7)])
    monkeypatch.setattr(admin, 'get_supabase', lambda: db)
    monkeypatch.setattr(auth, 'get_supabase', lambda: db)
    # Query.single es solo del chequeo de is_admin, no una consulta a Supabase.
    monkeypatch.setattr(Query, 'single', lambda self: self, raising=False)
    old_execute = Query.execute
    def execute(self):
        result = old_execute(self)
        if self.table == 'users':
            result.data = result.data[0] if result.data else None
        return result
    monkeypatch.setattr(Query, 'execute', execute)
    app.dependency_overrides[auth.get_current_user] = lambda: {'sub': 'persona'}
    try:
        with TestClient(app) as http:
            yield http, db
    finally:
        app.dependency_overrides.clear()


def payload():
    m = match()
    return {'match_id': 1, 'tournament_id': 7, 'home_team': 'Nuevo local', 'away_team': 'Nuevo visitante',
            'home_team_code': 'nl', 'away_team_code': 'nv',
            'expected': {k: m[k] for k in ('home_team', 'away_team', 'home_team_code', 'away_team_code')}}


def test_guarda_solo_equipos_y_exige_coincidir_con_la_version_vista(client):
    http, db = client
    assert http.post('/api/admin/update-match-teams', json=payload()).status_code == 200
    assert set(db.writes[0][1]) == {'home_team', 'away_team', 'home_team_code', 'away_team_code'}
    assert db.tables['matches'][0]['status'] == 'pending'
    assert http.post('/api/admin/update-match-teams', json=payload()).status_code == 409


@pytest.mark.parametrize('code', [None, '', '   '])
def test_codigo_vacio_no_llega_a_la_rpc(client, code):
    http, db = client
    assert http.post('/api/admin/update-match-teams', json={**payload(), 'home_team_code': code}).status_code == 422
    assert not db.writes


@pytest.mark.parametrize('changes', [{'status': 'finished'}, {'score_locked': True}, {'destapado_at': '2026-06-01'}, {'kickoff_at': None}, {'phase': 'groups'}])
def test_rechaza_cruces_que_no_se_pueden_renombrar(client, changes):
    http, db = client
    db.tables['matches'][0].update(changes)
    assert http.post('/api/admin/update-match-teams', json=payload()).status_code == 409
    assert not db.writes


def test_rechaza_predicciones_existentes_otro_torneo_y_campos_extra(client):
    http, db = client
    assert http.post('/api/admin/update-match-teams', json={**payload(), 'tournament_id': 8}).status_code == 404
    assert http.post('/api/admin/update-match-teams', json={**payload(), 'status': 'finished'}).status_code == 422
    db.tables['predictions'] = [{'id': 1, 'match_id': 1}]
    assert http.post('/api/admin/update-match-teams', json=payload()).status_code == 409
    assert not db.writes


@pytest.mark.parametrize('path', ['/api/matches/verify-scores?tournament_id=7', '/api/matches/external-games'])
def test_herramientas_de_fuentes_requieren_admin_antes_de_consultar(client, monkeypatch, path):
    http, db = client
    db.tables['users'][0]['is_admin'] = False
    assert http.get(path).status_code == 403
    app.dependency_overrides.clear()
    assert http.get(path).status_code in (401, 403)


def test_un_no_admin_no_puede_guardar_equipos(client):
    http, db = client
    db.tables['users'][0]['is_admin'] = False
    assert http.post('/api/admin/update-match-teams', json=payload()).status_code == 403
    assert not db.writes


def test_cambio_concurrente_de_un_cruce_no_se_sobrescribe(client):
    http, db = client
    db.before_write = lambda d: d.tables['matches'][0].update(home_team='Cambio de otro admin')
    assert http.post('/api/admin/update-match-teams', json=payload()).status_code == 409
    assert db.tables['matches'][0]['home_team'] == 'Cambio de otro admin'


def test_si_falta_la_rpc_no_hay_update_de_respaldo(client):
    http, db = client
    db.rpc_missing = True
    assert http.post('/api/admin/update-match-teams', json=payload()).status_code == 503
    assert not db.writes


def test_el_backend_respeta_el_rechazo_atomico_de_una_prediccion_que_llego_despues(client):
    http, db = client
    db.before_write = lambda d: d.tables['predictions'].append({'id': 9, 'match_id': 1})
    assert http.post('/api/admin/update-match-teams', json=payload()).status_code == 409
    assert not db.writes
    assert db.tables['matches'][0]['home_team'] == 'Local'


def test_una_respuesta_perdida_no_promete_que_el_guardado_no_ocurrio(client):
    http, db = client
    db.rpc_reply_lost = True
    response = http.post('/api/admin/update-match-teams', json=payload())
    assert response.status_code == 503
    assert 'No se pudo confirmar' in response.json()['detail']
    assert db.tables['matches'][0]['home_team'] == 'Nuevo local'


def test_el_push_final_identifica_equipos_y_marcador_sin_cambiar_el_puntaje(monkeypatch):
    import app.services.scoring as scoring
    from test_reintento_de_puntaje import FalsaBase, _partido, _prediccion

    db = FalsaBase([_partido()], [_prediccion(1, 2, 1)])
    enviar = AsyncMock()
    monkeypatch.setattr(scoring, 'broadcast_push_to_users', enviar)
    asyncio.run(scoring.calculate_and_update_scores(db, 7))
    mensaje = enviar.await_args.kwargs
    assert mensaje['title'] == 'Final · Saprissa 2 - 1 Alajuelense'
    assert mensaje['url'] == '/match/7'
    assert db.tablas['predictions'][0]['points_earned'] == 3


@pytest.mark.parametrize('status,locked', [('cancelled', True), ('postponed', False)])
def test_anular_fija_y_aplazar_deja_reanudar(monkeypatch, status, locked):
    db = DB([match()])
    monkeypatch.setattr(admin, 'get_supabase', lambda: db)
    monkeypatch.setattr(admin, 'calculate_and_update_scores', AsyncMock())
    asyncio.run(admin.set_match_status(MatchStatusUpdate(match_id=1, status=status), {}))
    assert db.tables['matches'][0]['score_locked'] is locked
