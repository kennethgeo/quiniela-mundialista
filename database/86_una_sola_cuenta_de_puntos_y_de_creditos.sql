-- =============================================================================
-- 86 · El que autoriza y el que cuenta tienen que decir lo mismo
-- =============================================================================
-- Dos fórmulas escritas dos veces, encontradas por la misma auditoría del
-- 22 sep 2026 y comprobadas leyendo la base, no el repo. Es EL error crónico de
-- este proyecto: los puntos de asistidor se perdieron meses por esto, la 62 lo
-- arregló para el total global y la 73 para el cupo de ×2. Volvió por dos
-- puertas distintas, y las dos veces por el mismo motivo — se arregló la mitad
-- que se miraba y no la otra.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- A) `recompute_user_total` corría la fórmula VIEJA (deriva repo ↔ base)
-- ─────────────────────────────────────────────────────────────────────────────
-- La 62 la reescribió para que delegara en `user_total_calculado` —cada partido
-- cuenta UNA vez con tu mejor puntaje, cada torneo UNA vez para campeón,
-- goleador y asistidor— y en producción está la versión de la 61: suma cruda de
-- TODOS los `points_earned` y de TODAS las filas de `tournament_predictions`.
-- Alguien volvió a correr la 61 después de la 62 y la pisó; la 61 es
-- re-ejecutable a propósito, así que no hace falta que nadie se equivocara.
--
-- LA CORRECCIÓN AL DIAGNÓSTICO: hoy la desviación es CERO. Comparadas las dos
-- fórmulas para los 26 usuarios, no hay ni una diferencia, porque nadie juega
-- dos quinielas sobre el mismo torneo. No son puntos mal repartidos ahora
-- mismo; es una bomba con la espoleta puesta — la liga tica corre temporada
-- tras temporada sobre el MISMO `tournament_id`, así que revienta el día que se
-- cree la Bundestica siguiente, y ese día cada partido contaría doble.
--
-- Por eso la comprobación de abajo exige desviación cero en vez de recalcular:
-- si el cambio no mueve ningún número, es que el intercambio es seguro. No se
-- tocan datos de producción.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- B) El crédito de ×2 se autorizaba con una bolsa y se consumía con otra
-- ─────────────────────────────────────────────────────────────────────────────
-- `check_powerup_limit` (el que AUTORIZA) usa desde la 73 la llave
-- `clave_fase(phase, stage) || '|' || matchday` y el cupo de `cupo_powerups`.
-- `consume_powerup_credit` (el que COBRA) se quedó en la versión de la 48:
-- agrupa por `m.phase` crudo y lee `leagues.powerup_limit` pelado. Tres
-- desajustes, no uno:
--
--   1. BOLSA distinta. En la liga tica y en la Champions toda la eliminatoria
--      llega con `phase = 'knockout'`, así que el que cobra mete Semifinal,
--      Final y Gran final en una sola bolsa mientras el que autoriza las
--      separa. Es exactamente el fallo que la 73 arregló — en el otro extremo.
--   2. CUPO distinto. Bundestica tiene hoy `{"Semifinal":2,"Final":1,
--      "Gran final":1}` con `powerup_limit = 2`. En la Final el que autoriza da
--      1 y deja pasar el 2.º PORQUE hay un crédito; el que cobra cree que la
--      base son 2, ve `2 > 2` falso y NO consume nada. El crédito sobrevive y
--      se vuelve a gastar en la Gran final.
--   3. `powerup_credits.phase` guarda la CLAVE de fase —lo escribe así
--      `void_cancelled_match`— y el que cobra la compara contra `m.phase`. Para
--      cualquier eliminatoria que no sea la del Mundial, nunca coinciden.
--
-- En el Mundial no se veía porque ahí cada ronda trae su propia `phase` y las
-- dos agrupaciones coinciden por casualidad. Bundestica entra a su postemporada
-- con 3 créditos sin consumir.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- C) Y el crédito NO se devolvía al apagar el ×2, aunque CLAUDE.md lo afirmaba
-- ─────────────────────────────────────────────────────────────────────────────
-- Esto no venía en la auditoría: apareció al leer el consumidor para arreglarlo.
-- `CLAUDE.md` dice desde la 48 «al desactivar el ×2, lo devuelve» y NINGUNA
-- función de la base pone `consumed_at` de vuelta en NULL — comprobado buscando
-- por todo `pg_proc`. Quien apagaba un ×2 pagado con un crédito lo perdía.
-- Una línea de documentación no es una implementación.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- A) Una sola fórmula para el total global
-- -----------------------------------------------------------------------------
-- CREATE OR REPLACE, nunca DROP + CREATE: conserva el ACL (solo service_role).
CREATE OR REPLACE FUNCTION public.recompute_user_total(p_user_id uuid)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.users u
  SET total_points = public.user_total_calculado(p_user_id)
  WHERE u.id = p_user_id;
