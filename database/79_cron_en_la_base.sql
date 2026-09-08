-- =============================================================================
-- 79_cron_en_la_base.sql
-- Que el sync de marcadores y el recordatorio del saque los dispare LA BASE,
-- no GitHub Actions. Solo funciones y agenda: no toca ninguna fila de datos.
-- Idempotente.
-- =============================================================================
--
-- POR QUÉ, MEDIDO. `sync-live-scores.yml` dice `*/5` y en las últimas 100
-- corridas el hueco mediano real fue de HORAS: 100 corridas en 327 h, o sea
-- 2.5% de la cobertura esperada, y ya venía así desde el 26 de agosto. El
-- recordatorio de 45 min está igual (~8%). El síntoma que lo destapó: un
-- partido en curso mostraba «PROGRAMADO» porque ESPN ya lo tenía en vivo y
-- nosotros no lo habíamos escrito.
--
-- GitHub Actions no garantiza cadencia en `schedule`, y no hay nada que
-- podamos arreglar de nuestro lado. El disparador tiene que vivir donde sí
-- controlamos: la base.
--
-- SOLO DISPARA SI HAY ALGO QUE HACER, y "algo" incluye que el torneo TENGA
-- QUINIELA. Un torneo que nadie juega no necesita marcador en vivo: es el
-- mismo criterio que ya usa `sync_all_espn_tournaments` para saltarse los
-- torneos sin quiniela. Sin este filtro estaríamos llamando a ESPN 1.440 veces
-- al día por torneos que no le importan a nadie.
--
-- EL SECRETO NO VA EN UNA TABLA. Va en Vault, cifrado. Una tabla plana la lee
-- cualquiera con acceso a la base, y este secreto abre endpoints que escriben.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- ── 1. ¿Hay partidos que justifiquen llamar? ──────────────────────────────
-- Un partido cuenta si su torneo no terminó Y tiene al menos una quiniela.
-- La ventana la elige quien pregunta: el sync en vivo mira el presente, el
-- recordatorio mira los que están por empezar.
CREATE OR REPLACE FUNCTION public.hay_partidos_en_ventana(
  p_desde interval, p_hasta interval)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.matches m
    JOIN public.tournaments t ON t.id = m.tournament_id
    WHERE t.status <> 'finished'
      AND m.status NOT IN ('finished', 'cancelled', 'postponed')
      AND m.kickoff_at BETWEEN now() + p_desde AND now() + p_hasta
      -- La quiniela es la razón de ser: sin ninguna, el torneo no se mira.
      AND EXISTS (SELECT 1 FROM public.leagues l WHERE l.tournament_id = t.id)
  );
$$;

COMMENT ON FUNCTION public.hay_partidos_en_ventana(interval, interval) IS
  'Interna, para el cron. Cierto si hay partido por jugar en esa ventana, en un '
  'torneo no terminado y CON al menos una quiniela.';

-- ── 2. Llamar al backend ──────────────────────────────────────────────────
-- El secreto sale de Vault. Si no está cargado, la función no llama y lo dice
-- en el log: es preferible a mandar una petición sin credencial que el backend
-- va a rechazar con 401 cada minuto.
CREATE OR REPLACE FUNCTION public.llamar_backend(p_ruta text)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public, extensions
AS $$
DECLARE v_base text; v_secreto text; v_id bigint;
BEGIN
  SELECT decrypted_secret INTO v_base
  FROM vault.decrypted_secrets WHERE name = 'backend_base_url';
  SELECT decrypted_secret INTO v_secreto
  FROM vault.decrypted_secrets WHERE name = 'cron_secret';

  IF v_base IS NULL OR v_secreto IS NULL THEN
    RAISE WARNING 'Falta backend_base_url o cron_secret en Vault: no se llama a %', p_ruta;
    RETURN NULL;
  END IF;

  SELECT net.http_post(
    url := v_base || p_ruta,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secreto),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  ) INTO v_id;
  RETURN v_id;
END;
$$;

-- ── 3. Los dos disparadores ───────────────────────────────────────────────
-- Marcadores: mira lo que está pasando AHORA. La ventana arranca 4 horas atrás
-- (un partido en curso empezó antes) y llega a 15 minutos adelante, para tener
-- el fixture fresco justo antes del saque.
CREATE OR REPLACE FUNCTION public.cron_sync_en_vivo()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public
AS $$
BEGIN
  IF public.hay_partidos_en_ventana('-4 hours', '15 minutes') THEN
    PERFORM public.llamar_backend('/api/matches/sync-live');
  END IF;
