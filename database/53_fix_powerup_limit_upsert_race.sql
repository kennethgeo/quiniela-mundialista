-- =============================================================================
-- 53_fix_powerup_limit_upsert_race.sql  ·  Arregla falso rechazo del cupo de ×2
-- =============================================================================
-- Bug: al guardar una predicción con upsert (INSERT ... ON CONFLICT DO UPDATE)
-- sobre una fila que YA existe (p. ej. solo cambiando el marcador, sin tocar
-- el comodín), Postgres dispara el trigger BEFORE INSERT primero como intento
-- especulativo — con OLD = NULL y TG_OP = 'INSERT' — ANTES de detectar el
-- conflicto de la unique key y resolverlo como UPDATE (que sí dispara con OLD
-- correcto). check_powerup_limit() confiaba en OLD/TG_OP para decidir si el
-- ×2 se estaba activando recién; en ese primer disparo fantasma, OLD=NULL
-- hace que SIEMPRE parezca una activación nueva, cuenta el propio partido
-- como "otro uso" además de los demás de la jornada, se pasa del cupo, y
-- aborta la transacción con RAISE EXCEPTION — sin llegar nunca al segundo
-- disparo (el real, con OLD correcto) que sí hubiera dejado pasar la
-- actualización sin problema. Por eso solo fallaba justo cuando la jornada
-- ya estaba en el cupo exacto, aunque el comodín no se estuviera tocando.
--
-- Fix: en vez de TG_OP/OLD, consultar directo la fila ya guardada en la
-- tabla (por user_id+league_id+match_id) para saber si el ×2 ya estaba
-- activo — eso es correcto en cualquiera de los dos disparos, porque en
-- ambos casos la escritura real todavía no ocurrió.
-- Idempotente.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.check_powerup_limit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_phase text; v_matchday integer; v_base_limit integer; v_current integer;
  v_credits integer; v_activating boolean; v_prev_x2 boolean;
BEGIN
  -- Estado YA guardado de esta predicción (independiente de OLD/TG_OP, que
  -- no son confiables durante el intento especulativo de un upsert).
  SELECT use_powerup_x2 INTO v_prev_x2
  FROM public.predictions
  WHERE user_id = NEW.user_id AND league_id = NEW.league_id AND match_id = NEW.match_id;

  v_activating := (NEW.use_powerup_x2 = TRUE) AND (COALESCE(v_prev_x2, FALSE) = FALSE);

  IF v_activating AND NEW.league_id IS NOT NULL THEN
    SELECT phase, COALESCE(matchday, 0) INTO v_phase, v_matchday
    FROM public.matches WHERE id = NEW.match_id;

    SELECT powerup_limit INTO v_base_limit FROM public.leagues WHERE id = NEW.league_id;

    SELECT COUNT(*) INTO v_current
    FROM public.predictions p
    JOIN public.matches m ON p.match_id = m.id
    WHERE p.user_id = NEW.user_id
      AND p.league_id = NEW.league_id
      AND p.use_powerup_x2 = TRUE
      AND m.phase = v_phase
      AND COALESCE(m.matchday, 0) = v_matchday
      AND p.match_id <> NEW.match_id;

    SELECT COUNT(*) INTO v_credits
    FROM public.powerup_credits
    WHERE user_id = NEW.user_id AND league_id = NEW.league_id
      AND phase = v_phase AND COALESCE(matchday, 0) = v_matchday
      AND consumed_at IS NULL;

    IF v_current >= COALESCE(v_base_limit, 0) + COALESCE(v_credits, 0) THEN
      RAISE EXCEPTION 'Límite de comodines x2 alcanzado para esta jornada.';
    END IF;
  END IF;

  -- Al desactivar el ×2 (transición real true→false), devolver el crédito
  -- que esta predicción hubiera consumido.
  IF COALESCE(v_prev_x2, FALSE) = TRUE AND NEW.use_powerup_x2 = FALSE THEN
    UPDATE public.powerup_credits SET consumed_at = NULL, consumed_by_prediction_id = NULL
    WHERE consumed_by_prediction_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

-- consume_powerup_credit (AFTER) no tiene este problema: los triggers AFTER
-- solo disparan una vez, para la operación que realmente se aplicó (nunca
-- para el intento especulativo abortado), así que TG_OP/OLD ahí sí son
-- confiables. No se toca.

DROP TRIGGER IF EXISTS enforce_powerup_limit ON public.predictions;
CREATE TRIGGER enforce_powerup_limit
  BEFORE INSERT OR UPDATE ON public.predictions
  FOR EACH ROW EXECUTE FUNCTION public.check_powerup_limit();

NOTIFY pgrst, 'reload schema';
