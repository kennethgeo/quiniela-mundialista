-- =============================================================================
-- 104_alerta_de_puntajes_y_anonimizar_cuentas.sql
-- 28 sep 2026, a pedido del dueño (B60 y B59 del plan).
-- No modifica ni borra ninguna fila existente. Idempotente.
-- =============================================================================
--
-- 1. ALERTA DE PUNTAJES TRABADOS (B60).
--    La recuperación de la 91/92 reintenta un puntaje fallido durante 3 días y
--    después lo suelta SIN AVISAR: solo se veía si alguien corría la §17 de
--    `verificar_estado.sql`. En una quiniela por plata, un partido sin puntos
--    tiene que llegarle a alguien.
--    `reclamar_alertas_de_puntaje(horas)` devuelve los partidos que siguen en
--    `partidos_pendientes_de_puntaje()` (la MISMA lista que usa la
--    recuperación: no se escribe una segunda definición de «pendiente») desde
--    hace más de `horas`, y anota el aviso en `alertas_de_puntaje`. Un mismo
--    partido se avisa como mucho cada 20 horas: dentro de la ventana de 3 días
--    eso son 2 o 3 avisos, no uno por minuto.
--    El reclamo es atómico (`INSERT … ON CONFLICT DO UPDATE … WHERE`): dos
--    pasadas simultáneas del cron no avisan dos veces.
--    El push lo manda el backend (`/sync-live`) a los admins globales. Mientras
--    haya un puntaje pendiente la puerta del cron sigue abierta
--    (`hay_puntajes_pendientes`), así que el aviso sale DENTRO de la ventana,
--    antes de que la recuperación lo suelte.
--    LÍMITE, dicho: si el que falla es el backend entero (caído), tampoco
--    avisa. Eso lo cubren los logs del proveedor, no esto.
--
-- 2. ANONIMIZAR UNA CUENTA (B59).
--    Los RESTRICT de las migraciones 92, 94, 95 y 96 hacen imborrables a quien
--    tiene un pago confirmado, creó una quiniela, propuso o votó, o confirmó
--    pagos: borrar esa cuenta se llevaría constancias del grupo. Pero alguien
--    que pide irse tiene que poder irse.
--    `anonimizar_usuario(user_id)` borra lo PERSONAL y conserva lo HISTÓRICO:
--      · nombre → «Ex-miembro NNNN», sin foto, sin correo, `anonimizado_at`;
--      · borra sus suscripciones push (sus dispositivos dejan de recibir avisos);
--      · NO toca predicciones, puntos, membresías, pagos, votos ni propuestas:
--        la Tabla, el pozo y las votaciones siguen cuadrando.
--    El backend (`/api/admin/anonymize-user`) además BLOQUEA la cuenta en Auth
--    y le cambia el correo, así que no puede volver a entrar. Lo hace ANTES de
--    llamar a esta función: si Auth falla no se anonimiza nada; si esto falla
--    después, la cuenta ya no entra y reintentar es seguro (idempotente).
--    Solo `service_role`.
-- =============================================================================

BEGIN;

-- 1 ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.alertas_de_puntaje (
  match_id         integer PRIMARY KEY REFERENCES public.matches(id) ON DELETE CASCADE,
  primer_aviso_at  timestamptz NOT NULL DEFAULT now(),
  ultimo_aviso_at  timestamptz NOT NULL DEFAULT now(),
  avisos           integer NOT NULL DEFAULT 1
);
COMMENT ON TABLE public.alertas_de_puntaje IS
  'Cuándo se avisó a los admins de un puntaje trabado (migración 104). Evita repetir el aviso en cada pasada del cron.';

