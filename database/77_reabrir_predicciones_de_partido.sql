-- =============================================================================
-- 77_reabrir_predicciones_de_partido.sql
-- Que el admin GLOBAL pueda reabrir las predicciones de UN partido ya
-- empezado. Agrega una columna con default false: ningún partido cambia de
-- comportamiento hasta que alguien la encienda a mano. Idempotente.
-- =============================================================================
--
-- QUÉ HABÍA Y QUÉ NO (comprobado antes de escribir esto):
--   · `tournaments.predictions_force_open` (migración 47) reabre SOLO las
--     predicciones globales —campeón, goleador, asistidor—, vía
--     `tournament_predictions_open()`. No toca las de partidos.
--   · `matches.score_locked` protege el RESULTADO de que el sync lo pise.
--     Nada que ver con predicciones.
--   · Las políticas `predictions_insert_admin`/`predictions_update_admin` ya
--     dejan al admin global escribir cualquier predicción sin límite de hora,
--     pero eso es que el admin escriba POR OTRO. No existía manera de
--     devolverle al jugador la posibilidad de corregir la suya.
--
-- PARA QUÉ SIRVE: ESPN a veces trae mal la hora del saque, o un partido se
-- pospone y se reprograma. Ahí la gente queda bloqueada por un error de los
-- datos, no por haberse dormido, y hoy no hay forma de devolverles la
-- predicción salvo que el admin la escriba a mano por cada persona.
--
-- ES POR PARTIDO A PROPÓSITO. Un interruptor por torneo reabriría también los
-- partidos ya jugados, y en una quiniela por plata eso no es "reabrir": es
-- dejar predecir con el resultado a la vista.
--
-- Y NO VALE EN PARTIDOS FINALIZADOS, por la misma razón: con el marcador ya
-- puesto no hay predicción posible, hay copia. La condición se comprueba en
-- la propia política, no con un CHECK: un CHECK reventaría el sync el día que
-- un partido reabierto termine, y además así la reapertura SE APAGA SOLA al
-- finalizar el partido —el admin no tiene que acordarse de nada, y el puntaje
-- se calcula al final con lo que haya, sin recálculo manual.

BEGIN;

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS predictions_force_open boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.matches.predictions_force_open IS
  'Solo el admin global. Reabre las predicciones de ESTE partido mientras esta '
  'EN CURSO; en un partido finalizado no tiene ningun efecto, asi que la '
  'reapertura se apaga sola cuando el partido termina. Mientras dura, las '
  'predicciones ajenas vuelven a taparse: la ventana reabierta se comporta como '
  'la de antes del saque en los dos sentidos.';

-- ── Escribir la propia predicción ─────────────────────────────────────────
-- Se ALTERAN las políticas existentes en vez de agregar otras: las permisivas
-- se combinan con OR, y apilar una más deja la regla real repartida en dos
-- sitios — que es justo como se coló el agujero que arregló la migración 65.
ALTER POLICY predictions_insert_own_unlocked ON public.predictions
  WITH CHECK (
    auth.uid() = user_id
    AND (SELECT (m.kickoff_at - '00:15:00'::interval) > now()
                OR (COALESCE(m.predictions_force_open, false)
                    AND m.status NOT IN ('finished', 'cancelled', 'postponed'))
         FROM public.matches m WHERE m.id = predictions.match_id)
  );

ALTER POLICY predictions_update_own_unlocked ON public.predictions
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND (SELECT (m.kickoff_at - '00:15:00'::interval) > now()
                OR (COALESCE(m.predictions_force_open, false)
                    AND m.status NOT IN ('finished', 'cancelled', 'postponed'))
         FROM public.matches m WHERE m.id = predictions.match_id)
  );

-- ── Y las ajenas se vuelven a tapar mientras dure ─────────────────────────
-- SIN ESTO LA REAPERTURA ES UN AGUJERO: pasados los 15 minutos las
-- predicciones de los demás ya están destapadas, así que quien entre a
-- corregir la suya vería antes la de sus rivales. Una ventana reabierta tiene
-- que comportarse como la de antes del saque EN LOS DOS SENTIDOS.
--
-- Efecto lateral aceptado: mientras el partido esté reabierto, su fila del
-- Histórico y del Cara a cara se ve tapada para los demás. Dura lo que dure el
-- partido —al finalizar la reapertura deja de valer y todo se destapa solo— y
-- es el precio de que la corrección sea limpia.
ALTER POLICY predictions_select_propia_o_de_mi_quiniela ON public.predictions
  USING (
    auth.uid() = user_id
    OR (
      public.puede_ver_quiniela(league_id)
      AND (SELECT (m.kickoff_at - '00:15:00'::interval) <= now()
                  AND NOT (COALESCE(m.predictions_force_open, false)
                           AND m.status NOT IN ('finished', 'cancelled', 'postponed'))
           FROM public.matches m WHERE m.id = predictions.match_id)
    )
  );

DO $verificar$
DECLARE v_default text; v_def text;
BEGIN
  -- La columna tiene que nacer APAGADA. Se comprueba el default, no que no
  -- haya ningún partido reabierto: en cuanto el admin use la función habrá
  -- alguno, y una comprobación así haría que volver a correr la migración
  -- fallara sin motivo. Mide el estado que debe ser cierto SIEMPRE.
  SELECT column_default INTO v_default
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'matches'
    AND column_name = 'predictions_force_open';

  IF v_default IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'predictions_force_open no nace apagada (default: %)', COALESCE(v_default, 'ninguno');
  END IF;

  -- Las tres políticas tienen que mencionar la columna: si alguna no la mira,
  -- la reapertura queda a medias y eso es peor que no tenerla.
  FOR v_def IN
    SELECT polname FROM pg_policy
    WHERE polrelid = 'public.predictions'::regclass
      AND polname IN ('predictions_insert_own_unlocked',
                      'predictions_update_own_unlocked',
                      'predictions_select_propia_o_de_mi_quiniela')
      AND COALESCE(pg_get_expr(polqual, polrelid), '') || COALESCE(pg_get_expr(polwithcheck, polrelid), '')
          NOT LIKE '%predictions_force_open%'
  LOOP
    RAISE EXCEPTION 'la politica % no mira predictions_force_open', v_def;
  END LOOP;

  RAISE NOTICE 'Reapertura por partido lista: nace apagada. Ninguna fila modificada.';
END $verificar$;

COMMIT;

NOTIFY pgrst, 'reload schema';
