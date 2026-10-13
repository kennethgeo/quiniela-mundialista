-- =============================================================================
-- 109_bitacora_de_pagos_y_permisos_por_defecto.sql
-- Vigésima auditoría (Claude, 11–12 oct 2026), ítems 2.1, 4.1, 5.1 y 5.5.
-- No modifica ni borra ninguna fila existente: una tabla nueva (con una COPIA
-- de los pagos confirmados de hoy), triggers, políticas y permisos. El bloque
-- final lo comprueba con una huella de `league_members` y de `users` tomada al
-- empezar. Idempotente: corre dos veces seguidas.
-- =============================================================================
--
-- 1. [MEDIA · 2.1] NO EXISTÍA NINGÚN HISTORIAL DE PAGOS.
--    El pago son columnas de `league_members` (migración 58/88), así que:
--      · «Quitar» un pago (`confirmar_pago(..., false)`) pone en NULL fecha,
--        quién dio fe, monto y moneda, y no queda nada. Volver a confirmar
--        graba la fecha de HOY, al admin que tocó y la cuota VIGENTE.
--      · Expulsar a quien pagó (la excepción B10 de la 92) borra la fila, y
--        con ella el pago. Un co-admin podía hacérselo al otro co-admin
--        (reproducido revertido en producción: recaudado 120.000 → 110.000).
--    Expuestos: los 13 pagos de Bundestica (₡130.000), por 3 personas.
--    Arreglo (opción C del informe, decidida por el dueño): `historial_pagos`,
--    una bitácora SOLO DE INSERCIÓN que llenan dos triggers de
--    `league_members`:
--      · AFTER UPDATE, cuando cambia el pago: 'confirmado' (con el monto, la
--        moneda y quién confirmó) o 'quitado' (con lo que había y quién lo
--        quitó). Si se reescribe un pago ya confirmado, quedan las dos filas.
--      · AFTER DELETE de una fila con pago confirmado: 'borrado'. Es AFTER a
--        propósito: si el candado de la 92 frena el borrado, no se anota nada
--        que no pasó.
--    No tiene claves foráneas (como `compensaciones_x2`, 103): no se la lleva
--    ninguna cascada. La leen los miembros de esa quiniela y el admin global
--    (`puede_ver_quiniela`, la misma regla que el pozo). Nadie la escribe
--    desde el cliente, y un trigger rechaza UPDATE, DELETE y TRUNCATE incluso
--    al dueño de la base: para corregir algo se agrega una fila, no se pisa.
--    `por` es `auth.uid()`: NULL cuando lo hizo el backend o el panel SQL.
--    Se siembra con una COPIA de los pagos confirmados de hoy (marcadas
--    `sembrada`, con la fecha y el autor de la confirmación original). No se
--    toca `league_members`: el bloque final compara su huella.
--    Esto NO cambia ningún flujo: se puede seguir quitando y expulsando. Lo
--    que cambia es que queda constancia.
--    ORDEN DE DESPLIEGUE: la pantalla del pozo y el aviso de expulsar ya dicen
--    «queda registrado en el historial». Aplicar la 109 antes o junto con el
--    frontend; sin ella, abrir «Historial de pagos» muestra el error (dicho,
--    no un spinner) y lo demás funciona igual.
--
-- 2. [MEDIA · 4.1] LAS PREDICCIONES SEGUÍAN ABIERTAS CON EL PARTIDO EN JUEGO
--    si el saque guardado era más tarde que el real. ESPN y UNAFUT difieren en
--    20 de los 41 partidos pendientes, y en 9 ESPN es MÁS TARDE: el cierre (y
--    el destape) dependen de ese saque. La política de escritura excluía
--    terminado/cancelado/pospuesto pero NO `in_progress`. Ahora la rama normal
--    exige además que el partido no esté en juego; con el sync marcando
--    `in_progress` en cuanto ESPN dice que empezó, la puerta se cierra aunque
--    el horario esté mal. La rama forzada ya exigía `pending` (105).
--    `ALTER POLICY` y no `DROP`+`CREATE`: el resto queda idéntico a lo que
--    hay en producción (leído con `pg_policies` el 12 oct 2026). Ensayado
--    allá, revertido: quitando `'in_progress'` del texto nuevo, las cuatro
--    políticas de `predictions` quedan idénticas a las de antes.
--    Límite, dicho: cierra cuando el sync marca `in_progress`, o sea con el
--    retraso del sync (≤ 1 min con el cron) y solo si ESPN dice que empezó.
--    La LECTURA no se toca: sigue destapando por el saque y por
--    `destapado_at`, y no esconde nada de un partido en vivo que hoy se vea.
--
-- 3. [MEDIA · 5.1] TODO OBJETO NUEVO NACÍA ABIERTO.
--    `pg_default_acl` de producción (rol postgres): funciones
--    `{postgres, anon, authenticated, service_role}=X` en `public`, y además
--    el EXECUTE implícito de PUBLIC (el global, que la 61 no quitaba porque lo
--    revocó solo `IN SCHEMA`); tablas `anon=rm`, `authenticated=arwdm`;
--    secuencias `anon=rwU`, `authenticated=rwU`. O sea: una función nueva
--    nacía ejecutable por cualquiera sin cuenta, aunque fuera SECURITY
--    DEFINER, y una tabla nueva sin RLS nacía escribible por los usuarios.
--    Hoy no hay nada abierto porque cada migración revoca a mano; la próxima
--    que lo olvide quedaba expuesta. Ahora nace cerrado y cada migración
--    OTORGA lo que la app necesita (que es lo que ya hacen todas).
--    `service_role` conserva sus privilegios por defecto: el backend no
--    cambia. `authenticated` conserva SELECT en tablas nuevas (gobernado por
--    la RLS) y USAGE en secuencias (para que un INSERT permitido funcione).
--    Ensayado en producción (12 oct 2026, revertido): una función nueva nace
--    `{postgres=X, service_role=X}`, una tabla `authenticated=r` y una
--    secuencia `authenticated=rU`. OJO: esto cubre lo que crea `postgres`
--    (migraciones y editor SQL). Lo que crea `supabase_admin` sigue naciendo
--    abierto en `public` y `postgres` no puede cambiarlo; no lo usa nadie acá.
--    Y el `REVOKE … FROM PUBLIC` global vale para TODOS los esquemas: una
--    función que `postgres` cree fuera de `public` tampoco nace ejecutable por
--    PUBLIC; si alguna vez hace falta, se otorga a mano.
--
-- 4. [BAJA · 5.5] HIGIENE.
--    · MAINTAIN (PostgreSQL 17: VACUUM/ANALYZE/REINDEX/LOCK) lo tenían anon y
--      authenticated sobre las tablas, como el TRUNCATE que quitó la 102.
--      Con él se puede tomar un LOCK ACCESS EXCLUSIVE sobre una tabla que solo
--      se puede leer. Va en un bloque condicionado a la versión: en un
--      Postgres 16 la palabra no existe.
--    · TRUNCATE de `service_role` sobre `league_members` y `leagues`: los
--      triggers de fila (el candado de pagos de la 92) no corren con TRUNCATE.
--      El backend nunca vacía tablas (comprobado con grep).
--    · `users_update_admin` (creada a mano en el panel, TO public, por
--      `is_admin`) dejaba al admin global reescribir el nombre o la foto de
--      cualquier cuenta desde el navegador y sin rastro. La app no la usa: el
--      panel renombra por el backend (`/api/admin/update-user`).
--    · «Permitir lectura de usuarios a todos» (TO public, USING true, también
--      a mano): no servía de nada —anon no tiene columnas de `users`— y
--      quedaría abierta si alguien vuelve a correr un GRANT. Lo que la app
--      necesita (leer nombres y fotos ajenos para la Tabla y el ranking) lo da
--      `users_select_authenticated`, que se crea si faltara.
--    · La lectura pública de `matches` se deja como está (decisión del dueño
--      pendiente; son datos públicos de fútbol).
-- =============================================================================

