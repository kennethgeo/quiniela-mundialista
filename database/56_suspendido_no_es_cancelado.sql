-- =============================================================================
-- 56_suspendido_no_es_cancelado.sql
-- =============================================================================
-- PROBLEMA: un partido suspendido por clima que se reanuda y termina quedaba
-- cancelado PARA SIEMPRE. La cadena era:
--   1. ESPN marca STATUS_SUSPENDED (lluvia/neblina).
--   2. El sync mapeaba cualquier SUSPEND/ABANDON a status 'cancelled'.
--   3. void_cancelled_match anulaba los puntos, apagaba el ×2 de todos los que
--      lo habían usado y les repartía créditos de arrastre.
--   4. Como los 'cancelled' estaban congelados (frozen_ids), el sync NUNCA los
--      volvía a mirar — ni cuando ESPN después reportaba el partido terminado.
-- Pasó dos veces en cinco jornadas (neblina y lluvia) y las dos hubo que
-- arreglarlo a mano.
--
-- SOLUCIÓN (el código va aparte, en espn_tournament_sync.py y live_sync.py):
--   · SUSPEND/ABANDON ya NO se mapean a 'cancelled', sino a 'in_progress': una
--     suspensión es transitoria, así que no se destruye nada. Cuando ESPN
--     confirme el final, el partido se cierra y puntúa solo.
--   · Solo CANCEL/POSTPON/FORFEIT siguen siendo 'cancelled' (son terminales).
--   · El sync ya no congela por status, sino SOLO por score_locked. O sea: lo
--     que el admin marca a mano manda, y lo que el sync dedujo puede corregirse
--     solo. Los casos raros de verdad (alineación indebida, walkover) los marca
--     el admin desde el panel, que ahora activa score_locked.
--
-- ESTA MIGRACIÓN: como el congelado deja de depender del status, hay que
-- blindar los partidos que HOY están cancelados; si no, el próximo sync los
-- pisaría con lo que diga ESPN. En este momento es el walkover de la jornada 1
-- (AD San Carlos vs Escorpiones), que ESPN sigue reportando como jugado.
-- Idempotente.
-- =============================================================================

UPDATE public.matches
SET score_locked = true
WHERE status IN ('cancelled', 'postponed')
  AND score_locked = false;

NOTIFY pgrst, 'reload schema';
