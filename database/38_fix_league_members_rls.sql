-- =============================================================================
-- 38_fix_league_members_rls.sql  ·  Arreglo recursión RLS en league_members
-- =============================================================================
-- La política "league_members_select_members" consultaba league_members dentro
-- de su propia política → "infinite recursion detected in policy". Se disparaba
-- al guardar predicciones (que ahora leen leagues/league_members por el league_id).
-- Fix estándar de Supabase: usar un helper SECURITY DEFINER que no evalúa RLS.
-- Idempotente.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.is_league_member(p_league uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.league_members
    WHERE league_id = p_league AND user_id = auth.uid()
  );
$$;
GRANT EXECUTE ON FUNCTION public.is_league_member(uuid) TO authenticated;

DROP POLICY IF EXISTS "league_members_select_members" ON public.league_members;
CREATE POLICY "league_members_select_members"
  ON public.league_members FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.is_league_member(league_id));

-- El trigger de límite de comodines lee leagues/predictions; con SECURITY DEFINER
-- sus lecturas no re-evalúan RLS (evita cualquier recursión residual).
CREATE OR REPLACE FUNCTION public.check_powerup_limit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_phase text; v_matchday integer; v_limit integer; v_current integer;
BEGIN
  IF NEW.use_powerup_x2 = TRUE AND NEW.league_id IS NOT NULL THEN
    SELECT phase, COALESCE(matchday, 0) INTO v_phase, v_matchday
    FROM public.matches WHERE id = NEW.match_id;

    SELECT powerup_limit INTO v_limit FROM public.leagues WHERE id = NEW.league_id;

    SELECT COUNT(*) INTO v_current
    FROM public.predictions p
    JOIN public.matches m ON p.match_id = m.id
    WHERE p.user_id = NEW.user_id
      AND p.league_id = NEW.league_id
      AND p.use_powerup_x2 = TRUE
      AND m.phase = v_phase
      AND COALESCE(m.matchday, 0) = v_matchday
      AND p.id <> NEW.id;

    IF v_limit IS NOT NULL AND v_current >= v_limit THEN
      RAISE EXCEPTION 'Límite de comodines x2 alcanzado para esta jornada.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
