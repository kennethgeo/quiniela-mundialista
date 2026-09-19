-- =============================================================================
-- 81_rescate_de_resultados.sql
-- El sync solo se llamaba mientras había un partido EN CURSO, así que un
-- resultado que se perdió no se recuperaba nunca. Solo funciones y agenda: no
-- toca ninguna fila de datos. Idempotente.
-- =============================================================================
--
-- LO QUE PASÓ, MEDIDO (19 sep 2026, 15:05 UTC). Pérez Zeledón–Sporting sacó el
-- 19 a las 02:00 UTC y terminó 1-2. La migración 80 y el arreglo de los meses
-- (el sync le pedía a ESPN por RANGOS y recibía listas vacías) ya estaban
-- desplegados a las 14:53, y `cron.job_run_details` mostraba `sync-en-vivo`
-- corriendo **cada minuto, sin fallar**. El partido seguía en `pending`, sin
-- marcador.
--
-- La causa no era el sync: era la PUERTA. `cron_sync_en_vivo` solo llama al
-- backend `IF hay_partidos_en_ventana('-4 hours','15 minutes')`, y el saque de
-- ese partido había sido 13 horas antes. Comprobado en producción:
--
--     SELECT public.hay_partidos_en_ventana('-4 hours','15 minutes');  -- false
--     -- y net._http_response no tenía ni una llamada al sync desde las 12:00
--
-- O sea que el arreglo desplegado **no podía correr para el único partido que
-- lo necesitaba**. El siguiente saque era ocho horas después: hasta entonces,
-- un partido terminado el viernes iba a seguir sin resultado.
--
-- Y EL VIGILANTE ESTABA DENTRO DE ESA MISMA PUERTA. `vigilar_resultados()`
-- (migración anterior, `score_check.py`) corre dentro de `/sync-live` y busca
-- justo partidos con el saque pasado hace más de 4 horas y sin resultado — que
-- es exactamente lo que la ventana `-4 hours` deja fuera. La alarma que se
-- puso para cazar un sync mudo solo podía sonar si, por casualidad, había otro
-- partido en curso en ese momento. Es el mismo error que ya estaba anotado
-- para `comparar_con_unafut` («la alarma existía y miraba al lado»), una
-- vuelta más arriba.
--
-- LA VENTANA `-4 hours` NO SE ENSANCHA. Está bien puesta: es lo que dura un
-- partido, y el job corre cada minuto. Ensancharla a días haría que el minuto
-- a minuto llamara a ESPN por partidos viejos para siempre. Lo que falta es
-- otra puerta, con otra cadencia y otro motivo: rescatar, no seguir en vivo.

BEGIN;

-- ── 1. ¿Hay resultados que deberíamos tener y no tenemos? ─────────────────
-- El espejo de `hay_partidos_en_ventana`: aquella mira hacia adelante (lo que
-- está por pasar), esta mira hacia atrás (lo que ya pasó y no escribimos).
--
-- LOS DOS NÚMEROS ESTÁN ATADOS A ALGO, no elegidos a ojo:
--
--   p_desde_hace = 4 horas  → es `MINUTOS_MAXIMOS_DE_PARTIDO` (240) de
--     `matchStatus.js` y `HORAS_PARA_SOSPECHAR` de `score_check.py`. Es el
--     momento en que la app deja de decir «en juego» y admite que no tiene el
--     dato. Si la pantalla lo admite, el backend sale a buscarlo: dos números
--     distintos dejarían una franja en la que la app dice «sin datos» y nadie
--     está mirando.
--
--   p_hasta_hace = 3 días   → es la ventana móvil del sync
--     (`DIAS_HACIA_ATRAS` en `espn_tournament_sync.py`). Más atrás de eso el
--     sync ni le pregunta a ESPN, así que insistir no rescataría nada: sería
--     llamar por algo que no se puede arreglar solo. Eso ya es trabajo del
--     admin, y el vigilante lo reporta.
--
-- El límite de arriba es además lo que impide que esto se quede llamando para
-- siempre por un partido que la fuente nunca va a dar.
CREATE OR REPLACE FUNCTION public.hay_resultados_sin_escribir(
  p_desde_hace interval, p_hasta_hace interval)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.matches m
    JOIN public.tournaments t ON t.id = m.tournament_id
    WHERE t.status <> 'finished'
      -- `pending` es el caso del partido que el sync nunca escribió;
      -- `in_progress`, el del que abrió y no cerró nunca.
      AND m.status IN ('pending', 'in_progress')
      AND m.kickoff_at BETWEEN now() - p_hasta_hace AND now() - p_desde_hace
      -- Mismo criterio que la otra puerta: sin quiniela, nadie lo está mirando.
      AND EXISTS (SELECT 1 FROM public.leagues l WHERE l.tournament_id = t.id)
  );
