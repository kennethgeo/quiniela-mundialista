-- =============================================================================
-- 48_powerup_carryover.sql  ·  Arrastre del comodín ×2 en partidos cancelados
-- =============================================================================
-- Decidido por votación del grupo: si alguien activó el comodín ×2 en un
-- partido que termina cancelado/pospuesto (no cuenta para el puntaje), no solo
-- se le devuelve el cupo de esa jornada — además se le otorga un CRÉDITO para
-- usar el ×2 de más en la jornada/fase siguiente del mismo torneo (aunque ya
-- haya gastado su cupo normal ahí).
--
-- · powerup_credits: un crédito = un uso extra de ×2 en (user, league, fase/jornada).
-- · check_powerup_limit(): el cupo efectivo pasa a ser límite base + créditos
--   sin consumir; al activar por encima del cupo base, consume el crédito más
--   viejo; al desactivar, lo devuelve.
-- · void_cancelled_match(match_id): función única (llamada desde el backend
--   Python y desde el Admin en el frontend) que anula puntos, devuelve el ×2
--   usado y otorga el crédito de arrastre para la siguiente jornada/fase
--   cronológica del torneo. SECURITY DEFINER: corre con permisos plenos, así
--   no depende de las políticas RLS de "predictions" (que solo dejan escribir
--   al propio usuario o a service_role).
-- Idempotente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.powerup_credits (
  id                       uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id                  uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  league_id                uuid NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  phase                    text NOT NULL,
  matchday                 integer,
  source_match_id          integer REFERENCES public.matches(id) ON DELETE SET NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  consumed_at              timestamptz,
  consumed_by_prediction_id uuid REFERENCES public.predictions(id) ON DELETE SET NULL,
  UNIQUE (user_id, league_id, source_match_id)
);
CREATE INDEX IF NOT EXISTS idx_powerup_credits_lookup
  ON public.powerup_credits(user_id, league_id, phase, matchday) WHERE consumed_at IS NULL;

ALTER TABLE public.powerup_credits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "powerup_credits_select_own_or_admin" ON public.powerup_credits;
CREATE POLICY "powerup_credits_select_own_or_admin" ON public.powerup_credits
  FOR SELECT TO authenticated USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.leagues l WHERE l.id = league_id AND l.admin_id = auth.uid())
  );
-- Sin políticas de escritura para "authenticated": los créditos se otorgan y
-- consumen únicamente desde funciones SECURITY DEFINER (esta migración).

-- -----------------------------------------------------------------------------
-- Cupo efectivo = límite base de la quiniela + créditos sin consumir.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_powerup_limit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_phase text; v_matchday integer; v_base_limit integer; v_current integer;
  v_credits integer; v_credit_id uuid; v_activating boolean;
BEGIN
  -- Solo validar/consumir al ACTIVAR el comodín (INSERT con x2, o UPDATE que
  -- lo prende); re-guardar la predicción sin tocar el x2 no debe re-consumir.
  v_activating := (NEW.use_powerup_x2 = TRUE)
    AND (TG_OP = 'INSERT' OR COALESCE(OLD.use_powerup_x2, FALSE) = FALSE);

  IF v_activating AND NEW.league_id IS NOT NULL THEN
    SELECT phase, COALESCE(matchday, 0) INTO v_phase, v_matchday
    FROM public.matches WHERE id = NEW.match_id;

    SELECT powerup_limit INTO v_base_limit FROM public.leagues WHERE id = NEW.league_id;

    SELECT COUNT(*) INTO v_current
    FROM public.predictions p
    JOIN public.matches m ON p.match_id = m.id
    WHERE p.user_id = NEW.user_id
      AND p.league_id = NEW.league_id
      AND p.use_powerup_x2 = TRUE
      AND m.phase = v_phase
      AND COALESCE(m.matchday, 0) = v_matchday
      AND p.id <> NEW.id;

    SELECT COUNT(*) INTO v_credits
    FROM public.powerup_credits
    WHERE user_id = NEW.user_id AND league_id = NEW.league_id
      AND phase = v_phase AND COALESCE(matchday, 0) = v_matchday
      AND consumed_at IS NULL;

    IF v_current >= COALESCE(v_base_limit, 0) + COALESCE(v_credits, 0) THEN
      RAISE EXCEPTION 'Límite de comodines x2 alcanzado para esta jornada.';
    END IF;

    -- Si supera el cupo base, consume el crédito arrastrado más viejo.
    IF v_current >= COALESCE(v_base_limit, 0) THEN
      SELECT id INTO v_credit_id FROM public.powerup_credits
      WHERE user_id = NEW.user_id AND league_id = NEW.league_id
        AND phase = v_phase AND COALESCE(matchday, 0) = v_matchday
        AND consumed_at IS NULL
      ORDER BY created_at ASC LIMIT 1;
      IF v_credit_id IS NOT NULL THEN
        UPDATE public.powerup_credits
          SET consumed_at = now(), consumed_by_prediction_id = NEW.id
          WHERE id = v_credit_id;
      END IF;
    END IF;
  END IF;

  -- Al desactivar el ×2, devolver el crédito que esta predicción hubiera consumido.
  IF TG_OP = 'UPDATE' AND COALESCE(OLD.use_powerup_x2, FALSE) = TRUE AND NEW.use_powerup_x2 = FALSE THEN
    UPDATE public.powerup_credits SET consumed_at = NULL, consumed_by_prediction_id = NULL
    WHERE consumed_by_prediction_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_powerup_limit ON public.predictions;
CREATE TRIGGER enforce_powerup_limit
  BEFORE INSERT OR UPDATE ON public.predictions
  FOR EACH ROW EXECUTE FUNCTION public.check_powerup_limit();

