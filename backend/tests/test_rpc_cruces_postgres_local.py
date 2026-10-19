"""Ensayo optativo de la propuesta SQL, con dos conexiones PostgreSQL reales.

Solo opera en el clúster desechable creado para este ensayo, en localhost:55483.
No utiliza URL, contraseña ni configuración de Supabase. El esquema es sintético;
no sustituye comprobar todas las migraciones y triggers del proyecto desplegado.
"""
import json
import os
import re
import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
PSQL = Path(r'C:\Program Files\PostgreSQL\17\bin\psql.exe')
CLUSTER = ROOT / 'frontend/node_modules/.cache/postgres-auditoria-20261016'
DB = 'quiniela_auditoria_rpc'
pytestmark = pytest.mark.skipif(os.environ.get('QUINIELA_PG_ENSAYO') != '1', reason='Ensayo PostgreSQL local optativo')


def command(database=DB):
    return [str(PSQL), '-X', '-qAt', '-h', '127.0.0.1', '-p', '55483', '-U', 'auditoria',
            '-d', database, '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose']


def sql(statement, database=DB, ok=True):
    env = {**os.environ, 'PGCONNECT_TIMEOUT': '3', 'PGCLIENTENCODING': 'UTF8', 'PGSSLMODE': 'disable'}
    proc = subprocess.run(command(database), input="SET statement_timeout='3s';\n" + statement,
                          capture_output=True, text=True, encoding='utf-8', timeout=8, env=env)
    if ok:
        assert proc.returncode == 0, proc.stderr
    return proc


def call(extra=None, expected=None):
    payload = {'match_id': 1, 'tournament_id': 1, 'home_team': 'Costa Rica', 'away_team': 'Japón',
               'home_team_code': 'cr', 'away_team_code': 'jp',
               'expected': expected or {'home_team': '1A', 'away_team': '2B', 'home_team_code': 'xx', 'away_team_code': 'xx'}}
    payload.update(extra or {})
    literal = json.dumps(payload, ensure_ascii=False).replace("'", "''")
    return f"SELECT public.actualizar_equipos_cruce('{literal}'::jsonb);"


@pytest.fixture(scope='module', autouse=True)
def esquema():
    actual = sql('SHOW data_directory;', database='postgres').stdout.strip()
    assert Path(actual).resolve() == CLUSTER.resolve(), 'Se rechaza una instancia distinta del clúster sintético.'
    exists = sql(f"SELECT 1 FROM pg_database WHERE datname='{DB}';", database='postgres').stdout.strip()
    if not exists:
        sql(f'CREATE DATABASE {DB};', database='postgres')
    # Solo después de verificar instancia y nombre reservado para este ensayo.
    setup = """
      DROP TABLE IF EXISTS public.predictions, public.matches CASCADE;
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
      END $$;
      CREATE TABLE public.matches (
        id integer PRIMARY KEY, tournament_id integer NOT NULL,
        home_team text NOT NULL, away_team text NOT NULL,
        home_team_code text NOT NULL DEFAULT 'xx', away_team_code text NOT NULL DEFAULT 'xx',
        kickoff_at timestamptz NOT NULL, phase text NOT NULL, status text NOT NULL,
        score_locked boolean NOT NULL DEFAULT false, destapado_at timestamptz,
        home_goals_actual integer, away_goals_actual integer, marcador_testigo text DEFAULT 'conservar'
      );
      CREATE TABLE public.predictions (
        id integer PRIMARY KEY, match_id integer NOT NULL REFERENCES public.matches(id),
        points_earned integer DEFAULT 0, home_goals_pred integer DEFAULT 0
      );
      GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
      GRANT ALL ON public.matches, public.predictions TO service_role;
    """
    sql(setup)
    backend = (ROOT / 'database/61_endurecer_permisos.sql').read_text(encoding='utf-8')
    function = re.search(r'CREATE OR REPLACE FUNCTION public.es_backend\(\).*?\$\$;', backend, re.S).group()
    sql(function)
    destape = (ROOT / 'database/106_destape_irreversible_y_anonimato_que_se_sostiene.sql').read_text(encoding='utf-8')
    function = re.search(r'CREATE OR REPLACE FUNCTION public.marcar_destape\(\).*?\$\$;', destape, re.S).group()
    sql(function + '\nCREATE TRIGGER marcar_destape BEFORE UPDATE ON public.matches FOR EACH ROW EXECUTE FUNCTION public.marcar_destape();')
    proposal = (ROOT / 'docs/sql/actualizar_equipos_cruce.propuesta.sql').read_text(encoding='utf-8')
    sql(proposal)
    sql(proposal)  # Reaplicar la definición no altera datos ni falla.


@pytest.fixture(autouse=True)
def datos(esquema):
    sql("""TRUNCATE public.predictions, public.matches;
      INSERT INTO public.matches(id,tournament_id,home_team,away_team,kickoff_at,phase,status)
      VALUES (1,1,'1A','2B',now()+interval '2 days','quarter_finals','pending'),
             (2,7,'Saprissa','Herediano',now()+interval '2 days','semi_finals','pending');
      INSERT INTO public.predictions(id,match_id,points_earned) VALUES (77,2,6);"""
    )