$$;

COMMENT ON FUNCTION public.hay_resultados_sin_escribir(interval, interval) IS
  'Interna, para el cron. Cierto si hay partidos con el saque ya pasado y sin '
  'resultado, en un torneo no terminado y CON quiniela.';

-- ── 2. El rescate ─────────────────────────────────────────────────────────
-- Llama al MISMO endpoint que el sync en vivo, a propósito: ahí es donde viven
-- el upsert de ESPN (que escribe el resultado que falta) y el vigilante (que
-- avisa si ni así aparece). No hace falta un endpoint nuevo; hacía falta que a
-- este lo llamara alguien.
CREATE OR REPLACE FUNCTION public.cron_rescate_resultados()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public
AS $$
BEGIN
  IF public.hay_resultados_sin_escribir('4 hours', '3 days') THEN
    PERFORM public.llamar_backend('/api/matches/sync-live');
  END IF;
END;
$$;

-- Cada media hora, y no cada minuto. Lo que se rescata lleva **horas** de
-- retraso por definición, así que media hora más no cambia nada para nadie; y
-- en el peor caso —un partido que la fuente nunca va a dar— esto son 48
-- llamadas al día durante 3 días y después se calla solo, en vez de 1.440.
SELECT cron.schedule('rescate-de-resultados', '*/30 * * * *',
                     'SELECT public.cron_rescate_resultados()');

-- ── 3. Nada de esto es del cliente ────────────────────────────────────────
-- Nacen abiertas a PUBLIC (lección de la migración 61). Las invoca pg_cron.
REVOKE ALL ON FUNCTION public.hay_resultados_sin_escribir(interval, interval) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cron_rescate_resultados() FROM PUBLIC, anon, authenticated;

DO $verificar$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.hay_resultados_sin_escribir(interval,interval)',
    'public.cron_rescate_resultados()'] LOOP
    IF has_function_privilege('anon', f, 'EXECUTE')
       OR has_function_privilege('authenticated', f, 'EXECUTE') THEN
      RAISE EXCEPTION '% quedo ejecutable desde el cliente', f;
    END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM cron.job
                  WHERE jobname = 'rescate-de-resultados' AND active) THEN
    RAISE EXCEPTION 'la tarea rescate-de-resultados no quedo activa';
  END IF;

  -- La puerta de siempre tiene que seguir siendo la de siempre: si alguien
  -- ensancha `-4 hours` para "arreglar" esto, el job de cada minuto empieza a
  -- llamar a ESPN por partidos viejos y esta migración deja de tener sentido.
  IF pg_get_functiondef('public.cron_sync_en_vivo()'::regprocedure)
       NOT LIKE '%-4 hours%' THEN
    RAISE WARNING 'cron_sync_en_vivo ya no usa la ventana -4 hours: revisar que '
                  'el minuto a minuto no se haya convertido en el rescate.';
  END IF;

  RAISE NOTICE 'Rescate de resultados activo (cada 30 min). Ninguna fila modificada.';
END $verificar$;

COMMIT;