-- -----------------------------------------------------------------------------
-- Anular un partido no disputado: puntos a 0, comodín devuelto, y crédito de
-- arrastre para la próxima jornada/fase cronológica del torneo. Reemplaza el
-- parcheo ad-hoc que hacían el backend y el Admin por separado.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.void_cancelled_match(p_match_id integer)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_status text; v_tid int; v_kickoff timestamptz;
  v_next_phase text; v_next_matchday integer;
  r record; v_zeroed int := 0; v_refunded int := 0;
BEGIN
  -- Con sesión de usuario (no service_role), exigir admin. El service_role
  -- (backend/cron) no trae auth.uid() y queda permitido: ya lo gatea la API.
  IF auth.uid() IS NOT NULL
     AND COALESCE((SELECT is_admin FROM public.users WHERE id = auth.uid()), FALSE) IS NOT TRUE THEN
    RAISE EXCEPTION 'Solo un administrador puede anular un partido';
  END IF;

  SELECT status, tournament_id, kickoff_at INTO v_status, v_tid, v_kickoff
  FROM public.matches WHERE id = p_match_id;

  IF v_status IS NULL THEN
    RETURN jsonb_build_object('status', 'error', 'message', 'Partido no encontrado');
  END IF;
  IF v_status NOT IN ('cancelled', 'postponed') THEN
    RETURN jsonb_build_object('status', 'ok', 'message', 'El partido no está cancelado', 'zeroed', 0, 'refunded', 0);
  END IF;

  -- Próximo partido cronológico del mismo torneo → define la jornada/fase
  -- donde se puede usar el crédito de arrastre.
  SELECT m.phase, m.matchday INTO v_next_phase, v_next_matchday
  FROM public.matches m
  WHERE m.tournament_id = v_tid
    AND m.kickoff_at > v_kickoff
    AND m.status NOT IN ('cancelled', 'postponed')
  ORDER BY m.kickoff_at ASC
  LIMIT 1;

  FOR r IN
    SELECT id, user_id, league_id, points_earned, use_powerup_x2
    FROM public.predictions WHERE match_id = p_match_id
  LOOP
    IF COALESCE(r.points_earned, 0) <> 0 THEN v_zeroed := v_zeroed + 1; END IF;
    IF r.use_powerup_x2 THEN v_refunded := v_refunded + 1; END IF;

    IF COALESCE(r.points_earned, 0) <> 0 OR r.use_powerup_x2 THEN
      UPDATE public.predictions SET points_earned = 0, use_powerup_x2 = false WHERE id = r.id;
    END IF;

    IF r.use_powerup_x2 AND v_next_phase IS NOT NULL THEN
      INSERT INTO public.powerup_credits (user_id, league_id, phase, matchday, source_match_id)
      VALUES (r.user_id, r.league_id, v_next_phase, v_next_matchday, p_match_id)
      ON CONFLICT (user_id, league_id, source_match_id) DO NOTHING;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'status', 'ok', 'zeroed', v_zeroed, 'refunded', v_refunded,
    'next_phase', v_next_phase, 'next_matchday', v_next_matchday
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.void_cancelled_match(integer) TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Lectura: mis créditos sin consumir en una quiniela (para mostrar el cupo
-- boosteado en el front).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_powerup_credits(p_league_id uuid)
RETURNS TABLE (phase text, matchday integer, credits integer)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT phase, matchday, count(*)::int
  FROM public.powerup_credits
  WHERE user_id = auth.uid() AND league_id = p_league_id AND consumed_at IS NULL
  GROUP BY phase, matchday;
$$;
GRANT EXECUTE ON FUNCTION public.my_powerup_credits(uuid) TO authenticated;

-- -----------------------------------------------------------------------------
-- Backfill puntual: el partido 252 (AD San Carlos vs Escorpiones Belén) ya se
-- había anulado a mano ANTES de que existiera el arrastre (se le devolvió el
-- ×2 a 5 personas, pero sin crédito). Se les otorga el crédito que les
-- hubiera correspondido con la regla nueva. Idempotente (ON CONFLICT DO NOTHING).
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_match_id integer := 252;
  v_tid int; v_kickoff timestamptz; v_next_phase text; v_next_matchday integer;
  v_known_users uuid[] := ARRAY[
    'c8d6ed61-b1bb-4db1-8405-969b3b4825a0',
    '7b2a418b-4042-4875-be24-4e827d2057db',
    '615f13ac-8213-4357-bd69-47d52a5b9bbd',
    'f762c454-5b0d-4d39-bb66-1125725dfeed',
    '1d9ed5d0-b71e-4ed8-9940-5362c79fbb4b'
  ];
  r record;
BEGIN
  SELECT tournament_id, kickoff_at INTO v_tid, v_kickoff FROM public.matches WHERE id = v_match_id;
  IF v_tid IS NOT NULL THEN
    SELECT m.phase, m.matchday INTO v_next_phase, v_next_matchday
    FROM public.matches m
    WHERE m.tournament_id = v_tid AND m.kickoff_at > v_kickoff
      AND m.status NOT IN ('cancelled', 'postponed')
    ORDER BY m.kickoff_at ASC LIMIT 1;

    IF v_next_phase IS NOT NULL THEN
      FOR r IN
        SELECT user_id, league_id FROM public.predictions
        WHERE match_id = v_match_id AND user_id = ANY(v_known_users)
      LOOP
        INSERT INTO public.powerup_credits (user_id, league_id, phase, matchday, source_match_id)
        VALUES (r.user_id, r.league_id, v_next_phase, v_next_matchday, v_match_id)
        ON CONFLICT (user_id, league_id, source_match_id) DO NOTHING;
      END LOOP;
    END IF;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
