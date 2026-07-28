-- =============================================================================
-- 52_score_locked.sql  ·  Candado de marcador para correcciones oficiales
-- =============================================================================
-- Caso real: un partido SE JUGÓ (queda 'finished'), pero la federación cambia
-- el marcador oficial después por una sanción (p. ej. alineación indebida) y
-- la fuente de datos (ESPN) no lo refleja. La protección que ya existía
-- (migración 45/47) solo excluía del sync a los partidos 'cancelled'/
-- 'postponed' — un 'finished' con marcador corregido a mano seguía "vivo"
-- para el sync, que lo pisaba de vuelta con el dato viejo de ESPN en la
-- siguiente pasada. Pasó exactamente esto con Herediano 3-0 Puntarenas.
--
-- matches.score_locked = true -> el sync automatico (ESPN) ya NO toca el
-- marcador/estado de ese partido, sea cual sea su status. Se libera a mano
-- (UPDATE ... SET score_locked = false) si alguna vez hace falta que vuelva
-- a seguir la fuente automatica.
-- Idempotente.
-- =============================================================================

ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS score_locked boolean NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';