BEGIN;

-- Si una tabla caliente está tomada (un guardado largo, el sync), mejor fallar
-- y reintentar que quedar en la cola con un candado exclusivo pedido: mientras
-- espera, bloquea a todos los que lleguen después, lecturas incluidas.
SET LOCAL lock_timeout = '10s';

-- Huella de lo que NO se puede tocar ------------------------------------------
SELECT set_config('m109.huella_miembros',
         COALESCE((SELECT md5(string_agg(lm::text, '|' ORDER BY lm.league_id, lm.user_id))
                     FROM public.league_members lm), 'vacia'), true),
       set_config('m109.huella_usuarios',
         COALESCE((SELECT md5(string_agg(u::text, '|' ORDER BY u.id)) FROM public.users u), 'vacia'), true),
       set_config('m109.predicciones',
         (SELECT count(*) FROM public.predictions)::text, true);

-- 3 (va primero: lo que crea esta misma migración ya nace cerrado) ------------
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE UPDATE ON SEQUENCES FROM authenticated;

-- 4 (MAINTAIN solo existe desde PostgreSQL 17) --------------------------------
DO $maintain$
BEGIN
  IF current_setting('server_version_num')::int >= 170000 THEN
    EXECUTE 'REVOKE MAINTAIN ON ALL TABLES IN SCHEMA public FROM anon, authenticated';
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE MAINTAIN ON TABLES FROM authenticated';
  END IF;