$$;

COMMENT ON FUNCTION public.recompute_user_total(uuid) IS
  'Guarda en users.total_points lo que dice user_total_calculado, que es la '
  'ÚNICA fórmula del total global (migración 62). No reimplementar la suma acá: '
  'ya pasó dos veces y la segunda fue una corrida de la 61 pisando a la 62.';

-- -----------------------------------------------------------------------------
-- B + C) El crédito se cobra con la MISMA llave y el MISMO cupo que se autoriza,
--        y se devuelve al apagar el ×2
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.consume_powerup_credit()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_llave text; v_base_limit integer; v_current integer;
  v_credit_id uuid; v_activating boolean; v_deactivating boolean;
BEGIN
  v_activating := (NEW.use_powerup_x2 = TRUE)
                  AND (TG_OP = 'INSERT' OR COALESCE(OLD.use_powerup_x2, FALSE) = FALSE);
  v_deactivating := (TG_OP = 'UPDATE')
                    AND COALESCE(OLD.use_powerup_x2, FALSE) = TRUE
                    AND COALESCE(NEW.use_powerup_x2, FALSE) = FALSE;

  IF v_activating AND NEW.league_id IS NOT NULL THEN
    -- LA MISMA llave y EL MISMO cupo que usa check_powerup_limit para dejar
    -- pasar esta activación. Si acá se calculara distinto, el trigger
    -- autorizaría con un crédito que nadie cobra.
    v_llave      := public.llave_cupo(NEW.match_id);
    v_base_limit := public.cupo_powerups(NEW.league_id, NEW.match_id);

    -- Este trigger es AFTER, así que la fila nueva YA cuenta: por eso el
    -- conteo no la excluye y la comparación es `>` y no `>=`.
    SELECT COUNT(*) INTO v_current
      FROM public.predictions p
      JOIN public.matches m ON p.match_id = m.id
     WHERE p.user_id = NEW.user_id
       AND p.league_id = NEW.league_id
       AND p.use_powerup_x2 = TRUE
       AND public.llave_cupo(m.id) = v_llave;

    IF v_current > COALESCE(v_base_limit, 0) THEN
      -- `powerup_credits.phase` guarda la CLAVE de fase (lo escribe así
      -- void_cancelled_match), no `matches.phase`.
      SELECT id INTO v_credit_id
        FROM public.powerup_credits
       WHERE user_id = NEW.user_id
         AND league_id = NEW.league_id
         AND phase || '|' || COALESCE(matchday, 0)::text = v_llave
         AND consumed_at IS NULL
       ORDER BY created_at ASC
       LIMIT 1;
      IF v_credit_id IS NOT NULL THEN
        UPDATE public.powerup_credits
           SET consumed_at = now(), consumed_by_prediction_id = NEW.id
         WHERE id = v_credit_id;
      END IF;
    END IF;
  END IF;

  IF v_deactivating THEN
    -- Devolver el crédito que pagó ESTA predicción. Sin esto, apagar un ×2 lo
    -- quemaba para siempre, que es justo lo contrario de lo que el grupo votó.
    UPDATE public.powerup_credits
       SET consumed_at = NULL, consumed_by_prediction_id = NULL
     WHERE consumed_by_prediction_id = NEW.id;
  END IF;

  RETURN NEW;
