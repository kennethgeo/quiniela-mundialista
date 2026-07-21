-- =============================================================================
-- 35_powerup_default.sql
-- =============================================================================
-- Antes: una fase/jornada sin fila en powerup_limits quedaba SIN tope (comodín
-- ilimitado). En ligas largas (38 jornadas) eso era injusto. Ahora, si no hay
-- config, el tope por defecto es 1 x2 por jornada/fase. (El Mundial no cambia:
-- tiene todas sus filas configuradas.)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.check_powerup_limit() RETURNS trigger AS $$
DECLARE
    v_phase TEXT;
    v_matchday INTEGER;
    v_tid INTEGER;
    v_max_uses INTEGER;
    v_current_uses INTEGER;
    v_final_group BOOLEAN;
BEGIN
    IF NEW.use_powerup_x2 = TRUE THEN
        SELECT phase, COALESCE(matchday, 0), tournament_id
          INTO v_phase, v_matchday, v_tid
        FROM public.matches WHERE id = NEW.match_id;

        v_final_group := v_phase IN ('third_place', 'final');

        IF v_final_group THEN
            SELECT MIN(max_uses) INTO v_max_uses
            FROM public.powerup_limits WHERE phase IN ('third_place', 'final');
        ELSE
            SELECT max_uses INTO v_max_uses
            FROM public.powerup_limits WHERE phase = v_phase AND matchday = v_matchday;
        END IF;

        SELECT COUNT(*) INTO v_current_uses
        FROM public.predictions p
        JOIN public.matches m ON p.match_id = m.id
        WHERE p.user_id = NEW.user_id
          AND p.use_powerup_x2 = TRUE
          AND p.match_id != NEW.match_id
          AND m.tournament_id = v_tid
          AND (
                (v_final_group AND m.phase IN ('third_place', 'final'))
             OR (NOT v_final_group AND m.phase = v_phase AND COALESCE(m.matchday, 0) = v_matchday)
          );

        -- Sin config → default 1.
        IF v_current_uses >= COALESCE(v_max_uses, 1) THEN
            RAISE EXCEPTION 'Límite de comodines x2 alcanzado para esta fase/jornada.';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS enforce_powerup_limit ON public.predictions;
CREATE TRIGGER enforce_powerup_limit
  BEFORE INSERT OR UPDATE ON public.predictions
  FOR EACH ROW EXECUTE FUNCTION public.check_powerup_limit();

NOTIFY pgrst, 'reload schema';
