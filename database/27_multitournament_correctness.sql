-- =============================================================================
-- 27_multitournament_correctness.sql
-- =============================================================================
-- Cierra dos huecos para que el multi-torneo sea correcto (la UI del rediseño
-- no debería tener que resolverlos):
--   1) El límite del comodín x2 se cuenta POR TORNEO (antes cruzaba torneos:
--      p.ej. la jornada 1 de dos ligas compartían cupo). El límite (max_uses)
--      sigue siendo el mismo config por fase/jornada; solo el CONTEO es por torneo.
--   2) La predicción global (campeón/goleador) es única POR (usuario, torneo),
--      no una sola por usuario. Permite picks en varios torneos.
-- Idempotente.
-- =============================================================================

-- 1) TRIGGER DEL COMODÍN — contar dentro del mismo torneo -------------------
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
            FROM public.powerup_limits
            WHERE phase IN ('third_place', 'final');
        ELSE
            SELECT max_uses INTO v_max_uses
            FROM public.powerup_limits
            WHERE phase = v_phase AND matchday = v_matchday;
        END IF;

        -- Cuenta comodines en OTROS partidos del mismo cupo, SOLO dentro del
        -- mismo torneo (v_tid). Así no se cruzan torneos distintos.
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

-- 2) tournament_predictions: única por (user_id, tournament_id) --------------
-- Quita cualquier UNIQUE que sea solo sobre user_id.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.tournament_predictions'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) = 'UNIQUE (user_id)'
  LOOP
    EXECUTE format('ALTER TABLE public.tournament_predictions DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.tournament_predictions'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) = 'UNIQUE (user_id, tournament_id)'
  ) THEN
    ALTER TABLE public.tournament_predictions
      ADD CONSTRAINT tournament_predictions_user_tournament_key UNIQUE (user_id, tournament_id);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
