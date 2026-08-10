-- =============================================================================
-- 54_unafut_player_stats.sql  ·  Goleadores/asistencias en vivo desde UNAFUT
-- =============================================================================
-- ESPN (nuestra fuente de partidos/marcadores) no expone asistencias para la
-- Liga de Costa Rica. UNAFUT sí las tiene, publicadas vía la API pública de su
-- proveedor de datos (GeniusSports/pixeles.club, sin autenticación):
--   https://gapi.pixeles.club/ligas/{unafut_league_slug}/api/stats?competitionId={unafut_competition_id}
-- Guardamos esos dos identificadores por torneo (nulos para torneos que no
-- están en esa plataforma) para que el backend pueda armar la URL.
-- competition_id cambia entre torneos/temporadas (Apertura/Clausura) — lo
-- actualiza el admin a mano cuando corresponda, igual que external_ref.
-- Idempotente.
-- =============================================================================

ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS unafut_league_slug text,
  ADD COLUMN IF NOT EXISTS unafut_competition_id text;

UPDATE public.tournaments
SET unafut_league_slug = 'costarica', unafut_competition_id = '2373'
WHERE id = 2 AND unafut_league_slug IS NULL;

NOTIFY pgrst, 'reload schema';
