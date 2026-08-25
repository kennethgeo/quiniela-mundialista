-- =============================================================================
-- 62_ranking_global_sin_duplicados.sql  ·  Cada partido cuenta una sola vez
-- =============================================================================
-- users.total_points sumaba las predicciones de TODAS las quinielas sin
-- filtrar. Alguien en tres quinielas del mismo torneo cobraba el mismo partido
-- tres veces, así que el ranking global medía volumen de participación, no
-- puntería. Con la app abierta al público eso deja de ser una rareza y pasa a
-- ser un incentivo: crear quinielas vacías para inflar el número.
--
-- REGLA NUEVA: cada PARTIDO cuenta una vez (el mejor puntaje que sacaste en él
-- entre tus quinielas) y cada TORNEO cuenta una vez para campeón, goleador y
-- asistidor. Se toma el máximo y no el promedio ni la primera: los puntajes por
-- quiniela son configurables, así que la misma corazonada vale distinto en cada
-- una — castigar por jugar en una quiniela de puntaje bajo sería raro.
--
-- LO QUE NO CAMBIA: los puntos DENTRO de cada quiniela. league_points, la
-- Tabla, las jornadas y el pozo siguen exactamente igual. Esto solo toca el
-- número global del perfil.
-- Idempotente. Al final recalcula todos los totales.
-- =============================================================================

-- Fuente ÚNICA del total global. Antes la fórmula estaba escrita dos veces
-- (recompute_user_total y el reconciliador), y por eso una se olvidó de los
-- puntos de asistidor durante meses sin que nadie lo notara.
CREATE OR REPLACE FUNCTION public.user_total_calculado(p_user_id uuid)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT (
      COALESCE((
        SELECT SUM(x.mejor) FROM (
          SELECT MAX(COALESCE(p.points_earned, 0)) AS mejor
          FROM public.predictions p
          WHERE p.user_id = p_user_id
          GROUP BY p.match_id
        ) x
      ), 0)
    + COALESCE((
        SELECT SUM(y.mejor_campeon + y.mejor_goleador + y.mejor_asistidor)
        FROM (
          SELECT MAX(COALESCE(tp.champion_points, 0))   AS mejor_campeon,
                 MAX(COALESCE(tp.top_scorer_points, 0)) AS mejor_goleador,
                 MAX(COALESCE(tp.top_assist_points, 0)) AS mejor_asistidor
          FROM public.tournament_predictions tp
          WHERE tp.user_id = p_user_id
          GROUP BY tp.tournament_id
        ) y
      ), 0)
    + COALESCE((SELECT u.points_adjustment FROM public.users u WHERE u.id = p_user_id), 0)
  )::integer;
$$;

CREATE OR REPLACE FUNCTION public.recompute_user_total(p_user_id uuid)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.users u
  SET total_points = public.user_total_calculado(p_user_id)
  WHERE u.id = p_user_id;
$$;

-- Para el panel de admin: quién quedó descuadrado, en una sola consulta y con
-- la MISMA fórmula. El backend ya no reimplementa la cuenta.
CREATE OR REPLACE FUNCTION public.totales_desalineados()
RETURNS TABLE (user_id uuid, display_name text, stored integer, computed integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id, u.display_name,
         COALESCE(u.total_points, 0),
         public.user_total_calculado(u.id)
  FROM public.users u
  WHERE COALESCE(u.total_points, 0) IS DISTINCT FROM public.user_total_calculado(u.id);
$$;

REVOKE ALL ON FUNCTION public.user_total_calculado(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.totales_desalineados()     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recompute_user_total(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_total_calculado(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.totales_desalineados()     TO service_role;
GRANT EXECUTE ON FUNCTION public.recompute_user_total(uuid) TO service_role;

-- Los totales guardados se calcularon con la regla vieja: hay que rehacerlos.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.users LOOP
    PERFORM public.recompute_user_total(r.id);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
