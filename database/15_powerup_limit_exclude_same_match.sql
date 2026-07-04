-- =============================================================================
-- 15_powerup_limit_exclude_same_match.sql
-- =============================================================================
-- BUG (persistía tras la 14): al editar una predicción que YA tenía x2, seguía
-- saliendo "Límite de comodines x2 alcanzado".
--
-- CAUSA REAL: el frontend guarda con UPSERT (INSERT ... ON CONFLICT DO UPDATE).
-- En Postgres, el trigger BEFORE INSERT se dispara SIEMPRE como TG_OP='INSERT'
-- (aunque la fila ya exista) y con un id nuevo. Por eso la guarda de la 14
-- (TG_OP='INSERT') igual validaba, y como se excluía por p.id != NEW.id (un id
-- nuevo), la propia predicción vieja del partido SÍ se contaba → llegaba al
-- límite y rebotaba la edición.
--
-- SOLUCIÓN: contar el cupo excluyendo por match_id (no por id). Como hay a lo
-- sumo un comodín por (usuario, partido), basta con contar los OTROS partidos
-- de la jornada/fase. Así, guardar un partido nunca cuenta contra sí mismo
-- (sea alta o edición), y el límite real (p. ej. 6) se respeta: solo rebota al
-- intentar activar uno en un partido NUEVO cuando ya hay 6 en otros partidos.
-- =============================================================================

-- Por las dudas: si la migración 13 no se aplicó del todo, quitar el trigger
-- frágil que también rechazaba (idempotente).
DROP TRIGGER IF EXISTS enforce_single_powerup_per_matchday ON public.predictions;
DROP FUNCTION IF EXISTS public.check_single_powerup_per_matchday();

CREATE OR REPLACE FUNCTION public.check_powerup_limit() RETURNS trigger AS $$
DECLARE
    v_phase TEXT;
    v_matchday INTEGER;
    v_max_uses INTEGER;
    v_current_uses INTEGER;
BEGIN
    IF NEW.use_powerup_x2 = TRUE THEN
        SELECT phase, COALESCE(matchday, 0) INTO v_phase, v_matchday
        FROM public.matches WHERE id = NEW.match_id;

        SELECT max_uses INTO v_max_uses
        FROM public.powerup_limits
        WHERE phase = v_phase AND matchday = v_matchday;

        -- Contar comodines en OTROS partidos de la misma jornada/fase. Se excluye
        -- el partido actual (su propio cupo) para que editarlo no cuente doble.
        SELECT COUNT(*) INTO v_current_uses
        FROM public.predictions p
        JOIN public.matches m ON p.match_id = m.id
        WHERE p.user_id = NEW.user_id
          AND p.use_powerup_x2 = TRUE
          AND m.phase = v_phase
          AND COALESCE(m.matchday, 0) = v_matchday
          AND p.match_id != NEW.match_id;

        IF v_max_uses IS NOT NULL AND v_current_uses >= v_max_uses THEN
            RAISE EXCEPTION 'Límite de comodines x2 alcanzado para esta fase/jornada.';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Asegurar que el trigger esté vinculado a esta función.
DROP TRIGGER IF EXISTS enforce_powerup_limit ON public.predictions;
CREATE TRIGGER enforce_powerup_limit
  BEFORE INSERT OR UPDATE ON public.predictions
  FOR EACH ROW EXECUTE FUNCTION public.check_powerup_limit();

NOTIFY pgrst, 'reload schema';
