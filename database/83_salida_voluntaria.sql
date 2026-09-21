-- =============================================================================
-- 83_salida_voluntaria.sql
-- Que una persona pueda irse de una quiniela por su cuenta.
-- Solo una función. No toca ninguna fila de datos. Idempotente.
-- =============================================================================
--
-- HASTA HOY NO SE PODÍA. Comprobado sobre main = 64ba004: el ÚNICO
-- `DELETE FROM league_members` de toda la base está dentro de
-- `expulsar_miembro`, que exige ser administrador y además prohíbe expulsarse a
-- uno mismo. O sea que para salirse de una quiniela había que pedirle a un
-- admin que te echara.
--
-- Eso deja dos situaciones feas:
--   · quien pulsa «No acepto · salir» en la puerta de reglas se queda dentro
--     (el botón solo navega; la membresía ya se insertó al entrar con el
--     código). Medido: 9 membresías sin aceptar, las nueve en Mundial 2026;
--   · y quien simplemente ya no quiere jugar depende de otra persona.
--
-- QUÉ SE PIERDE AL SALIR, y por eso la pantalla tiene que avisarlo antes:
--   · las predicciones de partidos de ESA quiniela;
--   · las predicciones globales de esa quiniela (campeón, goleador, asistidor);
--   · y en consecuencia el TOTAL GLOBAL puede bajar, porque cuenta cada partido
--     una vez con el mejor puntaje entre tus quinielas (migración 62). Si la
--     mejor era la que dejás, ese partido pasa a valer menos o nada.
-- No hace falta recalcular a mano: `predictions_recompute_total` y
-- `tournament_predictions_recompute_total` disparan en DELETE (comprobado).
--
-- LOS VOTOS NO SE BORRAN, a propósito. Por decisión del dueño (21 sep 2026) el
-- padrón de una votación se congela al abrirla: quien votó era parte del
-- electorado de ese momento y su voto sigue contando. Borrarlo cambiaría una
-- mayoría ya emitida. Es el mismo criterio que para una expulsión.

BEGIN;

CREATE OR REPLACE FUNCTION public.salir_de_quiniela(p_league_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_creador uuid;
  v_predicciones integer;
  v_globales integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  SELECT admin_id INTO v_creador FROM public.leagues WHERE id = p_league_id;
  IF v_creador IS NULL THEN
    RAISE EXCEPTION 'Esa quiniela no existe';
  END IF;

  -- EL CREADOR NO PUEDE IRSE. `leagues.admin_id` no se puede quitar (migración
  -- 59) y no existe forma de traspasar la quiniela, así que dejarlo salir
  -- dejaría un grupo con dueño fantasma: nadie podría nombrar admins ni
  -- borrarla nunca más. Si de verdad quiere irse, borra la quiniela.
  IF v_uid = v_creador THEN
    RAISE EXCEPTION 'Creaste esta quiniela, así que no podés salirte: o la dejás activa, o la borrás desde el panel de administración';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.league_members
                  WHERE league_id = p_league_id AND user_id = v_uid) THEN
    RAISE EXCEPTION 'No sos miembro de esta quiniela';
  END IF;

  -- Se cuenta ANTES de borrar para poder devolver qué se perdió. La pantalla ya
  -- lo avisó; esto sirve para confirmarlo con números ciertos y para las
  -- pruebas.
  SELECT count(*) INTO v_predicciones FROM public.predictions
   WHERE league_id = p_league_id AND user_id = v_uid;
  SELECT count(*) INTO v_globales FROM public.tournament_predictions
   WHERE league_id = p_league_id AND user_id = v_uid;

  -- Mismo alcance que `expulsar_miembro`, para que irse y que te echen dejen la
  -- base en el mismo estado. Los votos quedan (ver cabecera).
  DELETE FROM public.predictions
   WHERE league_id = p_league_id AND user_id = v_uid;
  DELETE FROM public.tournament_predictions
   WHERE league_id = p_league_id AND user_id = v_uid;
  DELETE FROM public.league_members
   WHERE league_id = p_league_id AND user_id = v_uid;

  RETURN jsonb_build_object(
    'predicciones_borradas', v_predicciones,
    'globales_borradas', v_globales);
END;
$$;

COMMENT ON FUNCTION public.salir_de_quiniela(uuid) IS
  'Salida voluntaria. Borra predicciones y membresía propias; conserva los votos.';

-- Nace abierta a PUBLIC (lección de la 61). La llama el frontend, así que
-- `authenticated` sí, `anon` no.
REVOKE ALL ON FUNCTION public.salir_de_quiniela(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.salir_de_quiniela(uuid) TO authenticated;

DO $verificar$
BEGIN
  IF has_function_privilege('anon', 'public.salir_de_quiniela(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'salir_de_quiniela quedó alcanzable por anon';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.salir_de_quiniela(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'salir_de_quiniela no es ejecutable por authenticated';
  END IF;

  -- El alcance del borrado tiene que seguir siendo el mismo que el de una
  -- expulsión. Si alguien agrega una tabla a `expulsar_miembro` y no acá, irse
  -- y que te echen dejarían estados distintos.
  IF (SELECT count(*) FROM regexp_matches(
        pg_get_functiondef('public.salir_de_quiniela(uuid)'::regprocedure),
        'DELETE FROM public\.(predictions|tournament_predictions|league_members)', 'g')) <> 3 THEN
    RAISE EXCEPTION 'salir_de_quiniela no borra las mismas tres tablas que expulsar_miembro';
  END IF;

  RAISE NOTICE 'Salida voluntaria lista. Ninguna fila modificada.';
END $verificar$;

NOTIFY pgrst, 'reload schema';
COMMIT;
