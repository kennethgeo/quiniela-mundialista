-- =============================================================================
-- 32_more_tournaments.sql  ·  LaLiga, Premier League, Champions
-- =============================================================================
-- Crea 3 torneos ESPN más. Se pueblan con el cron o con "Sync partidos" /
-- "Sync jugadores" del admin. Idempotente (por slug).
--
-- Nota: Champions se deja como 'league' por ahora (su fase de liga encaja bien);
-- el bracket genérico de eliminatoria todavía no está, así que evitamos la
-- pestaña de bracket vacía. Se puede pasar a 'cup' cuando exista.
-- =============================================================================

INSERT INTO public.tournaments (name, slug, kind, status, source, external_ref, season) VALUES
  ('LaLiga',                'laliga',          'league', 'active', 'espn', 'esp.1',          '2026'),
  ('Premier League',        'premier-league',  'league', 'active', 'espn', 'eng.1',          '2026'),
  ('UEFA Champions League', 'champions',       'league', 'active', 'espn', 'uefa.champions', '2026')
ON CONFLICT (slug) DO UPDATE
  SET name = EXCLUDED.name, status = 'active', source = 'espn',
      external_ref = EXCLUDED.external_ref, kind = EXCLUDED.kind;

NOTIFY pgrst, 'reload schema';
