-- =============================================================================
-- 13_fix_powerup_matchday.sql
-- =============================================================================
-- BUG: no se podían guardar comodines (x2), sobre todo en fase de grupos. Al
-- darle "Actualizar predicción" el guardado se rechazaba en silencio y, una vez
-- usado un comodín, no dejaba aplicarlo en otro partido (ni borrándolo).
--
-- CAUSA:
--   Existían DOS triggers de límite de comodín sobre public.predictions:
--     - enforce_powerup_limit  -> check_powerup_limit()  (tolerante)
--     - enforce_single_powerup_per_matchday -> check_single_powerup_per_matchday()
--   El segundo es FRÁGIL: si no encuentra una fila en powerup_limits para la
--   (phase, matchday) del partido, asume límite 0 y RECHAZA todo intento de
--   comodín. Y no la encontraba porque matches.matchday venía nulo/inconsistente
--   desde la API (por eso el frontend recalcula la jornada por su cuenta). Así,
--   la BD rechazaba el guardado aunque el frontend mostrara cupo disponible.
--
-- SOLUCIÓN:
--   1) Recalcular matches.matchday de la fase de grupos igual que el frontend:
--      orden cronológico dentro de cada grupo, 2 partidos por jornada (1,1,2,2,3,3).
--   2) Eliminar el trigger/función frágil y dejar SOLO el tolerante, que ahora
--      encuentra bien el límite y solo bloquea cuando de verdad se alcanzó.
-- =============================================================================

-- 1) Recalcular la jornada de los partidos de grupos (cronológico por grupo).
WITH ranked AS (
  SELECT id,
         row_number() OVER (PARTITION BY group_name ORDER BY kickoff_at, id) AS rn
  FROM public.matches
  WHERE phase = 'groups'
)
UPDATE public.matches m
SET matchday = ((r.rn - 1) / 2)::int + 1
FROM ranked r
WHERE m.id = r.id
  AND m.matchday IS DISTINCT FROM (((r.rn - 1) / 2)::int + 1);

-- 2) Quitar el trigger/función frágil (rechaza todo si no halla límite).
DROP TRIGGER IF EXISTS enforce_single_powerup_per_matchday ON public.predictions;
DROP FUNCTION IF EXISTS public.check_single_powerup_per_matchday();

-- 3) Dejar el trigger tolerante como única validación (se recrea por las dudas).
--    Solo bloquea cuando hay un límite configurado y ya se alcanzó; si faltara
--    el límite, falla "abierto" (permite) en vez de rechazar todo.
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

        SELECT COUNT(*) INTO v_current_uses
        FROM public.predictions p
        JOIN public.matches m ON p.match_id = m.id
        WHERE p.user_id = NEW.user_id
          AND p.use_powerup_x2 = TRUE
          AND m.phase = v_phase
          AND COALESCE(m.matchday, 0) = v_matchday
          AND p.id != NEW.id;

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

-- 4) Refrescar la caché de PostgREST.
NOTIFY pgrst, 'reload schema';
