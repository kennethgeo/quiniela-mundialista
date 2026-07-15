-- =============================================================================
-- 22_admin_features.sql
-- =============================================================================
-- Habilita varias funciones nuevas del panel de admin:
--   1) Moderación de chat: el admin puede borrar CUALQUIER mensaje.
--   2) Ajuste manual de puntos: columna users.points_adjustment que entra en el
--      total autoritativo (recompute_user_total).
--   3) Anuncios: banner editable en global_settings.
-- Idempotente.
-- =============================================================================

-- 1) MODERACIÓN DE CHAT ------------------------------------------------------
-- El borrado del propio mensaje ya existe (comments_delete_own). Agregamos que
-- un admin pueda borrar el de cualquiera.
DROP POLICY IF EXISTS "global_chat_delete_admin" ON public.global_chat;
CREATE POLICY "global_chat_delete_admin"
  ON public.global_chat FOR DELETE
  TO authenticated
  USING ((SELECT is_admin FROM public.users WHERE id = auth.uid()) = TRUE);

-- Realtime necesita ver el evento DELETE con la fila vieja completa.
ALTER TABLE public.global_chat REPLICA IDENTITY FULL;

-- 2) AJUSTE MANUAL DE PUNTOS -------------------------------------------------
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS points_adjustment INTEGER NOT NULL DEFAULT 0;
COMMENT ON COLUMN public.users.points_adjustment IS 'Ajuste manual del admin (bonus/penalización). Entra en total_points.';

-- El total autoritativo ahora incluye el ajuste manual.
CREATE OR REPLACE FUNCTION public.recompute_user_total(p_user_id uuid)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE public.users u
  SET total_points =
        COALESCE((
          SELECT SUM(COALESCE(points_earned, 0))
          FROM public.predictions
          WHERE user_id = p_user_id
        ), 0)
      + COALESCE((
          SELECT SUM(COALESCE(champion_points, 0) + COALESCE(top_scorer_points, 0))
          FROM public.tournament_predictions
          WHERE user_id = p_user_id
        ), 0)
      + COALESCE(u.points_adjustment, 0)
  WHERE u.id = p_user_id;
$$;

-- Recalcular todos una vez para que el ajuste (0 por defecto) quede consistente.
SELECT public.recompute_user_total(id) FROM public.users;

-- 3) ANUNCIOS ----------------------------------------------------------------
ALTER TABLE public.global_settings
  ADD COLUMN IF NOT EXISTS announcement TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS announcement_active BOOLEAN DEFAULT FALSE;

NOTIFY pgrst, 'reload schema';