END
$maintain$;

REVOKE TRUNCATE ON public.league_members, public.leagues FROM service_role;

DROP POLICY IF EXISTS users_update_admin ON public.users;
DO $lectura_users$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public' AND tablename = 'users'
                    AND policyname = 'users_select_authenticated') THEN
    CREATE POLICY users_select_authenticated ON public.users
      FOR SELECT TO authenticated USING (true);
  END IF;
END
$lectura_users$;
DROP POLICY IF EXISTS "Permitir lectura de usuarios a todos" ON public.users;

-- 1 ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.historial_pagos (
  id                      bigserial PRIMARY KEY,
  league_id               uuid NOT NULL,
  user_id                 uuid NOT NULL,
  accion                  text NOT NULL CHECK (accion IN ('confirmado', 'quitado', 'borrado')),
  monto                   numeric,
  moneda                  text,
  por                     uuid,
  confirmado_at_original  timestamptz,
  confirmado_por_original uuid,
  sembrada                boolean NOT NULL DEFAULT false,
  created_at              timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.historial_pagos IS
  'Cada confirmación, anulación o borrado de un pago de quiniela. Solo inserción, sin claves foráneas: sobrevive a expulsiones y borrados (migración 109).';
COMMENT ON COLUMN public.historial_pagos.por IS
  'Quién hizo el cambio (auth.uid()). NULL = backend o panel SQL.';
COMMENT ON COLUMN public.historial_pagos.sembrada IS
  'Copia de un pago que ya estaba confirmado al aplicar la 109 (created_at = la confirmación original).';

CREATE INDEX IF NOT EXISTS historial_pagos_liga_idx    ON public.historial_pagos (league_id, created_at DESC);
CREATE INDEX IF NOT EXISTS historial_pagos_persona_idx ON public.historial_pagos (league_id, user_id);

ALTER TABLE public.historial_pagos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.historial_pagos FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.historial_pagos TO authenticated, service_role;
REVOKE ALL ON SEQUENCE public.historial_pagos_id_seq FROM PUBLIC, anon, authenticated, service_role;

DROP POLICY IF EXISTS historial_pagos_select_de_mi_quiniela ON public.historial_pagos;
CREATE POLICY historial_pagos_select_de_mi_quiniela ON public.historial_pagos
  FOR SELECT TO authenticated USING (puede_ver_quiniela(league_id));

CREATE OR REPLACE FUNCTION public.registrar_historial_pago()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_por uuid := auth.uid();
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Solo llega acá un borrado que de verdad pasó (AFTER): hoy, la expulsión
    -- (B10). El candado de la 92 frena todas las demás puertas.
    INSERT INTO public.historial_pagos
      (league_id, user_id, accion, monto, moneda, por, confirmado_at_original, confirmado_por_original)
    VALUES (OLD.league_id, OLD.user_id, 'borrado', OLD.pago_confirmado_monto, OLD.pago_confirmado_moneda,
            v_por, OLD.pago_confirmado_at, OLD.pago_confirmado_por);
    RETURN OLD;
  END IF;

  -- UPDATE (el WHEN del trigger garantiza que el pago cambió).
  IF OLD.pago_confirmado_at IS NOT NULL THEN
    -- Lo que había deja de valer tal como estaba: se quitó o se reescribió.
    INSERT INTO public.historial_pagos
      (league_id, user_id, accion, monto, moneda, por, confirmado_at_original, confirmado_por_original)
    VALUES (OLD.league_id, OLD.user_id, 'quitado', OLD.pago_confirmado_monto, OLD.pago_confirmado_moneda,
            v_por, OLD.pago_confirmado_at, OLD.pago_confirmado_por);
  END IF;
  IF NEW.pago_confirmado_at IS NOT NULL THEN
    INSERT INTO public.historial_pagos
      (league_id, user_id, accion, monto, moneda, por, confirmado_at_original, confirmado_por_original)
    VALUES (NEW.league_id, NEW.user_id, 'confirmado', NEW.pago_confirmado_monto, NEW.pago_confirmado_moneda,
            v_por, NEW.pago_confirmado_at, NEW.pago_confirmado_por);
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.registrar_historial_pago() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS historial_pago_al_cambiar ON public.league_members;
CREATE TRIGGER historial_pago_al_cambiar
  AFTER UPDATE ON public.league_members
  FOR EACH ROW
  WHEN ((OLD.pago_confirmado_at, OLD.pago_confirmado_por, OLD.pago_confirmado_monto, OLD.pago_confirmado_moneda)
        IS DISTINCT FROM
        (NEW.pago_confirmado_at, NEW.pago_confirmado_por, NEW.pago_confirmado_monto, NEW.pago_confirmado_moneda))
  EXECUTE FUNCTION public.registrar_historial_pago();

DROP TRIGGER IF EXISTS historial_pago_al_borrar ON public.league_members;
CREATE TRIGGER historial_pago_al_borrar
  AFTER DELETE ON public.league_members
  FOR EACH ROW
  WHEN (OLD.pago_confirmado_at IS NOT NULL)
  EXECUTE FUNCTION public.registrar_historial_pago();

CREATE OR REPLACE FUNCTION public.historial_pagos_no_se_toca()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  RAISE EXCEPTION 'El historial de pagos no se modifica ni se borra: es la constancia de lo que pasó con la plata. Para corregir, se agrega una fila.';
END;
$function$;
REVOKE ALL ON FUNCTION public.historial_pagos_no_se_toca() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS historial_pagos_no_se_toca ON public.historial_pagos;
CREATE TRIGGER historial_pagos_no_se_toca
  BEFORE UPDATE OR DELETE ON public.historial_pagos
  FOR EACH ROW EXECUTE FUNCTION public.historial_pagos_no_se_toca();
DROP TRIGGER IF EXISTS historial_pagos_no_se_vacia ON public.historial_pagos;
CREATE TRIGGER historial_pagos_no_se_vacia
  BEFORE TRUNCATE ON public.historial_pagos
  FOR EACH STATEMENT EXECUTE FUNCTION public.historial_pagos_no_se_toca();

-- Siembra: una COPIA de cada pago confirmado que todavía no tenga su fila.
-- Una segunda corrida no copia nada (ya están) y la cuenta igual cierra.
SELECT set_config('m109.confirmados',
         (SELECT count(*) FROM public.league_members WHERE pago_confirmado_at IS NOT NULL)::text, true);
WITH copiadas AS (
  INSERT INTO public.historial_pagos
    (league_id, user_id, accion, monto, moneda, por, confirmado_at_original, confirmado_por_original,
     sembrada, created_at)
  SELECT lm.league_id, lm.user_id, 'confirmado', lm.pago_confirmado_monto, lm.pago_confirmado_moneda,
         lm.pago_confirmado_por, lm.pago_confirmado_at, lm.pago_confirmado_por, true, lm.pago_confirmado_at
    FROM public.league_members lm
   WHERE lm.pago_confirmado_at IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.historial_pagos h
                      WHERE h.league_id = lm.league_id AND h.user_id = lm.user_id
                        AND h.accion = 'confirmado'
                        AND h.confirmado_at_original = lm.pago_confirmado_at)
  RETURNING 1
)
SELECT set_config('m109.copiadas', (SELECT count(*) FROM copiadas)::text, true);

