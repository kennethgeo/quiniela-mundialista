-- =============================================================================
-- 51_fix_powerup_credit_trigger.sql  ·  Arregla el consumo del crédito de ×2
-- =============================================================================
-- Bug encontrado probando 48/49/50 en un entorno local antes de aplicarlas:
-- check_powerup_limit() es un trigger BEFORE INSERT — cuando intentaba marcar
-- el crédito como consumido con "consumed_by_prediction_id = NEW.id", esa fila
-- TODAVÍA NO EXISTE en la tabla predictions (BEFORE INSERT corre antes de que
-- se guarde). Como la columna tiene FOREIGN KEY a predictions(id), la
-- operación fallaba con "violates foreign key constraint" — es decir, activar
-- el comodín usando un crédito arrastrado SIEMPRE iba a fallar.
--
-- Fix: se separa en dos triggers.
--   · check_powerup_limit (BEFORE): SOLO valida el cupo (base + créditos) y
--     RAISE EXCEPTION si no alcanza; libera el crédito al desactivar el ×2
--     (esto sí es seguro en BEFORE, no crea una referencia nueva).
--   · consume_powerup_credit (AFTER): ya con la fila guardada, si esta
--     activación superó el cupo base, marca el crédito más viejo como
--     consumido apuntando a esta predicción (ahora sí existe, FK válida).
-- Idempotente.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.check_powerup_limit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_phase text; v_matchday integer; v_base_limit integer; v_current integer;
  v_credits integer; v_activating boolean;
BEGIN
  v_activating := (NEW.use_powerup_x2 = TRUE)
    AND (TG_OP = 'INSERT' OR COALESCE(OLD.use_powerup_x2, FALSE) = FALSE);

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
      AND p.id <> NEW.id;

    SELECT COUNT(*) INTO v_credits
    FROM public.powerup_credits
    WHERE user_id = NEW.user_id AND league_id = NEW.league_id
      AND phase = v_phase AND COALESCE(matchday, 0) = v_matchday
      AND consumed_at IS NULL;

    IF v_current >= COALESCE(v_base_limit, 0) + COALESCE(v_credits, 0) THEN
      RAISE EXCEPTION 'Límite de comodines x2 alcanzado para esta jornada.';
    END IF;
  END IF;

  -- Al desactivar el ×2, devolver el crédito que esta predicción hubiera
  -- consumido (solo pone NULL, no crea una referencia nueva → seguro en BEFORE).
  IF TG_OP = 'UPDATE' AND COALESCE(OLD.use_powerup_x2, FALSE) = TRUE AND NEW.use_powerup_x2 = FALSE THEN
    UPDATE public.powerup_credits SET consumed_at = NULL, consumed_by_prediction_id = NULL
    WHERE consumed_by_prediction_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

-- Consumir el crédito DESPUÉS de guardar (la fila ya existe → FK válida).
CREATE OR REPLACE FUNCTION public.consume_powerup_credit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_phase text; v_matchday integer; v_base_limit integer; v_current integer;
  v_credit_id uuid; v_activating boolean;
BEGIN
  v_activating := (NEW.use_powerup_x2 = TRUE)
    AND (TG_OP = 'INSERT' OR COALESCE(OLD.use_powerup_x2, FALSE) = FALSE);

  IF v_activating AND NEW.league_id IS NOT NULL THEN
    SELECT phase, COALESCE(matchday, 0) INTO v_phase, v_matchday
    FROM public.matches WHERE id = NEW.match_id;

    SELECT powerup_limit INTO v_base_limit FROM public.leagues WHERE id = NEW.league_id;

    -- Ahora SÍ incluye esta fila (ya guardada): si el total supera el cupo
    -- base, esta activación es la que corresponde cubrir con un crédito.
    SELECT COUNT(*) INTO v_current
    FROM public.predictions p
    JOIN public.matches m ON p.match_id = m.id
    WHERE p.user_id = NEW.user_id
      AND p.league_id = NEW.league_id
      AND p.use_powerup_x2 = TRUE
      AND m.phase = v_phase
      AND COALESCE(m.matchday, 0) = v_matchday;

    IF v_current > COALESCE(v_base_limit, 0) THEN
      SELECT id INTO v_credit_id FROM public.powerup_credits
      WHERE user_id = NEW.user_id AND league_id = NEW.league_id
        AND phase = v_phase AND COALESCE(matchday, 0) = v_matchday
        AND consumed_at IS NULL
      ORDER BY created_at ASC LIMIT 1;
      IF v_credit_id IS NOT NULL THEN
        UPDATE public.powerup_credits
          SET consumed_at = now(), consumed_by_prediction_id = NEW.id
          WHERE id = v_credit_id;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_powerup_limit ON public.predictions;
CREATE TRIGGER enforce_powerup_limit
  BEFORE INSERT OR UPDATE ON public.predictions
  FOR EACH ROW EXECUTE FUNCTION public.check_powerup_limit();

DROP TRIGGER IF EXISTS consume_powerup_credit_trigger ON public.predictions;
CREATE TRIGGER consume_powerup_credit_trigger
  AFTER INSERT OR UPDATE ON public.predictions
  FOR EACH ROW EXECUTE FUNCTION public.consume_powerup_credit();

NOTIFY pgrst, 'reload schema';