def snapshot():
    return sql("SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM matches m; SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM predictions p;").stdout


def test_cambia_solo_cuatro_campos_y_conserva_otro_torneo_y_puntos():
    before = [json.loads(row) for row in snapshot().splitlines()]
    result = json.loads(sql("SET ROLE service_role; SET request.jwt.claims='{\"role\":\"service_role\"}';" + call()).stdout)
    assert result['home_team'] == 'Costa Rica'
    after = [json.loads(row) for row in snapshot().splitlines()]
    assert after[1] == before[1]
    assert after[0][1] == before[0][1]
    changed = {key for key in before[0][0] if before[0][0][key] != after[0][0][key]}
    assert changed == {'home_team', 'away_team', 'home_team_code', 'away_team_code'}


@pytest.mark.parametrize('cambio', ["status='finished'", "status='in_progress'", "phase='groups'", "score_locked=true",
    "destapado_at=now()", "kickoff_at=now()+interval '10 minutes'"])
def test_rechaza_cerrados_sin_cambiar_datos(cambio):
    sql(f'UPDATE matches SET {cambio} WHERE id=1;')
    before = snapshot()
    result = sql(call(), ok=False)
    assert result.returncode != 0 and 'P0001' in result.stderr
    assert snapshot() == before


def test_prediccion_existente_impide_cambio_y_conserva_puntos():
    sql('INSERT INTO predictions(id,match_id,points_earned) VALUES(88,1,9);')
    before = snapshot()
    assert 'P0001' in sql(call(), ok=False).stderr
    assert snapshot() == before


@pytest.mark.parametrize('extra,code', [({'tournament_id': 7}, 'P0002'), ({'match_id': 99}, 'P0002'),
    ({'home_team': 'Japón'}, 'P0001'), ({'home_team': ''}, 'P0001'),
    ({'home_team_code': None}, 'P0001'), ({'away_team_code': None}, 'P0001'),
    ({'home_team_code': ''}, 'P0001'), ({'away_team_code': '   '}, 'P0001')])
def test_rechaza_identidad_invalida(extra, code):
    before = snapshot()
    assert code in sql(call(extra), ok=False).stderr
    assert snapshot() == before


def test_version_anterior_no_sobrescribe_cambio_de_otro_admin():
    sql(call())
    before = snapshot()
    assert 'P0001' in sql(call({'home_team': 'Otro equipo'}), ok=False).stderr
    assert snapshot() == before


@pytest.mark.parametrize('role', ['anon', 'authenticated'])
def test_clientes_no_pueden_ejecutar_la_funcion(role):
    before = snapshot()
    result = sql(f"SET ROLE {role}; SET request.jwt.claims='{{\"role\":\"{role}\"}}';" + call(), ok=False)
    assert '42501' in result.stderr
    assert snapshot() == before


def test_guarda_backend_tambien_rechaza_claim_authenticated():
    assert '42501' in sql("SET request.jwt.claims='{\"role\":\"authenticated\"}';" + call(), ok=False).stderr


def holding(statement):
    proc = subprocess.Popen(command(), stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            text=True, encoding='utf-8', env={**os.environ, 'PGCLIENTENCODING': 'UTF8', 'PGCONNECT_TIMEOUT': '3'})
    proc.stdin.write("BEGIN; SET statement_timeout='4s';\n" + statement + "\nSELECT 'LISTO';\n")
    proc.stdin.flush()
    # Marcador del servidor: no depender de dormir esperando a que tome el candado.
    with ThreadPoolExecutor(max_workers=1) as pool:
        pending = pool.submit(lambda: next(line for line in proc.stdout if line.strip() == 'LISTO'))
        try:
            pending.result(timeout=6)
        except Exception:
            proc.kill()
            raise
    return proc


def release(proc):
    proc.stdin.write('ROLLBACK;\n\\q\n'); proc.stdin.flush()
    proc.communicate(timeout=5)


def test_insert_en_curso_rechaza_la_rpc_sin_esperar_ni_escribir():
    proc = holding('INSERT INTO predictions(id,match_id) VALUES(88,1);')
    try:
        before = snapshot()
        assert '55P03' in sql(call(), ok=False).stderr
        assert snapshot() == before
    finally:
        release(proc)


def test_rpc_impide_insert_hasta_terminar_su_transaccion():
    proc = holding(call())
    try:
        result = sql("SET lock_timeout='100ms'; INSERT INTO predictions(id,match_id) VALUES(88,1);", ok=False)
        assert '55P03' in result.stderr
        assert sql('SELECT count(*) FROM predictions WHERE match_id=1;').stdout.strip() == '0'
    finally:
        release(proc)
    assert sql('SELECT home_team FROM matches WHERE id=1;').stdout.strip() == '1A'


def test_fila_bloqueada_por_resultados_no_produce_deadlock():
    proc = holding('SELECT id FROM matches WHERE id=1 FOR UPDATE;')
    try:
        before = snapshot()
        assert '55P03' in sql(call(), ok=False).stderr
        assert snapshot() == before
    finally:
        release(proc)