-- 2 ---------------------------------------------------------------------------
ALTER POLICY predictions_insert_own_unlocked ON public.predictions
  WITH CHECK ((auth.uid() = user_id) AND is_league_member(league_id) AND (EXISTS ( SELECT 1
     FROM (matches m
       JOIN leagues l ON ((l.tournament_id = m.tournament_id)))
    WHERE ((m.id = predictions.match_id) AND (l.id = predictions.league_id)))) AND ( SELECT ((((m.kickoff_at - '00:15:00'::interval) > now()) AND (m.destapado_at IS NULL) AND (m.status <> ALL (ARRAY['finished'::text, 'cancelled'::text, 'postponed'::text, 'in_progress'::text]))) OR (COALESCE(m.predictions_force_open, false) AND (m.status = 'pending'::text)))
     FROM matches m
    WHERE (m.id = predictions.match_id)));

ALTER POLICY predictions_update_own_unlocked ON public.predictions
  USING ((auth.uid() = user_id) AND ( SELECT ((((m.kickoff_at - '00:15:00'::interval) > now()) AND (m.destapado_at IS NULL) AND (m.status <> ALL (ARRAY['finished'::text, 'cancelled'::text, 'postponed'::text, 'in_progress'::text]))) OR (COALESCE(m.predictions_force_open, false) AND (m.status = 'pending'::text)))
     FROM matches m
    WHERE (m.id = predictions.match_id)))
  WITH CHECK ((auth.uid() = user_id) AND is_league_member(league_id) AND (EXISTS ( SELECT 1
     FROM (matches m
       JOIN leagues l ON ((l.tournament_id = m.tournament_id)))
    WHERE ((m.id = predictions.match_id) AND (l.id = predictions.league_id)))) AND ( SELECT ((((m.kickoff_at - '00:15:00'::interval) > now()) AND (m.destapado_at IS NULL) AND (m.status <> ALL (ARRAY['finished'::text, 'cancelled'::text, 'postponed'::text, 'in_progress'::text]))) OR (COALESCE(m.predictions_force_open, false) AND (m.status = 'pending'::text)))
     FROM matches m
    WHERE (m.id = predictions.match_id)));

