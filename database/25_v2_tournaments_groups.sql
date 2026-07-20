-- =============================================================================
-- 25_v2_tournaments_groups.sql  ·  Cimientos de la 2.0 (Tico Games)
-- =============================================================================
-- Sienta las bases para MULTI-TORNEO y GRUPOS, de forma ADITIVA y NO ROMPE nada:
-- el Mundial 2026 pasa a ser el torneo #1 y todos los usuarios quedan en un
-- grupo por defecto "Mundial 2026". La app actual sigue funcionando igual.
--
--   1) tournaments            — catálogo de torneos (Copa/Liga, fuente de datos)
--   2) matches.tournament_id  — cada partido pertenece a un torneo (backfill = 1)
--   3) tournament_predictions.tournament_id — picks de campeón/goleador por torneo
--   4) leagues (= grupos) + tournament_id — un grupo juega un torneo; grupo por
--      defecto con TODOS los usuarios adentro (conserva el ranking actual)
-- Idempotente.
-- =============================================================================

-- 1) TORNEOS -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tournaments (
  id           SERIAL PRIMARY KEY,
  name         TEXT NOT NULL,
  slug         TEXT UNIQUE,
  kind         TEXT NOT NULL DEFAULT 'cup'    CHECK (kind   IN ('cup','league')),
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('upcoming','active','finished')),
  source       TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('espn','manual')),
  external_ref TEXT,                 -- código de liga para el sync (p. ej. ESPN)
  season       TEXT,
  logo_url     TEXT,
  starts_at    TIMESTAMPTZ,
  ends_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT now()
);
COMMENT ON TABLE public.tournaments IS 'Torneos (Copa/Liga). El Mundial 2026 es el #1.';

ALTER TABLE public.tournaments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tournaments_select_all" ON public.tournaments;
CREATE POLICY "tournaments_select_all" ON public.tournaments
  FOR SELECT TO authenticated USING (true);
-- La escritura queda para el service_role (backend admin).

-- Sembrar el Mundial 2026 como torneo #1
INSERT INTO public.tournaments (id, name, slug, kind, status, source, external_ref, season)
VALUES (1, 'Mundial 2026', 'mundial-2026', 'cup', 'finished', 'espn', 'fifa.world', '2026')
ON CONFLICT (id) DO NOTHING;
-- Dejar la secuencia por encima del id sembrado
SELECT setval(pg_get_serial_sequence('public.tournaments','id'),
              GREATEST((SELECT COALESCE(max(id),1) FROM public.tournaments), 1));

-- 2) matches.tournament_id ---------------------------------------------------
ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS tournament_id INTEGER REFERENCES public.tournaments(id) ON DELETE CASCADE;
UPDATE public.matches SET tournament_id = 1 WHERE tournament_id IS NULL;
ALTER TABLE public.matches ALTER COLUMN tournament_id SET DEFAULT 1;
ALTER TABLE public.matches ALTER COLUMN tournament_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_matches_tournament ON public.matches(tournament_id);

-- 3) tournament_predictions.tournament_id ------------------------------------
-- (Se mantiene la UNIQUE(user_id) por ahora: hay un solo torneo con picks. Al
--  habilitar picks en varios torneos se cambiará a (user_id, tournament_id).)
ALTER TABLE public.tournament_predictions
  ADD COLUMN IF NOT EXISTS tournament_id INTEGER REFERENCES public.tournaments(id) ON DELETE CASCADE;
UPDATE public.tournament_predictions SET tournament_id = 1 WHERE tournament_id IS NULL;
ALTER TABLE public.tournament_predictions ALTER COLUMN tournament_id SET DEFAULT 1;

-- 4) GRUPOS (= leagues) ------------------------------------------------------
ALTER TABLE public.leagues
  ADD COLUMN IF NOT EXISTS tournament_id INTEGER REFERENCES public.tournaments(id) ON DELETE CASCADE;
ALTER TABLE public.leagues
  ADD COLUMN IF NOT EXISTS description TEXT;

-- Grupo por defecto "Mundial 2026" con TODOS los usuarios (conserva el ranking).
DO $$
DECLARE g_id uuid; adm uuid;
BEGIN
  SELECT id INTO adm FROM public.users WHERE is_admin = TRUE ORDER BY created_at LIMIT 1;
  IF adm IS NULL THEN SELECT id INTO adm FROM public.users ORDER BY created_at LIMIT 1; END IF;

  SELECT id INTO g_id FROM public.leagues WHERE tournament_id = 1 AND name = 'Mundial 2026' LIMIT 1;
  IF g_id IS NULL AND adm IS NOT NULL THEN
    INSERT INTO public.leagues (name, invitation_code, admin_id, tournament_id, description)
    VALUES ('Mundial 2026', 'MUNDIAL26', adm, 1, 'Grupo general del Mundial 2026')
    RETURNING id INTO g_id;
  END IF;

  IF g_id IS NOT NULL THEN
    INSERT INTO public.league_members (league_id, user_id)
    SELECT g_id, u.id FROM public.users u
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
