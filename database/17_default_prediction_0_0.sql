-- =============================================================================
-- 17_default_prediction_0_0.sql
-- =============================================================================
-- REGLA: si un usuario no puso marcador, su predicción por defecto es 0-0.
-- Aplica IGUAL para todos (cualquiera que no haya predicho), de forma pareja.
--
-- Cómo: cuando un partido arranca (in_progress) o termina (finished), se crea
-- una predicción 0-0 para todos los usuarios que no tengan una para ese partido.
-- Luego el motor de puntos la califica como cualquier otra (si termina 0-0 son
-- 3 pts, 1-1 da 1 pt, etc.). NO toca el historial: solo actúa en los cambios de
-- estado de aquí en adelante (incluidos los partidos de hoy al jugarse).
--
-- SECURITY DEFINER para poder insertar predicciones de cualquier usuario
-- (las políticas RLS solo permiten al propio usuario).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.seed_default_predictions(p_match_id integer)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.predictions
    (user_id, match_id, prediction_type, home_goals_pred, away_goals_pred, use_powerup_x2, points_earned)
  SELECT u.id, p_match_id, 'Marcador', 0, 0, false, 0
  FROM public.users u
  WHERE NOT EXISTS (
    SELECT 1 FROM public.predictions p
    WHERE p.user_id = u.id AND p.match_id = p_match_id
  )
  ON CONFLICT (user_id, match_id) DO NOTHING;
$$;

CREATE OR REPLACE FUNCTION public.trg_seed_default_predictions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.seed_default_predictions(NEW.id);
  RETURN NEW;
END;
$$;

-- Se dispara cuando el partido pasa a en curso o finalizado (no en 'pending'),
-- una sola vez por transición de estado.
DROP TRIGGER IF EXISTS matches_seed_default_predictions ON public.matches;
CREATE TRIGGER matches_seed_default_predictions
  AFTER UPDATE OF status ON public.matches
  FOR EACH ROW
  WHEN (NEW.status IN ('in_progress', 'finished') AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.trg_seed_default_predictions();

NOTIFY pgrst, 'reload schema';
