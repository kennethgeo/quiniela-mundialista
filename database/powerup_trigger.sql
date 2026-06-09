-- database/powerup_trigger.sql
-- Restricción estricta en base de datos para evitar trampas con el multiplicador.

-- 1. Crear la función que valida la regla de 1 Power-Up por fase/jornada
CREATE OR REPLACE FUNCTION public.check_single_powerup_per_matchday()
RETURNS TRIGGER AS $$
DECLARE
  v_matchday INTEGER;
  v_phase TEXT;
  v_powerups_used INTEGER;
  v_limit INTEGER;
BEGIN
  -- Si el usuario no está intentando usar powerup, no hay problema
  IF NOT NEW.use_powerup_x2 THEN
    RETURN NEW;
  END IF;

  -- Obtener matchday y phase del partido actual
  SELECT matchday, phase INTO v_matchday, v_phase
  FROM public.matches
  WHERE id = NEW.match_id;

  -- Obtener el límite configurado dinámico
  SELECT max_uses INTO v_limit
  FROM public.powerup_limits
  WHERE phase = v_phase
    AND (matchday = v_matchday OR (matchday IS NULL AND v_matchday IS NULL));

  -- Si no hay límite configurado en la tabla, se asume 0
  IF v_limit IS NULL THEN
    v_limit := 0;
  END IF;

  -- Contar cuántos comodines ya usó el usuario en esta fase/jornada
  SELECT count(*) INTO v_powerups_used
  FROM public.predictions p
  JOIN public.matches m ON p.match_id = m.id
  WHERE p.user_id = NEW.user_id
    AND p.use_powerup_x2 = TRUE
    AND p.id != NEW.id -- no contar la misma en caso de actualización (update)
    AND m.phase = v_phase
    AND (m.matchday = v_matchday OR (m.matchday IS NULL AND v_matchday IS NULL));

  -- Si ya alcanzó o superó el límite, se bloquea la operación
  IF v_powerups_used >= v_limit THEN
    RAISE EXCEPTION 'Ya has utilizado el límite de comodines (x2) permitidos en esta jornada o fase.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Eliminar el trigger si ya existía para evitar errores
DROP TRIGGER IF EXISTS enforce_single_powerup_per_matchday ON public.predictions;

-- 3. Crear el Trigger ligado a la tabla predictions
CREATE TRIGGER enforce_single_powerup_per_matchday
  BEFORE INSERT OR UPDATE ON public.predictions
  FOR EACH ROW
  EXECUTE FUNCTION public.check_single_powerup_per_matchday();
