-- =============================================================================
-- 24_fix_orphan_global_preds.sql
-- =============================================================================
-- Las predicciones globales (tournament_predictions) apuntaban a auth.users, así
-- que al borrar un usuario por la vía de public.users quedaban HUÉRFANAS y
-- seguían saliendo en la portada como "Jugador".
--
--   1) Borra las huérfanas actuales.
--   2) Reapunta la FK a public.users ON DELETE CASCADE, para que borrar el perfil
--      también borre su predicción global (y ya no vuelvan a quedar huérfanas).
-- Idempotente.
-- =============================================================================

-- 1) Limpiar huérfanas (usuarios que ya no existen en public.users).
DELETE FROM public.tournament_predictions tp
WHERE NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = tp.user_id);

-- 2) Reapuntar la llave foránea a public.users con CASCADE.
-- Se elimina cualquier FK existente sobre user_id (sin depender del nombre) y se
-- crea la nueva hacia public.users.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.tournament_predictions'::regclass
      AND contype = 'f'
      AND pg_get_constraintdef(oid) ILIKE 'FOREIGN KEY (user_id)%'
  LOOP
    EXECUTE format('ALTER TABLE public.tournament_predictions DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.tournament_predictions
  ADD CONSTRAINT tournament_predictions_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

NOTIFY pgrst, 'reload schema';
