-- =============================================================================
-- 57_auditoria_correcciones.sql  ·  Bitácora de correcciones manuales
-- =============================================================================
-- POR QUÉ: corregir un partido mueve los puntos de TODOS los miembros, y hoy no
-- queda rastro visible de eso. En una quiniela con plata de por medio, que el
-- admin pueda cambiar un marcador sin que nadie lo vea es un problema de
-- confianza, no de datos. Casos reales de este torneo: el 3-0 por alineación
-- indebida y el 1-0 de un partido suspendido por lluvia — los dos cambiaron la
-- tabla y el grupo solo se enteró porque alguien avisó por WhatsApp.
--
-- QUÉ SE REGISTRA: solo las correcciones MANUALES. El sync toca los marcadores
-- todo el tiempo (cada gol en vivo), y registrar eso inundaría la bitácora sin
-- aportar nada. La distinción es limpia:
--   · el sync corre con service_role  -> auth.uid() es NULL
--   · el panel escribe con tu sesión  -> auth.uid() es tu usuario
-- Así que se registra solo cuando hay un usuario identificado detrás del cambio.
--
-- QUIÉN LO VE: cualquier miembro autenticado. Ese es el punto — es para el
-- grupo, no para el admin.
-- Idempotente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.match_audit (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id    integer NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  changed_by  uuid REFERENCES public.users(id) ON DELETE SET NULL,
  changed_at  timestamptz NOT NULL DEFAULT now(),
  campo       text NOT NULL,          -- 'marcador' | 'estado' | 'penales' | 'candado'
  valor_antes text,
  valor_despues text
);

CREATE INDEX IF NOT EXISTS match_audit_match_idx ON public.match_audit (match_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS match_audit_fecha_idx ON public.match_audit (changed_at DESC);

COMMENT ON TABLE public.match_audit IS
  'Bitácora de correcciones manuales sobre partidos. Solo cambios hechos por un usuario identificado (el sync, que corre con service_role, no se registra).';

ALTER TABLE public.match_audit ENABLE ROW LEVEL SECURITY;

-- Transparencia: lo puede leer cualquier miembro autenticado.
DROP POLICY IF EXISTS "match_audit_select" ON public.match_audit;
CREATE POLICY "match_audit_select"
  ON public.match_audit FOR SELECT
  TO authenticated
  USING (true);

-- Nadie escribe a mano: solo el trigger (SECURITY DEFINER). Sin política de
-- INSERT/UPDATE/DELETE, la bitácora no se puede alterar desde el cliente.

CREATE OR REPLACE FUNCTION public.registrar_correccion_partido()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_marcador_antes text;
  v_marcador_despues text;
BEGIN
  -- Sin usuario identificado = lo hizo el sync (service_role). No se registra:
  -- si no, cada gol en vivo dejaría una entrada.
  IF v_actor IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.home_goals_actual IS DISTINCT FROM OLD.home_goals_actual
     OR NEW.away_goals_actual IS DISTINCT FROM OLD.away_goals_actual THEN
    v_marcador_antes   := COALESCE(OLD.home_goals_actual::text, '–') || '-' || COALESCE(OLD.away_goals_actual::text, '–');
    v_marcador_despues := COALESCE(NEW.home_goals_actual::text, '–') || '-' || COALESCE(NEW.away_goals_actual::text, '–');
    INSERT INTO public.match_audit (match_id, changed_by, campo, valor_antes, valor_despues)
    VALUES (NEW.id, v_actor, 'marcador', v_marcador_antes, v_marcador_despues);
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.match_audit (match_id, changed_by, campo, valor_antes, valor_despues)
    VALUES (NEW.id, v_actor, 'estado', OLD.status, NEW.status);
  END IF;

  IF NEW.goes_to_penalties IS DISTINCT FROM OLD.goes_to_penalties
     OR NEW.penalties_winner_real IS DISTINCT FROM OLD.penalties_winner_real THEN
    INSERT INTO public.match_audit (match_id, changed_by, campo, valor_antes, valor_despues)
    VALUES (NEW.id, v_actor, 'penales',
            CASE WHEN OLD.goes_to_penalties THEN COALESCE(OLD.penalties_winner_real, 'sí') ELSE 'no' END,
            CASE WHEN NEW.goes_to_penalties THEN COALESCE(NEW.penalties_winner_real, 'sí') ELSE 'no' END);
  END IF;

  IF NEW.score_locked IS DISTINCT FROM OLD.score_locked THEN
    INSERT INTO public.match_audit (match_id, changed_by, campo, valor_antes, valor_despues)
    VALUES (NEW.id, v_actor, 'candado',
            CASE WHEN OLD.score_locked THEN 'fijado' ELSE 'libre' END,
            CASE WHEN NEW.score_locked THEN 'fijado' ELSE 'libre' END);
  END IF;

  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS registrar_correccion_partido_trigger ON public.matches;
CREATE TRIGGER registrar_correccion_partido_trigger
  AFTER UPDATE ON public.matches
  FOR EACH ROW EXECUTE FUNCTION public.registrar_correccion_partido();

-- Bitácora de un torneo, ya resuelta con los nombres (el cliente no puede
-- cruzar users con matches por RLS sin exponer de más).
CREATE OR REPLACE FUNCTION public.match_audit_log(p_tournament_id integer, p_limite integer DEFAULT 30)
RETURNS TABLE (
  id uuid, changed_at timestamptz, campo text, valor_antes text, valor_despues text,
  match_id integer, home_team text, away_team text, matchday integer, autor text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT a.id, a.changed_at, a.campo, a.valor_antes, a.valor_despues,
         m.id, m.home_team, m.away_team, m.matchday,
         COALESCE(u.display_name, 'Admin')
  FROM public.match_audit a
  JOIN public.matches m ON m.id = a.match_id
  LEFT JOIN public.users u ON u.id = a.changed_by
  WHERE m.tournament_id = p_tournament_id
  ORDER BY a.changed_at DESC
  LIMIT GREATEST(p_limite, 1);
$$;

GRANT EXECUTE ON FUNCTION public.match_audit_log(integer, integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
