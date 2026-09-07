-- =============================================================================
-- 71_predicciones_globales_por_quiniela.sql
-- Quita el UNIQUE (user_id) que impedía tener predicciones globales en más de
-- una quiniela. SOLO LECTURA sobre los datos: no inserta, actualiza ni borra.
-- Idempotente.
-- =============================================================================
--
-- EL SÍNTOMA. Al guardar campeón/goleador/asistidor en una segunda quiniela:
--
--   duplicate key value violates unique constraint
--   "tournament_predictions_user_id_key"
--
-- LA CAUSA. La tabla nació en 05_tournament_predictions.sql cuando había UN
-- solo torneo y una sola quiniela, con `user_id ... UNIQUE`. Eso limita a UNA
-- predicción global por persona EN TODA LA APP.
--
-- La migración 27 se escribió justamente para soltarla, y NUNCA SE CORRIÓ:
-- en producción sigue existiendo tournament_predictions_user_id_key y NO
-- existe el tournament_predictions_user_tournament_key que la 27 agregaba.
-- Es la deriva que CLAUDE.md ya nombra: las migraciones se aplican a mano y
-- schema.sql dejó de describir la base.
--
-- POR QUÉ NO SE HACE LO QUE PEDÍA LA 27. Aquella iba a poner
-- UNIQUE (user_id, tournament_id). Hoy eso sería un error: las predicciones
-- globales son POR QUINIELA, y dos quinielas pueden compartir torneo — la liga
-- tica corre temporada tras temporada sobre el mismo tournament_id. Con esa
-- restricción, quien estuviera en dos quinielas del mismo torneo no podría
-- predecir en la segunda: el mismo bug con otra ropa.
--
-- La restricción correcta, UNIQUE (user_id, league_id), YA EXISTE
-- (tournament_predictions_user_league_key, migración 37) y es a la que apunta
-- el upsert del cliente (`onConflict: 'user_id, league_id'`). Acá solo sobra la
-- vieja.

DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.tournament_predictions'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) = 'UNIQUE (user_id)'
  LOOP
    EXECUTE format('ALTER TABLE public.tournament_predictions DROP CONSTRAINT %I', c.conname);
    RAISE NOTICE 'Quitada la restricción sobrante %', c.conname;
  END LOOP;
END $$;

-- La que sí debe quedar. Si faltara, se crea; si ya está, no se toca.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.tournament_predictions'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) = 'UNIQUE (user_id, league_id)'
  ) THEN
    ALTER TABLE public.tournament_predictions
      ADD CONSTRAINT tournament_predictions_user_league_key UNIQUE (user_id, league_id);
    RAISE NOTICE 'Creada la restricción por quiniela';
  END IF;
END $$;

-- Comprobación. Falla en vez de avisar: una base a medio arreglar es peor,
-- porque el error vuelve a aparecer sin que nadie sepa por qué.
DO $verificar$
DECLARE
  v_sobrante boolean;
  v_correcta boolean;
  v_duplicados integer;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.tournament_predictions'::regclass AND contype = 'u'
      AND pg_get_constraintdef(oid) = 'UNIQUE (user_id)') INTO v_sobrante;

  SELECT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.tournament_predictions'::regclass AND contype = 'u'
      AND pg_get_constraintdef(oid) = 'UNIQUE (user_id, league_id)') INTO v_correcta;

  SELECT count(*) INTO v_duplicados FROM (
    SELECT 1 FROM public.tournament_predictions
    GROUP BY user_id, league_id HAVING count(*) > 1
  ) d;

  IF v_sobrante THEN
    RAISE EXCEPTION 'Sigue existiendo UNIQUE (user_id): las predicciones globales quedarían limitadas a una quiniela';
  END IF;
  IF NOT v_correcta THEN
    RAISE EXCEPTION 'Falta UNIQUE (user_id, league_id): el upsert del cliente no tendría a qué apuntar';
  END IF;
  IF v_duplicados > 0 THEN
    RAISE EXCEPTION 'Hay % pares (usuario, quiniela) repetidos', v_duplicados;
  END IF;

  RAISE NOTICE 'Predicciones globales: una por persona y por quiniela. Ninguna fila modificada.';
END $verificar$;

NOTIFY pgrst, 'reload schema';
