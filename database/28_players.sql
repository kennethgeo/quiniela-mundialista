-- =============================================================================
-- 28_players.sql  ·  Jugadores por torneo (para el pick de goleador)
-- =============================================================================
-- Guarda el pool de jugadores de cada torneo (rosters de ESPN). Así el pick de
-- goleador pasa de texto libre a una SELECCIÓN de jugadores reales, y el match
-- del puntaje se vuelve exacto (adiós al lío de acentos/apellidos).
-- Se llena con el endpoint admin /api/admin/sync-rosters (idempotente).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.players (
  id            BIGSERIAL PRIMARY KEY,
  tournament_id INTEGER NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  team          TEXT NOT NULL,
  name          TEXT NOT NULL,
  position      TEXT,
  external_id   TEXT,           -- id de ESPN (clave estable para upsert)
  headshot_url  TEXT,
  created_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE (tournament_id, external_id)
);
CREATE INDEX IF NOT EXISTS idx_players_tournament ON public.players(tournament_id);
COMMENT ON TABLE public.players IS 'Jugadores (rosters ESPN) por torneo — para elegir goleador';

ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "players_select_all" ON public.players;
CREATE POLICY "players_select_all" ON public.players
  FOR SELECT TO authenticated USING (true);
-- La escritura la hace el backend (service role) vía sync-rosters.

NOTIFY pgrst, 'reload schema';
