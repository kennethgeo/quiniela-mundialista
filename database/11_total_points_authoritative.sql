-- =============================================================================
-- 11_total_points_authoritative.sql
-- =============================================================================
-- PROBLEMA:
--   users.total_points se mantenía "a mano" con deltas (leer total, sumar el
--   cambio, escribir) desde DOS motores que corren en paralelo: el live-sync
--   del backend y el sync/guardado del frontend. Bajo concurrencia eso produce
--   "lost updates" (uno pisa al otro) y el total se descuadra. Por eso había
--   que correr el reconcile una y otra vez.
--
-- SOLUCIÓN DEFINITIVA:
--   total_points pasa a ser un VALOR DERIVADO, mantenido SOLO por la base de
--   datos vía trigger atómico. Cada vez que cambian los puntos de una
--   predicción (o de torneo), la BD recalcula el total del usuario como la
--   suma autoritativa. Es idempotente y a prueba de concurrencia (el UPDATE de
--   la fila de users serializa los cambios). Ya nadie lo mantiene con deltas,
--   así que es imposible que vuelva a descuadrarse.
--
--   Tras aplicar esta migración hay que desplegar el código que YA NO escribe
--   total_points con deltas (frontend lib/scoring.js y backend scoring.py).
-- =============================================================================

-- 1) Función autoritativa: recalcula el total de UN usuario desde la fuente.
CREATE OR REPLACE FUNCTION public.recompute_user_total(p_user_id uuid)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE public.users u
  SET total_points =
        COALESCE((
          SELECT SUM(COALESCE(points_earned, 0))
          FROM public.predictions
          WHERE user_id = p_user_id
        ), 0)
      + COALESCE((
          SELECT SUM(COALESCE(champion_points, 0) + COALESCE(top_scorer_points, 0))
          FROM public.tournament_predictions
          WHERE user_id = p_user_id
        ), 0)
  WHERE u.id = p_user_id;
$$;

-- 2) Función de trigger: recalcula el(los) usuario(s) afectado(s) por el cambio.
CREATE OR REPLACE FUNCTION public.trg_recompute_user_total()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (TG_OP = 'DELETE') THEN
    PERFORM public.recompute_user_total(OLD.user_id);
    RETURN OLD;
  END IF;

  PERFORM public.recompute_user_total(NEW.user_id);

  -- Si la predicción se reasignó a otro usuario, recalcular también el anterior.
  IF (TG_OP = 'UPDATE' AND NEW.user_id IS DISTINCT FROM OLD.user_id) THEN
    PERFORM public.recompute_user_total(OLD.user_id);
  END IF;

  RETURN NEW;
END;
$$;

-- 3) Triggers: la BD mantiene total_points sola, pase lo que pase.
DROP TRIGGER IF EXISTS predictions_recompute_total ON public.predictions;
CREATE TRIGGER predictions_recompute_total
  AFTER INSERT OR DELETE OR UPDATE OF points_earned, user_id
  ON public.predictions
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_recompute_user_total();

DROP TRIGGER IF EXISTS tournament_predictions_recompute_total ON public.tournament_predictions;
CREATE TRIGGER tournament_predictions_recompute_total
  AFTER INSERT OR DELETE OR UPDATE OF champion_points, top_scorer_points, user_id
  ON public.tournament_predictions
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_recompute_user_total();

-- 4) Backfill único: deja TODOS los totales correctos ya mismo.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.users LOOP
    PERFORM public.recompute_user_total(r.id);
  END LOOP;
END $$;

-- 5) Refrescar la caché de PostgREST.
NOTIFY pgrst, 'reload schema';
