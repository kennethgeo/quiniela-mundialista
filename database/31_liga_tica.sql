-- =============================================================================
-- 31_liga_tica.sql  ·  Torneo: Liga Tica (Primera División de Costa Rica)
-- =============================================================================
-- Crea el torneo "Liga Tica" (fuente ESPN, código crc.1). Una vez creado:
--   · el cron /sync-live sincroniza sus partidos+resultados automáticamente, o
--   · el admin toca "Sync partidos" y "Sync jugadores" para poblarlo ya.
-- Después, cualquiera crea una quiniela sobre este torneo desde el Hub.
-- Idempotente (por slug).
-- =============================================================================

INSERT INTO public.tournaments (name, slug, kind, status, source, external_ref, season)
VALUES ('Liga Tica', 'liga-tica', 'league', 'active', 'espn', 'crc.1', '2026')
ON CONFLICT (slug) DO UPDATE
  SET status = 'active', source = 'espn', external_ref = 'crc.1', kind = 'league';

NOTIFY pgrst, 'reload schema';
