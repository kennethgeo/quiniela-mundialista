-- ============================================================================
-- 69. Índices para las consultas que corren seguido
-- ============================================================================
--
-- Los tres salieron de una auditoría y se confirmaron mirando pg_index: las
-- tres tablas solo tienen sus claves primarias y algún UNIQUE, ninguno sirve
-- para estos filtros.
--
-- CREATE INDEX CONCURRENTLY no puede ir dentro de una transacción, así que
-- este archivo NO lleva BEGIN/COMMIT. Se hace así a propósito: sin
-- CONCURRENTLY, crear el índice bloquea la escritura de la tabla, y
-- push_subscriptions se escribe cada vez que alguien abre la app.
-- IF NOT EXISTS lo hace repetible.
-- ============================================================================

-- El push personalizado hace .in_("user_id", ids) con todos los destinatarios
-- de una corrida. Sin índice es un recorrido completo de la tabla, y esto se
-- ejecuta en el resumen de las 6am y en el recordatorio de los 45 minutos,
-- que corre cada 15 minutos.
CREATE INDEX CONCURRENTLY IF NOT EXISTS push_subscriptions_user_id_idx
  ON public.push_subscriptions (user_id);

-- El chat se lee siempre ordenado por fecha y acotado a los últimos mensajes.
CREATE INDEX CONCURRENTLY IF NOT EXISTS global_chat_created_at_idx
  ON public.global_chat (created_at DESC);

-- tournament_predictions tiene UNIQUE (user_id) y UNIQUE (user_id, league_id),
-- pero nada que sirva para filtrar SOLO por liga, que es como se leen los
-- pronósticos de campeón/goleador/asistidor de una quiniela.
CREATE INDEX CONCURRENTLY IF NOT EXISTS tournament_predictions_league_id_idx
  ON public.tournament_predictions (league_id);

-- ── Comprobación (correr aparte, después de que terminen) ───────────────────
-- SELECT indexrelid::regclass AS indice, indisvalid AS valido
-- FROM pg_index
-- WHERE indexrelid::regclass::text IN (
--   'push_subscriptions_user_id_idx',
--   'global_chat_created_at_idx',
--   'tournament_predictions_league_id_idx');
--
-- Un índice con indisvalid = false quedó a medias (pasa si la creación se
-- interrumpe): hay que soltarlo y volver a crearlo.
