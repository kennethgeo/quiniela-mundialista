-- PROPUESTA: no aplicada ni registrada como migración.
-- Requiere ensayo en Postgres aislado, inventario del esquema real y revisión
-- antes de asignar una migración nueva con la CLI de Supabase y desplegar.
-- La definición no cambia partidos existentes. El backend NO usa un UPDATE
-- directo si esta RPC no existe: devuelve 503 sin escribir el cruce.

BEGIN;

CREATE OR REPLACE FUNCTION public.actualizar_equipos_cruce(p_cambio jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  v_match public.matches%ROWTYPE;
  v_home text := btrim(p_cambio->>'home_team');
  v_away text := btrim(p_cambio->>'away_team');
BEGIN
  IF NOT public.es_backend() THEN
    RAISE EXCEPTION 'Solo el backend puede corregir cruces' USING ERRCODE = '42501';
  END IF;

  -- Excluye INSERT/UPDATE/DELETE concurrentes de predicciones mientras se
  -- comprueba y cambia la identidad. NOWAIT evita introducir esperas/deadlocks
  -- con el puntaje, que puede tomar candados en otro orden. Si hay actividad,
  -- se rechaza y la transacción no modifica ninguna fila.
  LOCK TABLE public.predictions IN SHARE MODE NOWAIT;

  SELECT * INTO v_match FROM public.matches
   WHERE id = (p_cambio->>'match_id')::integer
     AND tournament_id = (p_cambio->>'tournament_id')::integer
   FOR UPDATE NOWAIT;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Partido no encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF v_match.status IS DISTINCT FROM 'pending'
     OR v_match.phase IS NULL OR v_match.phase = 'groups'
     OR v_match.score_locked IS DISTINCT FROM false
     OR v_match.destapado_at IS NOT NULL OR v_match.kickoff_at IS NULL
     OR v_match.kickoff_at <= clock_timestamp() + interval '15 minutes' THEN
    RAISE EXCEPTION 'El cruce está cerrado o fijado';
  END IF;
  IF EXISTS (SELECT 1 FROM public.predictions WHERE match_id = v_match.id) THEN
    RAISE EXCEPTION 'El cruce ya tiene predicciones';
  END IF;
  IF (v_match.home_team, v_match.away_team, v_match.home_team_code, v_match.away_team_code)
       IS DISTINCT FROM
     (p_cambio #>> '{expected,home_team}', p_cambio #>> '{expected,away_team}',
      p_cambio #>> '{expected,home_team_code}', p_cambio #>> '{expected,away_team_code}') THEN
    RAISE EXCEPTION 'El cruce cambió desde la lectura';
  END IF;
  IF v_home IS NULL OR v_away IS NULL OR length(v_home) NOT BETWEEN 1 AND 120
     OR length(v_away) NOT BETWEEN 1 AND 120 OR v_home = v_away
     OR p_cambio->>'home_team_code' IS NULL OR p_cambio->>'away_team_code' IS NULL
     OR length(btrim(p_cambio->>'home_team_code')) = 0
     OR length(btrim(p_cambio->>'away_team_code')) = 0
     OR length(p_cambio->>'home_team_code') > 1024
     OR length(p_cambio->>'away_team_code') > 1024 THEN
    RAISE EXCEPTION 'Equipos inválidos';
  END IF;

  UPDATE public.matches SET
    home_team = v_home, away_team = v_away,
    home_team_code = btrim(p_cambio->>'home_team_code'),
    away_team_code = btrim(p_cambio->>'away_team_code')
  WHERE id = v_match.id RETURNING * INTO v_match;
  RETURN to_jsonb(v_match);
END;
$function$;

REVOKE ALL ON FUNCTION public.actualizar_equipos_cruce(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.actualizar_equipos_cruce(jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
