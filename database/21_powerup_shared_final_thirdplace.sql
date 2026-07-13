-- =============================================================================
-- 21_powerup_shared_final_thirdplace.sql
-- =============================================================================
-- El TERCER PUESTO y la FINAL comparten UN SOLO comodín x2 (antes era 1 para
-- cada uno = 2 en total). Se ajusta el trigger check_powerup_limit para tratar
-- ambas fases como un mismo cupo: los usos se cuentan juntos y el límite es el
-- menor de los dos (ambos valen 1 → 1 compartido).
--
-- Se mantienen las dos filas en powerup_limits (third_place=1, final=1); la
-- semántica compartida vive en el trigger. El resto de fases/jornadas no cambia.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.check_powerup_limit() RETURNS trigger AS $$
DECLARE
    v_phase TEXT;
    v_matchday INTEGER;
    v_max_uses INTEGER;
    v_current_uses INTEGER;
    v_final_group BOOLEAN;
BEGIN
    IF NEW.use_powerup_x2 = TRUE THEN
        SELECT phase, COALESCE(matchday, 0) INTO v_phase, v_matchday
        FROM public.matches WHERE id = NEW.match_id;

        v_final_group := v_phase IN ('third_place', 'final');

        -- Límite del cupo. Para el grupo final (3er + final) se toma el menor de
        -- los dos límites (comparten un único comodín).
        IF v_final_group THEN
            SELECT MIN(max_uses) INTO v_max_uses
            FROM public.powerup_limits
            WHERE phase IN ('third_place', 'final');
        ELSE
            SELECT max_uses INTO v_max_uses
            FROM public.powerup_limits
            WHERE phase = v_phase AND matchday = v_matchday;
        END IF;

        -- Usos en OTROS partidos del mismo cupo (excluye el partido actual, para
        -- que editar su propia predicción no cuente doble). El cupo es la
        -- fase/jornada normal, o el grupo final (3er + final) en conjunto.
        SELECT COUNT(*) INTO v_current_uses
        FROM public.predictions p
        JOIN public.matches m ON p.match_id = m.id
        WHERE p.user_id = NEW.user_id
          AND p.use_powerup_x2 = TRUE
          AND p.match_id != NEW.match_id
          AND (
                (v_final_group AND m.phase IN ('third_place', 'final'))
             OR (NOT v_final_group AND m.phase = v_phase AND COALESCE(m.matchday, 0) = v_matchday)
          );

        IF v_max_uses IS NOT NULL AND v_current_uses >= v_max_uses THEN
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