ALTER TABLE public.alertas_de_puntaje ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.alertas_de_puntaje FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.reclamar_alertas_de_puntaje(p_horas integer DEFAULT 6)
RETURNS TABLE (match_id integer, partido text, pendiente_desde timestamptz, avisos integer)
LANGUAGE sql
VOLATILE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH pendientes AS (
    SELECT m.id,
           m.home_team || ' vs ' || m.away_team AS partido,
           -- Desde cuándo espera: la marca del partido o, si lo que espera es
           -- una predicción corregida, la más vieja de esas.
           LEAST(
             CASE WHEN (CASE WHEN m.status = 'finished' THEN m.puntuado_con IS NULL
                             ELSE m.puntuado_con IS DISTINCT FROM 'anulado' END)
                  THEN COALESCE(m.puntaje_pendiente_desde, m.kickoff_at) END,
             (SELECT min(p.modificada_at) FROM public.predictions p
               WHERE p.match_id = m.id AND p.puntaje_pendiente)
           ) AS desde
    FROM public.matches m
    WHERE m.id IN (SELECT public.partidos_pendientes_de_puntaje())
  ),
  vencidos AS (
    SELECT * FROM pendientes
    WHERE desde IS NOT NULL AND desde < now() - make_interval(hours => GREATEST(p_horas, 1))
  ),
  anotados AS (
    INSERT INTO public.alertas_de_puntaje AS a (match_id)
    SELECT id FROM vencidos
    ON CONFLICT ON CONSTRAINT alertas_de_puntaje_pkey DO UPDATE
      SET ultimo_aviso_at = now(), avisos = a.avisos + 1
      WHERE a.ultimo_aviso_at < now() - interval '20 hours'
    RETURNING a.match_id, a.avisos
  )
  SELECT v.id, v.partido, v.desde, an.avisos
  FROM vencidos v JOIN anotados an ON an.match_id = v.id
  ORDER BY v.desde;
$$;

REVOKE ALL ON FUNCTION public.reclamar_alertas_de_puntaje(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reclamar_alertas_de_puntaje(integer) TO service_role;

-- 2 ---------------------------------------------------------------------------
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS anonimizado_at timestamptz;
COMMENT ON COLUMN public.users.anonimizado_at IS
  'Cuándo se anonimizó la cuenta (migración 104). Sus datos personales se borraron; su historial en las quinielas se conserva.';

CREATE OR REPLACE FUNCTION public.anonimizar_usuario(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_u      public.users%ROWTYPE;
  v_nombre text;
  v_push   integer;
BEGIN
  SELECT * INTO v_u FROM public.users WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuario no encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF v_u.is_admin THEN
    RAISE EXCEPTION 'No se anonimiza a un admin global' USING ERRCODE = '42501';
  END IF;

  -- Un nombre distinguible (la Tabla muestra a varios a la vez) que no dice
  -- quién era: los 4 primeros caracteres del id, que ya son públicos.
  v_nombre := 'Ex-miembro ' || upper(left(replace(p_user_id::text, '-', ''), 4));

  UPDATE public.users
     SET display_name   = v_nombre,
         avatar_url     = NULL,
         email          = NULL,
         anonimizado_at = COALESCE(anonimizado_at, now())
   WHERE id = p_user_id;

  DELETE FROM public.push_subscriptions WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_push = ROW_COUNT;

  RETURN jsonb_build_object('status', 'ok', 'nombre', v_nombre, 'push_borradas', v_push);
END;
$$;

REVOKE ALL ON FUNCTION public.anonimizar_usuario(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.anonimizar_usuario(uuid) TO service_role;

-- Comprobaciones ---------------------------------------------------------------
DO $comprobar$
BEGIN
  IF has_function_privilege('authenticated', 'public.reclamar_alertas_de_puntaje(integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.reclamar_alertas_de_puntaje(integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.anonimizar_usuario(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.anonimizar_usuario(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '104: una función de backend quedó ejecutable por el cliente';
  END IF;
  IF has_table_privilege('authenticated', 'public.alertas_de_puntaje', 'SELECT')
     OR has_table_privilege('anon', 'public.alertas_de_puntaje', 'SELECT') THEN
    RAISE EXCEPTION '104: el cliente puede leer alertas_de_puntaje';
  END IF;
  IF has_column_privilege('authenticated', 'public.users', 'anonimizado_at', 'UPDATE') THEN
    RAISE EXCEPTION '104: el cliente puede escribir users.anonimizado_at';
  END IF;
END
$comprobar$;

COMMIT;
