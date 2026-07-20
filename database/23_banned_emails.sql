-- =============================================================================
-- 23_banned_emails.sql
-- =============================================================================
-- Permite BANEAR correos: un correo baneado no puede volver a registrarse.
-- Se aplica con un trigger BEFORE INSERT en auth.users que rechaza el alta si
-- el correo está en la lista negra. El backend agrega/quita correos (service
-- role) y, opcionalmente, banea al borrar un usuario.
-- Idempotente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.banned_emails (
  email      TEXT PRIMARY KEY,            -- siempre en minúsculas/trim
  reason     TEXT,
  banned_by  UUID REFERENCES public.users(id) ON DELETE SET NULL,
  banned_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.banned_emails IS 'Correos bloqueados: no pueden registrarse de nuevo';

ALTER TABLE public.banned_emails ENABLE ROW LEVEL SECURITY;

-- Solo los admins pueden LEER la lista (el alta/baja se hace por service role).
DROP POLICY IF EXISTS "banned_emails_select_admin" ON public.banned_emails;
CREATE POLICY "banned_emails_select_admin"
  ON public.banned_emails FOR SELECT
  TO authenticated
  USING ((SELECT is_admin FROM public.users WHERE id = auth.uid()) = TRUE);

-- Trigger que rechaza el registro si el correo está baneado.
CREATE OR REPLACE FUNCTION public.reject_banned_signup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.banned_emails
    WHERE email = lower(btrim(NEW.email))
  ) THEN
    RAISE EXCEPTION 'Este correo está bloqueado y no puede registrarse.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_ban_check ON auth.users;
CREATE TRIGGER on_auth_user_ban_check
  BEFORE INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_banned_signup();

NOTIFY pgrst, 'reload schema';
