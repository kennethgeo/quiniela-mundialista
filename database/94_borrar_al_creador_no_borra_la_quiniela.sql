-- =============================================================================
-- 94 · Borrar la cuenta del creador ya no borra su quiniela
-- =============================================================================
-- Octava auditoría (24 sep 2026, hecha por Claude porque a Astra se le acabó
-- el uso). `leagues.admin_id` era `ON DELETE CASCADE`: borrar desde el panel la
-- cuenta de quien CREÓ una quiniela borraba la quiniela entera, con las
-- predicciones de todos sus miembros.
--
-- En Bundestica el candado de pagos de la 92 lo frenaba (la cascada llega a
-- league_members y ahí hay 13 pagos). Pero Champions 26-27 no tiene pagos:
-- 7 miembros y 289 predicciones que desaparecían con la cuenta de una persona.
-- `delete-user` solo miraba los pagos PROPIOS de esa cuenta.
--
-- Ahora es `ON DELETE RESTRICT`: la base rechaza borrar a un creador mientras
-- su quiniela exista. No hay traspaso de quinielas (migración 59), así que para
-- borrar esa cuenta primero hay que borrar la quiniela desde su Zona de peligro
-- —con la regla de pagos de la 89— y recién después la cuenta. `delete-user`
-- lo comprueba antes y responde 409 con el motivo.
--
-- No toca datos: cambia qué hace la FK al borrar. Validarla es trivial porque
-- la FK ya existía y todos los `admin_id` apuntan a usuarios que existen.
-- =============================================================================

BEGIN;

ALTER TABLE public.leagues DROP CONSTRAINT IF EXISTS leagues_admin_id_fkey;
ALTER TABLE public.leagues
  ADD CONSTRAINT leagues_admin_id_fkey
  FOREIGN KEY (admin_id) REFERENCES public.users(id) ON DELETE RESTRICT;

DO $$
BEGIN
  IF (SELECT confdeltype FROM pg_constraint
       WHERE conname = 'leagues_admin_id_fkey' AND conrelid = 'public.leagues'::regclass) <> 'r' THEN
    RAISE EXCEPTION 'borrar al creador sigue borrando su quiniela';
  END IF;
  RAISE NOTICE '94 OK';
END $$;

COMMIT;