-- Comprobaciones ---------------------------------------------------------------
DO $comprobar$
DECLARE
  n int; v_cubiertos int; v_confirmados int := current_setting('m109.confirmados')::int;
  v_liga uuid; v_persona uuid; v_antes int; b boolean;
BEGIN
  -- Nada existente cambió.
  IF COALESCE((SELECT md5(string_agg(lm::text, '|' ORDER BY lm.league_id, lm.user_id))
                 FROM public.league_members lm), 'vacia') <> current_setting('m109.huella_miembros') THEN
    RAISE EXCEPTION '109: league_members cambió'; END IF;
  IF COALESCE((SELECT md5(string_agg(u::text, '|' ORDER BY u.id)) FROM public.users u), 'vacia')
     <> current_setting('m109.huella_usuarios') THEN
    RAISE EXCEPTION '109: users cambió'; END IF;
  IF (SELECT count(*) FROM public.predictions)::text <> current_setting('m109.predicciones') THEN
    RAISE EXCEPTION '109: predictions cambió'; END IF;

  -- 1. Cada pago confirmado tiene su fila, y la siembra copió lo que faltaba.
  SELECT count(*) INTO v_cubiertos FROM public.league_members lm
   WHERE lm.pago_confirmado_at IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.historial_pagos h
                  WHERE h.league_id = lm.league_id AND h.user_id = lm.user_id
                    AND h.accion = 'confirmado' AND h.confirmado_at_original = lm.pago_confirmado_at
                    AND h.monto IS NOT DISTINCT FROM lm.pago_confirmado_monto);
  IF v_cubiertos <> v_confirmados THEN
    RAISE EXCEPTION '109: el historial cubre % de % pagos confirmados', v_cubiertos, v_confirmados; END IF;
  IF current_setting('m109.copiadas')::int > v_confirmados THEN
    RAISE EXCEPTION '109: se copiaron % filas para % pagos', current_setting('m109.copiadas'), v_confirmados; END IF;

  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.historial_pagos'::regclass) THEN
    RAISE EXCEPTION '109: historial_pagos sin RLS'; END IF;
  IF has_table_privilege('anon', 'public.historial_pagos', 'SELECT')
     OR has_table_privilege('authenticated', 'public.historial_pagos', 'INSERT')
     OR has_table_privilege('authenticated', 'public.historial_pagos', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.historial_pagos', 'DELETE')
     OR has_table_privilege('authenticated', 'public.historial_pagos', 'TRUNCATE')
     OR has_table_privilege('service_role', 'public.historial_pagos', 'INSERT')
     OR has_table_privilege('service_role', 'public.historial_pagos', 'UPDATE')
     OR has_table_privilege('service_role', 'public.historial_pagos', 'DELETE')
     OR has_table_privilege('service_role', 'public.historial_pagos', 'TRUNCATE')
     OR has_function_privilege('authenticated', 'public.registrar_historial_pago()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.registrar_historial_pago()', 'EXECUTE') THEN
    RAISE EXCEPTION '109: el historial quedó escribible desde afuera'; END IF;
  IF NOT has_table_privilege('authenticated', 'public.historial_pagos', 'SELECT') THEN
    RAISE EXCEPTION '109: el grupo no puede leer el historial'; END IF;

  -- Los triggers ANOTAN de verdad (sobre un pago real, en un sub-bloque que se
  -- revierte entero: no queda ni el cambio ni la fila).
  SELECT league_id, user_id INTO v_liga, v_persona FROM public.league_members
   WHERE pago_confirmado_at IS NOT NULL ORDER BY league_id, user_id LIMIT 1;
  IF v_liga IS NOT NULL THEN
    BEGIN
      SELECT count(*) INTO v_antes FROM public.historial_pagos;
      UPDATE public.league_members SET pago_confirmado_at = NULL, pago_confirmado_por = NULL,
             pago_confirmado_monto = NULL, pago_confirmado_moneda = NULL
       WHERE league_id = v_liga AND user_id = v_persona;
      IF (SELECT count(*) FROM public.historial_pagos
           WHERE league_id = v_liga AND user_id = v_persona AND accion = 'quitado') = 0 THEN
        RAISE EXCEPTION '109: quitar un pago no dejó rastro'; END IF;
      UPDATE public.league_members SET pago_confirmado_at = now(), pago_confirmado_monto = 1
       WHERE league_id = v_liga AND user_id = v_persona;
      PERFORM set_config('quiniela.expulsion_con_pago', 'on', true);
      DELETE FROM public.league_members WHERE league_id = v_liga AND user_id = v_persona;
      PERFORM set_config('quiniela.expulsion_con_pago', 'off', true);
      IF (SELECT count(*) FROM public.historial_pagos) <> v_antes + 3 THEN
        RAISE EXCEPTION '109: quitar + confirmar + borrar dejó % filas, no 3',
          (SELECT count(*) FROM public.historial_pagos) - v_antes; END IF;
      BEGIN
        DELETE FROM public.historial_pagos WHERE league_id = v_liga;
        RAISE EXCEPTION '109: el historial se dejó borrar';
      EXCEPTION WHEN raise_exception THEN
        IF SQLERRM LIKE '109:%' THEN RAISE; END IF;
      END;
      RAISE EXCEPTION 'M109_OK';
    EXCEPTION WHEN raise_exception THEN
      PERFORM set_config('quiniela.expulsion_con_pago', 'off', true);
      IF SQLERRM <> 'M109_OK' THEN RAISE; END IF;
    END;
  END IF;

  -- 2. Escribir predicciones exige que el partido no esté en juego.
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'predictions'
     AND policyname IN ('predictions_insert_own_unlocked', 'predictions_update_own_unlocked')
     AND COALESCE(with_check, '') ILIKE '%in_progress%'
     AND COALESCE(with_check, '') ILIKE '%destapado_at IS NULL%'
     AND (cmd = 'INSERT' OR COALESCE(qual, '') ILIKE '%in_progress%');
  IF n <> 2 THEN RAISE EXCEPTION '109: la escritura de predicciones no cierra con el partido en juego'; END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'predictions'
              AND cmd = 'SELECT' AND COALESCE(qual, '') ILIKE '%in_progress%') THEN
    RAISE EXCEPTION '109: se tocó la lectura de predicciones'; END IF;

  -- 3. Privilegios por defecto: nada para anon, ni EXECUTE para PUBLIC.
  IF EXISTS (SELECT 1 FROM pg_default_acl d, aclexplode(d.defaclacl) a
              WHERE d.defaclrole = 'postgres'::regrole
                AND (d.defaclnamespace = 0 OR d.defaclnamespace = 'public'::regnamespace)
                AND (a.grantee = 'anon'::regrole
                     OR (d.defaclobjtype = 'f' AND a.grantee IN (0::oid, 'authenticated'::regrole::oid))
                     OR (d.defaclobjtype = 'r' AND a.grantee = 'authenticated'::regrole
                         AND a.privilege_type NOT IN ('SELECT'))
                     OR (d.defaclobjtype = 'S' AND a.grantee = 'authenticated'::regrole
                         AND a.privilege_type = 'UPDATE'))) THEN
    RAISE EXCEPTION '109: pg_default_acl sigue concediendo de más al cliente'; END IF;
  -- Sin fila global de funciones, PUBLIC conserva el EXECUTE implícito.
  IF NOT EXISTS (SELECT 1 FROM pg_default_acl d
                  WHERE d.defaclrole = 'postgres'::regrole AND d.defaclnamespace = 0
                    AND d.defaclobjtype = 'f') THEN
    RAISE EXCEPTION '109: falta el privilegio por defecto global (EXECUTE de PUBLIC)'; END IF;

  -- …y comprobado creando objetos de verdad (se borran enseguida).
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION '109: corré la migración como postgres (los privilegios por defecto son de ese rol)'; END IF;
  EXECUTE 'CREATE FUNCTION public.zz_109_prueba() RETURNS int LANGUAGE sql SECURITY DEFINER AS $f$ SELECT 1 $f$';
  EXECUTE 'CREATE TABLE public.zz_109_prueba (id bigserial PRIMARY KEY, x int)';
  IF has_function_privilege('anon', 'public.zz_109_prueba()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.zz_109_prueba()', 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                 WHERE p.oid = 'public.zz_109_prueba()'::regprocedure AND a.grantee = 0) THEN
    RAISE EXCEPTION '109: una función nueva nace ejecutable por el cliente'; END IF;
  IF NOT has_function_privilege('service_role', 'public.zz_109_prueba()', 'EXECUTE') THEN
    RAISE EXCEPTION '109: se le quitó de más al backend'; END IF;
  IF has_table_privilege('anon', 'public.zz_109_prueba', 'SELECT')
     OR has_table_privilege('anon', 'public.zz_109_prueba', 'INSERT')
     OR has_table_privilege('authenticated', 'public.zz_109_prueba', 'INSERT')
     OR has_table_privilege('authenticated', 'public.zz_109_prueba', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.zz_109_prueba', 'DELETE')
     OR has_table_privilege('authenticated', 'public.zz_109_prueba', 'TRUNCATE')
     OR has_sequence_privilege('anon', 'public.zz_109_prueba_id_seq', 'USAGE')
     OR has_sequence_privilege('authenticated', 'public.zz_109_prueba_id_seq', 'UPDATE') THEN
    RAISE EXCEPTION '109: una tabla nueva nace abierta al cliente'; END IF;
  IF current_setting('server_version_num')::int >= 170000 THEN
    EXECUTE $q$SELECT has_table_privilege('authenticated', 'public.zz_109_prueba', 'MAINTAIN')
                   OR has_table_privilege('anon', 'public.zz_109_prueba', 'MAINTAIN')$q$ INTO b;
    IF b THEN RAISE EXCEPTION '109: una tabla nueva nace con MAINTAIN para el cliente'; END IF;
  END IF;
  EXECUTE 'DROP TABLE public.zz_109_prueba';
  EXECUTE 'DROP FUNCTION public.zz_109_prueba()';

  -- 4. Higiene.
  IF current_setting('server_version_num')::int >= 170000 THEN
    EXECUTE $q$SELECT count(*)::int FROM pg_class c
                 WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'v', 'm', 'p')
                   AND (has_table_privilege('anon', c.oid, 'MAINTAIN')
                        OR has_table_privilege('authenticated', c.oid, 'MAINTAIN'))$q$ INTO n;
    IF n > 0 THEN RAISE EXCEPTION '109: % tablas con MAINTAIN para el cliente', n; END IF;
  END IF;
  IF has_table_privilege('service_role', 'public.league_members', 'TRUNCATE')
     OR has_table_privilege('service_role', 'public.leagues', 'TRUNCATE') THEN
    RAISE EXCEPTION '109: service_role todavía puede vaciar membresías o quinielas'; END IF;
  IF NOT has_table_privilege('service_role', 'public.league_members', 'DELETE') THEN
    RAISE EXCEPTION '109: se le quitó al backend un permiso que usa'; END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'users'
              AND policyname IN ('users_update_admin', 'Permitir lectura de usuarios a todos')) THEN
    RAISE EXCEPTION '109: quedan políticas a mano en users'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'users'
                  AND cmd = 'SELECT' AND 'authenticated' = ANY (roles) AND qual = 'true') THEN
    RAISE EXCEPTION '109: los usuarios ya no pueden leer los nombres de los demás'; END IF;
END
$comprobar$;

COMMIT;