END; $$;

COMMENT ON FUNCTION public.consume_powerup_credit() IS
  'Cobra y devuelve los créditos de ×2. La llave y el cupo salen de llave_cupo() '
  'y cupo_powerups(), las MISMAS que usa check_powerup_limit para autorizar: si '
  'se separan, se autoriza con un crédito que nadie cobra (migración 86).';

-- -----------------------------------------------------------------------------
-- Comprobaciones. Todas miden el estado final: una segunda corrida pasa igual.
-- -----------------------------------------------------------------------------
DO $$
DECLARE n int; v_def text;
BEGIN
  -- A) la fórmula del total global vive en un solo sitio…
  v_def := pg_get_functiondef('public.recompute_user_total(uuid)'::regprocedure);
  IF v_def NOT LIKE '%user_total_calculado%' THEN
    RAISE EXCEPTION 'recompute_user_total no delega en user_total_calculado';
  END IF;
  IF v_def ILIKE '%SUM(COALESCE(points_earned%' THEN
    RAISE EXCEPTION 'recompute_user_total volvió a sumar points_earned a mano';
  END IF;
  -- …y no mueve ni un número hoy: si lo moviera, el intercambio no sería seguro.
  SELECT count(*) INTO n FROM public.users u
   WHERE COALESCE(u.total_points,0) IS DISTINCT FROM public.user_total_calculado(u.id);
  IF n > 0 THEN
    RAISE EXCEPTION 'la fórmula nueva cambia el total de % persona(s): revisar antes de seguir', n;
  END IF;
  -- El ACL tiene que seguir cerrado (CREATE OR REPLACE lo conserva; un DROP no).
  IF has_function_privilege('authenticated','public.recompute_user_total(uuid)','EXECUTE')
  OR has_function_privilege('anon','public.recompute_user_total(uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'recompute_user_total quedó abierta al cliente';
  END IF;

  -- B) el que cobra usa la llave y el cupo del que autoriza…
  v_def := pg_get_functiondef('public.consume_powerup_credit()'::regprocedure);
  IF v_def NOT LIKE '%llave_cupo%' OR v_def NOT LIKE '%cupo_powerups%' THEN
    RAISE EXCEPTION 'consume_powerup_credit no usa llave_cupo/cupo_powerups';
  END IF;
  IF v_def LIKE '%SELECT powerup_limit INTO%' THEN
    RAISE EXCEPTION 'consume_powerup_credit sigue leyendo leagues.powerup_limit crudo';
  END IF;
  -- …y el que autoriza usa EXACTAMENTE las mismas dos funciones. Esta es la
  -- comprobación que importa: el fallo no fue que una estuviera mal, fue que
  -- cada una calculaba por su cuenta. Si mañana alguien vuelve a escribir la
  -- agrupación a mano en cualquiera de las dos, esto cae.
  IF pg_get_functiondef('public.check_powerup_limit()'::regprocedure) NOT LIKE '%llave_cupo%'
  OR pg_get_functiondef('public.check_powerup_limit()'::regprocedure) NOT LIKE '%cupo_powerups%' THEN
    RAISE EXCEPTION 'check_powerup_limit dejó de usar llave_cupo/cupo_powerups';
  END IF;
  IF v_def LIKE '%m.phase = v_phase%' THEN
    RAISE EXCEPTION 'consume_powerup_credit volvió a agrupar por matches.phase crudo';
  END IF;

  -- C) y el crédito se devuelve al apagar el ×2.
  IF v_def NOT LIKE '%consumed_at = NULL%' THEN
    RAISE EXCEPTION 'consume_powerup_credit no devuelve el crédito al desactivar';
  END IF;

  RAISE NOTICE '86 OK: una sola cuenta para los puntos y para los créditos.';
END $$;

COMMIT;