END;
$$;

-- Recordatorio: mira los que están POR empezar. La ventana del backend es
-- [45, 60) minutos; acá se pregunta por [40, 65) para no perder un saque por
-- unos segundos de desfase entre el reloj del cron y el de la petición.
CREATE OR REPLACE FUNCTION public.cron_recordatorio_saque()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public
AS $$
BEGIN
  IF public.hay_partidos_en_ventana('40 minutes', '65 minutes') THEN
    PERFORM public.llamar_backend('/api/matches/notify-kickoff');
  END IF;
END;
$$;

-- Resumen de las 6 am (12:00 UTC, porque Costa Rica es UTC-6 todo el año).
-- Mismo problema que los otros: el cron decía las 12:00 y se lo vio corriendo
-- a las 15:05, o sea que el «aviso de las 6 am» llegaba cerca de las 9. Acá
-- solo se comprueba que haya partidos HOY: a quién avisarle lo decide el
-- backend, que ya filtra torneo -> quiniela -> miembro.
CREATE OR REPLACE FUNCTION public.cron_resumen_diario()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public
AS $$
BEGIN
  IF public.hay_partidos_en_ventana('0 minutes', '24 hours') THEN
    PERFORM public.llamar_backend('/api/matches/notify-daily');
  END IF;
END;
$$;

-- ── 4. La agenda ──────────────────────────────────────────────────────────
-- `cron.schedule` con un nombre que ya existe lo REEMPLAZA, así que volver a
-- correr la migración no deja tareas duplicadas.
SELECT cron.schedule('sync-en-vivo', '* * * * *',
                     'SELECT public.cron_sync_en_vivo()');

-- Cada 15 minutos, que es el ancho de ventana que espera el backend
-- (ANCHO_VENTANA_MIN = 15). Con pg_cron la cadencia sí es la nominal, que es
-- justo lo que esa ventana necesitaba para no solaparse ni dejar huecos.
SELECT cron.schedule('recordatorio-saque', '*/15 * * * *',
                     'SELECT public.cron_recordatorio_saque()');

-- 12:00 UTC = 6:00 en Costa Rica, todo el año (no hay horario de verano).
SELECT cron.schedule('resumen-diario', '0 12 * * *',
                     'SELECT public.cron_resumen_diario()');

-- ── 5. Nada de esto es del cliente ────────────────────────────────────────
-- Las cuatro nacen abiertas a PUBLIC (lección de la migración 61). Ninguna la
-- llama el frontend: las invoca pg_cron como `postgres`.
REVOKE ALL ON FUNCTION public.hay_partidos_en_ventana(interval, interval) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.llamar_backend(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cron_sync_en_vivo() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cron_recordatorio_saque() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cron_resumen_diario() FROM PUBLIC, anon, authenticated;

DO $verificar$
DECLARE f text; v_tareas integer;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.hay_partidos_en_ventana(interval,interval)',
    'public.llamar_backend(text)',
    'public.cron_sync_en_vivo()',
    'public.cron_recordatorio_saque()',
    'public.cron_resumen_diario()'] LOOP
    IF has_function_privilege('anon', f, 'EXECUTE')
       OR has_function_privilege('authenticated', f, 'EXECUTE') THEN
      RAISE EXCEPTION '% quedo ejecutable desde el cliente', f;
    END IF;
  END LOOP;

  SELECT count(*) INTO v_tareas FROM cron.job
   WHERE jobname IN ('sync-en-vivo', 'recordatorio-saque', 'resumen-diario')
     AND active;
  IF v_tareas <> 3 THEN
    RAISE EXCEPTION 'se esperaban 3 tareas activas y hay %', v_tareas;
  END IF;

  -- El secreto se carga aparte, a mano: no puede venir en un archivo del repo.
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'cron_secret')
     OR NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'backend_base_url') THEN
    RAISE WARNING 'Falta cargar cron_secret y/o backend_base_url en Vault: '
                  'las tareas van a correr sin llamar a nada hasta que estén.';
  END IF;

  RAISE NOTICE 'Cron en la base: 3 tareas activas. Ninguna fila modificada.';
END $verificar$;

COMMIT;
