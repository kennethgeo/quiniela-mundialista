-- =============================================================================
-- Quiniela Mundialista - Esquema de Base de Datos
-- FIFA World Cup 2026 - México, Canadá y Estados Unidos
--
-- Ejecutar en el SQL Editor de Supabase.
-- Este archivo contiene:
--   1. Tablas principales
--   2. Políticas de seguridad a nivel de fila (RLS)
--   3. Funciones y triggers
--   4. Índices de rendimiento
--   5. Configuración de Realtime
--   6. Datos semilla (partidos del mundial)
-- =============================================================================


-- =============================================================================
-- SECCIÓN 1: TABLAS
-- =============================================================================

-- 1. Tabla de usuarios (extiende auth.users de Supabase)
-- Se crea automáticamente al registrarse un usuario mediante el trigger handle_new_user
CREATE TABLE public.users (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  display_name TEXT NOT NULL,
  email TEXT,
  avatar_url TEXT,
  total_points INTEGER DEFAULT 0,
  is_admin BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
COMMENT ON TABLE public.users IS 'Perfil público de cada usuario de la quiniela';

-- 2. Tabla de partidos (con soporte a penales)
-- Contiene todos los partidos del mundial, tanto fase de grupos como eliminatorias
CREATE TABLE public.matches (
  id SERIAL PRIMARY KEY,
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  home_flag_url TEXT,
  away_flag_url TEXT,
  home_team_code TEXT NOT NULL DEFAULT 'xx',
  away_team_code TEXT NOT NULL DEFAULT 'xx',
  kickoff_at TIMESTAMPTZ NOT NULL,
  phase TEXT NOT NULL CHECK (phase IN ('groups','round_of_32','round_of_16','quarter_finals','semi_finals','third_place','final')),
  group_name TEXT,
  matchday INTEGER,
  home_goals_actual INTEGER,
  away_goals_actual INTEGER,
  goes_to_penalties BOOLEAN DEFAULT FALSE,
  penalties_winner_real TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','finished')),
  venue TEXT,
  city TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
COMMENT ON TABLE public.matches IS 'Partidos del Mundial FIFA 2026 (con soporte a definición por penales)';

-- 3. Tabla de predicciones (con soporte para motor de puntuación avanzado + powerup)
CREATE TYPE prediction_type_enum AS ENUM ('Marcador', 'Solo_Ganador');
CREATE TABLE public.predictions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
  match_id INTEGER REFERENCES public.matches(id) ON DELETE CASCADE NOT NULL,
  prediction_type prediction_type_enum NOT NULL DEFAULT 'Marcador',
  home_goals_pred INTEGER CHECK (home_goals_pred >= 0),
  away_goals_pred INTEGER CHECK (away_goals_pred >= 0),
  penalties_winner_pred TEXT,
  use_powerup_x2 BOOLEAN DEFAULT FALSE,
  points_earned INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, match_id)
);
COMMENT ON TABLE public.predictions IS 'Predicciones de marcador o ganador con soporte a powerup x2';

-- 4. Tabla de ligas privadas
-- Permite a los usuarios crear grupos privados para competir entre amigos
CREATE TABLE public.leagues (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  invitation_code TEXT UNIQUE NOT NULL,
  admin_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
COMMENT ON TABLE public.leagues IS 'Ligas privadas creadas por los usuarios';

-- 5. Tabla de miembros de liga
-- Relación muchos-a-muchos entre usuarios y ligas
CREATE TABLE public.league_members (
  league_id UUID REFERENCES public.leagues(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (league_id, user_id)
);
COMMENT ON TABLE public.league_members IS 'Membresías de usuarios en ligas privadas';


-- =============================================================================
-- SECCIÓN 2: POLÍTICAS DE SEGURIDAD A NIVEL DE FILA (RLS)
-- =============================================================================

-- Habilitar RLS en todas las tablas
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leagues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.league_members ENABLE ROW LEVEL SECURITY;

-- -------------------------
-- Políticas para: users
-- -------------------------

-- Cualquier usuario autenticado puede ver los perfiles de otros
CREATE POLICY "users_select_authenticated"
  ON public.users FOR SELECT
  TO authenticated
  USING (true);

-- Un usuario solo puede actualizar su propio perfil
CREATE POLICY "users_update_own"
  ON public.users FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- La inserción se maneja exclusivamente desde el trigger handle_new_user
-- No se permite inserción directa por usuarios autenticados
CREATE POLICY "users_insert_via_trigger"
  ON public.users FOR INSERT
  TO service_role
  WITH CHECK (true);

-- -------------------------
-- Políticas para: matches
-- -------------------------

-- Cualquier usuario autenticado puede ver los partidos
CREATE POLICY "matches_select_authenticated"
  ON public.matches FOR SELECT
  TO authenticated
  USING (true);

-- Solo el service_role puede insertar partidos (carga inicial o administración)
CREATE POLICY "matches_insert_service_role"
  ON public.matches FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Solo el service_role puede actualizar partidos (resultados, estados)
CREATE POLICY "matches_update_service_role"
  ON public.matches FOR UPDATE
  TO service_role
  WITH CHECK (true);

-- -------------------------
-- Políticas para: predictions
-- -------------------------

-- Un usuario puede insertar su propia predicción si el partido no está bloqueado
-- (falta más de 15 minutos para el kickoff)
CREATE POLICY "predictions_insert_own_unlocked"
  ON public.predictions FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND (
      SELECT kickoff_at - interval '15 minutes' > now()
      FROM public.matches
      WHERE id = match_id
    )
  );

-- Un usuario puede actualizar su propia predicción si el partido no está bloqueado
CREATE POLICY "predictions_update_own_unlocked"
  ON public.predictions FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND (
      SELECT kickoff_at - interval '15 minutes' > now()
      FROM public.matches
      WHERE id = match_id
    )
  );

-- Un usuario siempre puede ver sus propias predicciones
CREATE POLICY "predictions_select_own"
  ON public.predictions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Un usuario puede ver las predicciones de otros solo cuando el partido ya no está pendiente
-- (ya comenzó o finalizó)
CREATE POLICY "predictions_select_others_not_pending"
  ON public.predictions FOR SELECT
  TO authenticated
  USING (
    (SELECT status FROM public.matches WHERE id = match_id) != 'pending'
  );

-- El service_role puede actualizar predicciones (para el motor de puntuación)
CREATE POLICY "predictions_update_service_role"
  ON public.predictions FOR UPDATE
  TO service_role
  WITH CHECK (true);

-- -------------------------
-- Políticas para: leagues
-- -------------------------

-- Un usuario puede ver las ligas de las que es miembro
CREATE POLICY "leagues_select_members"
  ON public.leagues FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.league_members
      WHERE league_id = id AND user_id = auth.uid()
    )
  );

-- Cualquier usuario autenticado puede crear una liga
CREATE POLICY "leagues_insert_authenticated"
  ON public.leagues FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = admin_id);

-- Solo el administrador de la liga puede actualizarla
CREATE POLICY "leagues_update_admin"
  ON public.leagues FOR UPDATE
  TO authenticated
  USING (auth.uid() = admin_id)
  WITH CHECK (auth.uid() = admin_id);

-- Solo el administrador de la liga puede eliminarla
CREATE POLICY "leagues_delete_admin"
  ON public.leagues FOR DELETE
  TO authenticated
  USING (auth.uid() = admin_id);

-- -------------------------
-- Políticas para: league_members
-- -------------------------

-- Los miembros de una liga pueden ver a los demás miembros
CREATE POLICY "league_members_select_members"
  ON public.league_members FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.league_members lm
      WHERE lm.league_id = league_id AND lm.user_id = auth.uid()
    )
  );

-- Cualquier usuario autenticado puede unirse a una liga (insertar su membresía)
CREATE POLICY "league_members_insert_self"
  ON public.league_members FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- El admin de la liga o el propio usuario puede eliminar la membresía
CREATE POLICY "league_members_delete_admin_or_self"
  ON public.league_members FOR DELETE
  TO authenticated
  USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM public.leagues
      WHERE id = league_id AND admin_id = auth.uid()
    )
  );


-- =============================================================================
-- SECCIÓN 3: FUNCIONES Y TRIGGERS
-- =============================================================================

-- Función: crear perfil de usuario automáticamente al registrarse
-- Se ejecuta mediante un trigger en auth.users
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (id, display_name, email, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(
      NEW.raw_user_meta_data ->> 'display_name',
      NEW.raw_user_meta_data ->> 'full_name',
      NEW.raw_user_meta_data ->> 'name',
      split_part(NEW.email, '@', 1)
    ),
    NEW.email,
    COALESCE(
      NEW.raw_user_meta_data ->> 'avatar_url',
      NEW.raw_user_meta_data ->> 'picture',
      NULL
    )
  );
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_new_user IS 'Crea automáticamente un perfil en public.users cuando se registra un usuario en auth.users';

-- Trigger: ejecutar handle_new_user después de cada inserción en auth.users
CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Función: actualizar el campo updated_at automáticamente
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.update_updated_at IS 'Actualiza automáticamente la columna updated_at al modificar un registro';

-- Trigger: actualizar updated_at en la tabla users
CREATE OR REPLACE TRIGGER users_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

-- Trigger: actualizar updated_at en la tabla predictions
CREATE OR REPLACE TRIGGER predictions_updated_at
  BEFORE UPDATE ON public.predictions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();


-- =============================================================================
-- SECCIÓN 4: ÍNDICES DE RENDIMIENTO
-- =============================================================================

-- Índice para buscar predicciones por partido (JOIN frecuente con matches)
CREATE INDEX idx_predictions_match_id ON public.predictions (match_id);

-- Índice para ordenar partidos por fecha de inicio
CREATE INDEX idx_matches_kickoff_at ON public.matches (kickoff_at);

-- Índice para filtrar partidos por fase
CREATE INDEX idx_matches_phase ON public.matches (phase);

-- Índice para el ranking global (ordenado descendente por puntos)
CREATE INDEX idx_users_total_points_desc ON public.users (total_points DESC);

-- Índice para buscar membresías por usuario
CREATE INDEX idx_league_members_user_id ON public.league_members (user_id);


-- =============================================================================
-- SECCIÓN 5: CONFIGURACIÓN DE REALTIME
-- =============================================================================

-- Verificar que la publicación de realtime existe, si no, crearla
-- Esta publicación es necesaria para que Supabase emita eventos en tiempo real

-- Habilitar Realtime para tabla users (actualizaciones de puntos del leaderboard)
ALTER PUBLICATION supabase_realtime ADD TABLE public.users;

-- Habilitar Realtime para tabla predictions (cambios en predicciones)
ALTER PUBLICATION supabase_realtime ADD TABLE public.predictions;

-- Habilitar Realtime para tabla matches (actualizaciones de resultados)
ALTER PUBLICATION supabase_realtime ADD TABLE public.matches;


-- =============================================================================
-- SECCIÓN 6: DATOS SEMILLA - PARTIDOS FIFA WORLD CUP 2026
-- =============================================================================

-- -----------------------------------------
-- Grupo A: México, Sudáfrica, Corea del Sur, Chequia
-- -----------------------------------------

-- Jornada 1
INSERT INTO public.matches (home_team, away_team, home_flag_url, away_flag_url, home_team_code, away_team_code, kickoff_at, phase, group_name, matchday)
VALUES
  ('Mexico', 'South Africa', 'https://flagcdn.com/w80/mx.png', 'https://flagcdn.com/w80/za.png', 'mx', 'za', '2026-06-11T17:00:00Z', 'groups', 'A', 1),
  ('South Korea', 'Czechia', 'https://flagcdn.com/w80/kr.png', 'https://flagcdn.com/w80/cz.png', 'kr', 'cz', '2026-06-11T20:00:00Z', 'groups', 'A', 1);

-- Jornada 2
INSERT INTO public.matches (home_team, away_team, home_flag_url, away_flag_url, home_team_code, away_team_code, kickoff_at, phase, group_name, matchday)
VALUES
  ('Mexico', 'South Korea', 'https://flagcdn.com/w80/mx.png', 'https://flagcdn.com/w80/kr.png', 'mx', 'kr', '2026-06-16T17:00:00Z', 'groups', 'A', 2),
  ('South Africa', 'Czechia', 'https://flagcdn.com/w80/za.png', 'https://flagcdn.com/w80/cz.png', 'za', 'cz', '2026-06-16T20:00:00Z', 'groups', 'A', 2);

-- Jornada 3
INSERT INTO public.matches (home_team, away_team, home_flag_url, away_flag_url, home_team_code, away_team_code, kickoff_at, phase, group_name, matchday)
VALUES
  ('Mexico', 'Czechia', 'https://flagcdn.com/w80/mx.png', 'https://flagcdn.com/w80/cz.png', 'mx', 'cz', '2026-06-23T17:00:00Z', 'groups', 'A', 3),
  ('South Africa', 'South Korea', 'https://flagcdn.com/w80/za.png', 'https://flagcdn.com/w80/kr.png', 'za', 'kr', '2026-06-23T20:00:00Z', 'groups', 'A', 3);

-- -----------------------------------------
-- Grupo B: Canadá, Suiza, Qatar, Bosnia-Herzegovina
-- -----------------------------------------

-- Jornada 1
INSERT INTO public.matches (home_team, away_team, home_flag_url, away_flag_url, home_team_code, away_team_code, kickoff_at, phase, group_name, matchday)
VALUES
  ('Canada', 'Switzerland', 'https://flagcdn.com/w80/ca.png', 'https://flagcdn.com/w80/ch.png', 'ca', 'ch', '2026-06-11T23:00:00Z', 'groups', 'B', 1),
  ('Qatar', 'Bosnia-Herzegovina', 'https://flagcdn.com/w80/qa.png', 'https://flagcdn.com/w80/ba.png', 'qa', 'ba', '2026-06-11T22:00:00Z', 'groups', 'B', 1);

-- Jornada 2
INSERT INTO public.matches (home_team, away_team, home_flag_url, away_flag_url, home_team_code, away_team_code, kickoff_at, phase, group_name, matchday)
VALUES
  ('Canada', 'Qatar', 'https://flagcdn.com/w80/ca.png', 'https://flagcdn.com/w80/qa.png', 'ca', 'qa', '2026-06-16T23:00:00Z', 'groups', 'B', 2),
  ('Switzerland', 'Bosnia-Herzegovina', 'https://flagcdn.com/w80/ch.png', 'https://flagcdn.com/w80/ba.png', 'ch', 'ba', '2026-06-16T22:00:00Z', 'groups', 'B', 2);

-- Jornada 3
INSERT INTO public.matches (home_team, away_team, home_flag_url, away_flag_url, home_team_code, away_team_code, kickoff_at, phase, group_name, matchday)
VALUES
  ('Canada', 'Bosnia-Herzegovina', 'https://flagcdn.com/w80/ca.png', 'https://flagcdn.com/w80/ba.png', 'ca', 'ba', '2026-06-23T23:00:00Z', 'groups', 'B', 3),
  ('Switzerland', 'Qatar', 'https://flagcdn.com/w80/ch.png', 'https://flagcdn.com/w80/qa.png', 'ch', 'qa', '2026-06-23T22:00:00Z', 'groups', 'B', 3);

-- -----------------------------------------
-- Grupo C: Brasil, Marruecos, Escocia, Haití
-- -----------------------------------------

-- Jornada 1
INSERT INTO public.matches (home_team, away_team, home_flag_url, away_flag_url, home_team_code, away_team_code, kickoff_at, phase, group_name, matchday)
VALUES
  ('Brazil', 'Morocco', 'https://flagcdn.com/w80/br.png', 'https://flagcdn.com/w80/ma.png', 'br', 'ma', '2026-06-12T17:00:00Z', 'groups', 'C', 1),
  ('Scotland', 'Haiti', 'https://flagcdn.com/w80/gb-sct.png', 'https://flagcdn.com/w80/ht.png', 'gb-sct', 'ht', '2026-06-12T20:00:00Z', 'groups', 'C', 1);

-- Jornada 2
INSERT INTO public.matches (home_team, away_team, home_flag_url, away_flag_url, home_team_code, away_team_code, kickoff_at, phase, group_name, matchday)
VALUES
  ('Brazil', 'Scotland', 'https://flagcdn.com/w80/br.png', 'https://flagcdn.com/w80/gb-sct.png', 'br', 'gb-sct', '2026-06-17T17:00:00Z', 'groups', 'C', 2),
  ('Morocco', 'Haiti', 'https://flagcdn.com/w80/ma.png', 'https://flagcdn.com/w80/ht.png', 'ma', 'ht', '2026-06-17T20:00:00Z', 'groups', 'C', 2);

-- Jornada 3
INSERT INTO public.matches (home_team, away_team, home_flag_url, away_flag_url, home_team_code, away_team_code, kickoff_at, phase, group_name, matchday)
VALUES
  ('Brazil', 'Haiti', 'https://flagcdn.com/w80/br.png', 'https://flagcdn.com/w80/ht.png', 'br', 'ht', '2026-06-24T17:00:00Z', 'groups', 'C', 3),
  ('Morocco', 'Scotland', 'https://flagcdn.com/w80/ma.png', 'https://flagcdn.com/w80/gb-sct.png', 'ma', 'gb-sct', '2026-06-24T20:00:00Z', 'groups', 'C', 3);

-- -----------------------------------------
-- Grupo D: Estados Unidos, Paraguay, Australia, Türkiye
-- -----------------------------------------

-- Jornada 1
INSERT INTO public.matches (home_team, away_team, home_flag_url, away_flag_url, home_team_code, away_team_code, kickoff_at, phase, group_name, matchday)
VALUES
  ('USA', 'Paraguay', 'https://flagcdn.com/w80/us.png', 'https://flagcdn.com/w80/py.png', 'us', 'py', '2026-06-12T23:00:00Z', 'groups', 'D', 1),
  ('Australia', 'Türkiye', 'https://flagcdn.com/w80/au.png', 'https://flagcdn.com/w80/tr.png', 'au', 'tr', '2026-06-12T22:00:00Z', 'groups', 'D', 1);

-- Jornada 2
INSERT INTO public.matches (home_team, away_team, home_flag_url, away_flag_url, home_team_code, away_team_code, kickoff_at, phase, group_name, matchday)
VALUES
  ('USA', 'Australia', 'https://flagcdn.com/w80/us.png', 'https://flagcdn.com/w80/au.png', 'us', 'au', '2026-06-17T23:00:00Z', 'groups', 'D', 2),
  ('Paraguay', 'Türkiye', 'https://flagcdn.com/w80/py.png', 'https://flagcdn.com/w80/tr.png', 'py', 'tr', '2026-06-17T22:00:00Z', 'groups', 'D', 2);

-- Jornada 3
INSERT INTO public.matches (home_team, away_team, home_flag_url, away_flag_url, home_team_code, away_team_code, kickoff_at, phase, group_name, matchday)
VALUES
  ('USA', 'Türkiye', 'https://flagcdn.com/w80/us.png', 'https://flagcdn.com/w80/tr.png', 'us', 'tr', '2026-06-24T23:00:00Z', 'groups', 'D', 3),
  ('Paraguay', 'Australia', 'https://flagcdn.com/w80/py.png', 'https://flagcdn.com/w80/au.png', 'py', 'au', '2026-06-24T22:00:00Z', 'groups', 'D', 3);

-- -----------------------------------------
-- Grupo E: Alemania, Ecuador, Costa de Marfil, Curazao
-- -----------------------------------------

-- Jornada 1
INSERT INTO public.matches (home_team, away_team, home_flag_url, away_flag_url, home_team_code, away_team_code, kickoff_at, phase, group_name, matchday)
VALUES
  ('Germany', 'Ecuador', 'https://flagcdn.com/w80/de.png', 'https://flagcdn.com/w80/ec.png', 'de', 'ec', '2026-06-13T17:00:00Z', 'groups', 'E', 1),
  ('Ivory Coast', 'Curaçao', 'https://flagcdn.com/w80/ci.png', 'https://flagcdn.com/w80/cw.png', 'ci', 'cw', '2026-06-13T20:00:00Z', 'groups', 'E', 1);

-- Jornada 2
INSERT INTO public.matches (home_team, away_team, home_flag_url, away_flag_url, home_team_code, away_team_code, kickoff_at, phase, group_name, matchday)
VALUES
  ('Germany', 'Ivory Coast', 'https://flagcdn.com/w80/de.png', 'https://flagcdn.com/w80/ci.png', 'de', 'ci', '2026-06-18T17:00:00Z', 'groups', 'E', 2),
  ('Ecuador', 'Curaçao', 'https://flagcdn.com/w80/ec.png', 'https://flagcdn.com/w80/cw.png', 'ec', 'cw', '2026-06-18T20:00:00Z', 'groups', 'E', 2);

-- Jornada 3
INSERT INTO public.matches (home_team, away_team, home_flag_url, away_flag_url, home_team_code, away_team_code, kickoff_at, phase, group_name, matchday)
VALUES
  ('Germany', 'Curaçao', 'https://flagcdn.com/w80/de.png', 'https://flagcdn.com/w80/cw.png', 'de', 'cw', '2026-06-25T17:00:00Z', 'groups', 'E', 3),
  ('Ecuador', 'Ivory Coast', 'https://flagcdn.com/w80/ec.png', 'https://flagcdn.com/w80/ci.png', 'ec', 'ci', '2026-06-25T20:00:00Z', 'groups', 'E', 3);

-- -----------------------------------------
-- Grupo F: Países Bajos, Japón, Túnez, Suecia
-- -----------------------------------------

-- Jornada 1
INSERT INTO public.matches (home_team, away_team, home_flag_url, away_flag_url, home_team_code, away_team_code, kickoff_at, phase, group_name, matchday)
VALUES
  ('Netherlands', 'Japan', 'https://flagcdn.com/w80/nl.png', 'https://flagcdn.com/w80/jp.png', 'nl', 'jp', '2026-06-13T23:00:00Z', 'groups', 'F', 1),
  ('Tunisia', 'Sweden', 'https://flagcdn.com/w80/tn.png', 'https://flagcdn.com/w80/se.png', 'tn', 'se', '2026-06-13T22:00:00Z', 'groups', 'F', 1);

-- Jornada 2
INSERT INTO public.matches (home_team, away_team, home_flag_url, away_flag_url, home_team_code, away_team_code, kickoff_at, phase, group_name, matchday)
VALUES
  ('Netherlands', 'Tunisia', 'https://flagcdn.com/w80/nl.png', 'https://flagcdn.com/w80/tn.png', 'nl', 'tn', '2026-06-18T23:00:00Z', 'groups', 'F', 2),
  ('Japan', 'Sweden', 'https://flagcdn.com/w80/jp.png', 'https://flagcdn.com/w80/se.png', 'jp', 'se', '2026-06-18T22:00:00Z', 'groups', 'F', 2);

-- Jornada 3
INSERT INTO public.matches (home_team, away_team, home_flag_url, away_flag_url, home_team_code, away_team_code, kickoff_at, phase, group_name, matchday)
VALUES
  ('Netherlands', 'Sweden', 'https://flagcdn.com/w80/nl.png', 'https://flagcdn.com/w80/se.png', 'nl', 'se', '2026-06-25T23:00:00Z', 'groups', 'F', 3),
  ('Japan', 'Tunisia', 'https://flagcdn.com/w80/jp.png', 'https://flagcdn.com/w80/tn.png', 'jp', 'tn', '2026-06-25T22:00:00Z', 'groups', 'F', 3);

-- -----------------------------------------
-- Grupo G: Bélgica, Irán, Egipto, Nueva Zelanda
-- -----------------------------------------

-- Jornada 1
INSERT INTO public.matches (home_team, away_team, home_flag_url, away_flag_url, home_team_code, away_team_code, kickoff_at, phase, group_name, matchday)
VALUES
  ('Belgium', 'Iran', 'https://flagcdn.com/w80/be.png', 'https://flagcdn.com/w80/ir.png', 'be', 'ir', '2026-06-14T17:00:00Z', 'groups', 'G', 1),
  ('Egypt', 'New Zealand', 'https://flagcdn.com/w80/eg.png', 'https://flagcdn.com/w80/nz.png', 'eg', 'nz', '2026-06-14T20:00:00Z', 'groups', 'G', 1);

-- Jornada 2
INSERT INTO public.matches (home_team, away_team, home_flag_url, away_flag_url, home_team_code, away_team_code, kickoff_at, phase, group_name, matchday)
VALUES
  ('Belgium', 'Egypt', 'https://flagcdn.com/w80/be.png', 'https://flagcdn.com/w80/eg.png', 'be', 'eg', '2026-06-19T17:00:00Z', 'groups', 'G', 2),
  ('Iran', 'New Zealand', 'https://flagcdn.com/w80/ir.png', 'https://flagcdn.com/w80/nz.png', 'ir', 'nz', '2026-06-19T20:00:00Z', 'groups', 'G', 2);

-- Jornada 3
INSERT INTO public.matches (home_team, away_team, home_flag_url, away_flag_url, home_team_code, away_team_code, kickoff_at, phase, group_name, matchday)
VALUES
  ('Belgium', 'New Zealand', 'https://flagcdn.com/w80/be.png', 'https://flagcdn.com/w80/nz.png', 'be', 'nz', '2026-06-26T17:00:00Z', 'groups', 'G', 3),
  ('Iran', 'Egypt', 'https://flagcdn.com/w80/ir.png', 'https://flagcdn.com/w80/eg.png', 'ir', 'eg', '2026-06-26T20:00:00Z', 'groups', 'G', 3);

-- -----------------------------------------
-- Grupo H: España, Uruguay, Arabia Saudita, Cabo Verde
-- -----------------------------------------

-- Jornada 1
INSERT INTO public.matches (home_team, away_team, home_flag_url, away_flag_url, home_team_code, away_team_code, kickoff_at, phase, group_name, matchday)
VALUES
  ('Spain', 'Uruguay', 'https://flagcdn.com/w80/es.png', 'https://flagcdn.com/w80/uy.png', 'es', 'uy', '2026-06-14T23:00:00Z', 'groups', 'H', 1),
  ('Saudi Arabia', 'Cape Verde', 'https://flagcdn.com/w80/sa.png', 'https://flagcdn.com/w80/cv.png', 'sa', 'cv', '2026-06-14T22:00:00Z', 'groups', 'H', 1);

-- Jornada 2
INSERT INTO public.matches (home_team, away_team, home_flag_url, away_flag_url, home_team_code, away_team_code, kickoff_at, phase, group_name, matchday)
VALUES
  ('Spain', 'Saudi Arabia', 'https://flagcdn.com/w80/es.png', 'https://flagcdn.com/w80/sa.png', 'es', 'sa', '2026-06-19T23:00:00Z', 'groups', 'H', 2),
  ('Uruguay', 'Cape Verde', 'https://flagcdn.com/w80/uy.png', 'https://flagcdn.com/w80/cv.png', 'uy', 'cv', '2026-06-19T22:00:00Z', 'groups', 'H', 2);

-- Jornada 3
INSERT INTO public.matches (home_team, away_team, home_flag_url, away_flag_url, home_team_code, away_team_code, kickoff_at, phase, group_name, matchday)
VALUES
  ('Spain', 'Cape Verde', 'https://flagcdn.com/w80/es.png', 'https://flagcdn.com/w80/cv.png', 'es', 'cv', '2026-06-26T23:00:00Z', 'groups', 'H', 3),
  ('Uruguay', 'Saudi Arabia', 'https://flagcdn.com/w80/uy.png', 'https://flagcdn.com/w80/sa.png', 'uy', 'sa', '2026-06-26T22:00:00Z', 'groups', 'H', 3);

-- -----------------------------------------
-- Grupo I: Francia, Senegal, Noruega, Irak
-- -----------------------------------------

-- Jornada 1
INSERT INTO public.matches (home_team, away_team, home_flag_url, away_flag_url, home_team_code, away_team_code, kickoff_at, phase, group_name, matchday)
VALUES
  ('France', 'Senegal', 'https://flagcdn.com/w80/fr.png', 'https://flagcdn.com/w80/sn.png', 'fr', 'sn', '2026-06-15T17:00:00Z', 'groups', 'I', 1),
  ('Norway', 'Iraq', 'https://flagcdn.com/w80/no.png', 'https://flagcdn.com/w80/iq.png', 'no', 'iq', '2026-06-15T20:00:00Z', 'groups', 'I', 1);

-- Jornada 2
INSERT INTO public.matches (home_team, away_team, home_flag_url, away_flag_url, home_team_code, away_team_code, kickoff_at, phase, group_name, matchday)
VALUES
  ('France', 'Norway', 'https://flagcdn.com/w80/fr.png', 'https://flagcdn.com/w80/no.png', 'fr', 'no', '2026-06-20T17:00:00Z', 'groups', 'I', 2),
  ('Senegal', 'Iraq', 'https://flagcdn.com/w80/sn.png', 'https://flagcdn.com/w80/iq.png', 'sn', 'iq', '2026-06-20T20:00:00Z', 'groups', 'I', 2);

-- Jornada 3
INSERT INTO public.matches (home_team, away_team, home_flag_url, away_flag_url, home_team_code, away_team_code, kickoff_at, phase, group_name, matchday)
VALUES
  ('France', 'Iraq', 'https://flagcdn.com/w80/fr.png', 'https://flagcdn.com/w80/iq.png', 'fr', 'iq', '2026-06-27T17:00:00Z', 'groups', 'I', 3),
  ('Senegal', 'Norway', 'https://flagcdn.com/w80/sn.png', 'https://flagcdn.com/w80/no.png', 'sn', 'no', '2026-06-27T20:00:00Z', 'groups', 'I', 3);

-- -----------------------------------------
-- Grupo J: Argentina, Austria, Argelia, Jordania
-- -----------------------------------------

-- Jornada 1
INSERT INTO public.matches (home_team, away_team, home_flag_url, away_flag_url, home_team_code, away_team_code, kickoff_at, phase, group_name, matchday)
VALUES
  ('Argentina', 'Austria', 'https://flagcdn.com/w80/ar.png', 'https://flagcdn.com/w80/at.png', 'ar', 'at', '2026-06-15T23:00:00Z', 'groups', 'J', 1),
  ('Algeria', 'Jordan', 'https://flagcdn.com/w80/dz.png', 'https://flagcdn.com/w80/jo.png', 'dz', 'jo', '2026-06-15T22:00:00Z', 'groups', 'J', 1);

-- Jornada 2
INSERT INTO public.matches (home_team, away_team, home_flag_url, away_flag_url, home_team_code, away_team_code, kickoff_at, phase, group_name, matchday)
VALUES
  ('Argentina', 'Algeria', 'https://flagcdn.com/w80/ar.png', 'https://flagcdn.com/w80/dz.png', 'ar', 'dz', '2026-06-20T23:00:00Z', 'groups', 'J', 2),
  ('Austria', 'Jordan', 'https://flagcdn.com/w80/at.png', 'https://flagcdn.com/w80/jo.png', 'at', 'jo', '2026-06-20T22:00:00Z', 'groups', 'J', 2);

-- Jornada 3
INSERT INTO public.matches (home_team, away_team, home_flag_url, away_flag_url, home_team_code, away_team_code, kickoff_at, phase, group_name, matchday)
VALUES
  ('Argentina', 'Jordan', 'https://flagcdn.com/w80/ar.png', 'https://flagcdn.com/w80/jo.png', 'ar', 'jo', '2026-06-27T23:00:00Z', 'groups', 'J', 3),
  ('Austria', 'Algeria', 'https://flagcdn.com/w80/at.png', 'https://flagcdn.com/w80/dz.png', 'at', 'dz', '2026-06-27T22:00:00Z', 'groups', 'J', 3);

-- -----------------------------------------
-- Grupo K: Portugal, Colombia, Uzbekistán, RD Congo
-- -----------------------------------------

-- Jornada 1
INSERT INTO public.matches (home_team, away_team, home_flag_url, away_flag_url, home_team_code, away_team_code, kickoff_at, phase, group_name, matchday)
VALUES
  ('Portugal', 'Colombia', 'https://flagcdn.com/w80/pt.png', 'https://flagcdn.com/w80/co.png', 'pt', 'co', '2026-06-13T17:00:00Z', 'groups', 'K', 1),
  ('Uzbekistan', 'DR Congo', 'https://flagcdn.com/w80/uz.png', 'https://flagcdn.com/w80/cd.png', 'uz', 'cd', '2026-06-13T20:00:00Z', 'groups', 'K', 1);

-- Jornada 2
INSERT INTO public.matches (home_team, away_team, home_flag_url, away_flag_url, home_team_code, away_team_code, kickoff_at, phase, group_name, matchday)
VALUES
  ('Portugal', 'Uzbekistan', 'https://flagcdn.com/w80/pt.png', 'https://flagcdn.com/w80/uz.png', 'pt', 'uz', '2026-06-18T17:00:00Z', 'groups', 'K', 2),
  ('Colombia', 'DR Congo', 'https://flagcdn.com/w80/co.png', 'https://flagcdn.com/w80/cd.png', 'co', 'cd', '2026-06-18T20:00:00Z', 'groups', 'K', 2);

-- Jornada 3
INSERT INTO public.matches (home_team, away_team, home_flag_url, away_flag_url, home_team_code, away_team_code, kickoff_at, phase, group_name, matchday)
VALUES
  ('Portugal', 'DR Congo', 'https://flagcdn.com/w80/pt.png', 'https://flagcdn.com/w80/cd.png', 'pt', 'cd', '2026-06-25T17:00:00Z', 'groups', 'K', 3),
  ('Colombia', 'Uzbekistan', 'https://flagcdn.com/w80/co.png', 'https://flagcdn.com/w80/uz.png', 'co', 'uz', '2026-06-25T20:00:00Z', 'groups', 'K', 3);

-- -----------------------------------------
-- Grupo L: Inglaterra, Croacia, Ghana, Panamá
-- -----------------------------------------

-- Jornada 1
INSERT INTO public.matches (home_team, away_team, home_flag_url, away_flag_url, home_team_code, away_team_code, kickoff_at, phase, group_name, matchday)
VALUES
  ('England', 'Croatia', 'https://flagcdn.com/w80/gb-eng.png', 'https://flagcdn.com/w80/hr.png', 'gb-eng', 'hr', '2026-06-14T17:00:00Z', 'groups', 'L', 1),
  ('Ghana', 'Panama', 'https://flagcdn.com/w80/gh.png', 'https://flagcdn.com/w80/pa.png', 'gh', 'pa', '2026-06-14T20:00:00Z', 'groups', 'L', 1);

-- Jornada 2
INSERT INTO public.matches (home_team, away_team, home_flag_url, away_flag_url, home_team_code, away_team_code, kickoff_at, phase, group_name, matchday)
VALUES
  ('England', 'Ghana', 'https://flagcdn.com/w80/gb-eng.png', 'https://flagcdn.com/w80/gh.png', 'gb-eng', 'gh', '2026-06-19T17:00:00Z', 'groups', 'L', 2),
  ('Croatia', 'Panama', 'https://flagcdn.com/w80/hr.png', 'https://flagcdn.com/w80/pa.png', 'hr', 'pa', '2026-06-19T20:00:00Z', 'groups', 'L', 2);

-- Jornada 3
INSERT INTO public.matches (home_team, away_team, home_flag_url, away_flag_url, home_team_code, away_team_code, kickoff_at, phase, group_name, matchday)
VALUES
  ('England', 'Panama', 'https://flagcdn.com/w80/gb-eng.png', 'https://flagcdn.com/w80/pa.png', 'gb-eng', 'pa', '2026-06-26T17:00:00Z', 'groups', 'L', 3),
  ('Croatia', 'Ghana', 'https://flagcdn.com/w80/hr.png', 'https://flagcdn.com/w80/gh.png', 'hr', 'gh', '2026-06-26T20:00:00Z', 'groups', 'L', 3);


-- =============================================================================
-- PARTIDOS DE FASE ELIMINATORIA (Placeholders - TBD)
-- Los equipos se actualizan conforme avanzan en el torneo
-- =============================================================================

-- -----------------------------------------
-- Ronda de 32 (16 partidos) - Junio 28 a Julio 3
-- -----------------------------------------
INSERT INTO public.matches (home_team, away_team, home_flag_url, away_flag_url, home_team_code, away_team_code, kickoff_at, phase)
VALUES
  -- Junio 28
  ('TBD', 'TBD', NULL, NULL, 'xx', 'xx', '2026-06-28T20:00:00Z', 'round_of_32'),
  -- Junio 29
  ('TBD', 'TBD', NULL, NULL, 'xx', 'xx', '2026-06-29T16:00:00Z', 'round_of_32'),
  ('TBD', 'TBD', NULL, NULL, 'xx', 'xx', '2026-06-29T19:00:00Z', 'round_of_32'),
  ('TBD', 'TBD', NULL, NULL, 'xx', 'xx', '2026-06-29T22:00:00Z', 'round_of_32'),
  -- Junio 30
  ('TBD', 'TBD', NULL, NULL, 'xx', 'xx', '2026-06-30T16:00:00Z', 'round_of_32'),
  ('TBD', 'TBD', NULL, NULL, 'xx', 'xx', '2026-06-30T19:00:00Z', 'round_of_32'),
  ('TBD', 'TBD', NULL, NULL, 'xx', 'xx', '2026-06-30T22:00:00Z', 'round_of_32'),
  -- Julio 1
  ('TBD', 'TBD', NULL, NULL, 'xx', 'xx', '2026-07-01T16:00:00Z', 'round_of_32'),
  ('TBD', 'TBD', NULL, NULL, 'xx', 'xx', '2026-07-01T19:00:00Z', 'round_of_32'),
  ('TBD', 'TBD', NULL, NULL, 'xx', 'xx', '2026-07-01T22:00:00Z', 'round_of_32'),
  -- Julio 2
  ('TBD', 'TBD', NULL, NULL, 'xx', 'xx', '2026-07-02T16:00:00Z', 'round_of_32'),
  ('TBD', 'TBD', NULL, NULL, 'xx', 'xx', '2026-07-02T19:00:00Z', 'round_of_32'),
  ('TBD', 'TBD', NULL, NULL, 'xx', 'xx', '2026-07-02T22:00:00Z', 'round_of_32'),
  -- Julio 3
  ('TBD', 'TBD', NULL, NULL, 'xx', 'xx', '2026-07-03T16:00:00Z', 'round_of_32'),
  ('TBD', 'TBD', NULL, NULL, 'xx', 'xx', '2026-07-03T19:00:00Z', 'round_of_32'),
  ('TBD', 'TBD', NULL, NULL, 'xx', 'xx', '2026-07-03T22:00:00Z', 'round_of_32');

-- -----------------------------------------
-- Octavos de final / Ronda de 16 (8 partidos) - Julio 4-7
-- -----------------------------------------
INSERT INTO public.matches (home_team, away_team, home_flag_url, away_flag_url, home_team_code, away_team_code, kickoff_at, phase)
VALUES
  -- Julio 4
  ('TBD', 'TBD', NULL, NULL, 'xx', 'xx', '2026-07-04T17:00:00Z', 'round_of_16'),
  ('TBD', 'TBD', NULL, NULL, 'xx', 'xx', '2026-07-04T21:00:00Z', 'round_of_16'),
  -- Julio 5
  ('TBD', 'TBD', NULL, NULL, 'xx', 'xx', '2026-07-05T17:00:00Z', 'round_of_16'),
  ('TBD', 'TBD', NULL, NULL, 'xx', 'xx', '2026-07-05T21:00:00Z', 'round_of_16'),
  -- Julio 6
  ('TBD', 'TBD', NULL, NULL, 'xx', 'xx', '2026-07-06T17:00:00Z', 'round_of_16'),
  ('TBD', 'TBD', NULL, NULL, 'xx', 'xx', '2026-07-06T21:00:00Z', 'round_of_16'),
  -- Julio 7
  ('TBD', 'TBD', NULL, NULL, 'xx', 'xx', '2026-07-07T17:00:00Z', 'round_of_16'),
  ('TBD', 'TBD', NULL, NULL, 'xx', 'xx', '2026-07-07T21:00:00Z', 'round_of_16');

-- -----------------------------------------
-- Cuartos de final (4 partidos) - Julio 9-11
-- -----------------------------------------
INSERT INTO public.matches (home_team, away_team, home_flag_url, away_flag_url, home_team_code, away_team_code, kickoff_at, phase)
VALUES
  ('TBD', 'TBD', NULL, NULL, 'xx', 'xx', '2026-07-09T20:00:00Z', 'quarter_finals'),
  ('TBD', 'TBD', NULL, NULL, 'xx', 'xx', '2026-07-10T20:00:00Z', 'quarter_finals'),
  ('TBD', 'TBD', NULL, NULL, 'xx', 'xx', '2026-07-11T17:00:00Z', 'quarter_finals'),
  ('TBD', 'TBD', NULL, NULL, 'xx', 'xx', '2026-07-11T21:00:00Z', 'quarter_finals');

-- -----------------------------------------
-- Semifinales (2 partidos) - Julio 14-15
-- -----------------------------------------
INSERT INTO public.matches (home_team, away_team, home_flag_url, away_flag_url, home_team_code, away_team_code, kickoff_at, phase)
VALUES
  ('TBD', 'TBD', NULL, NULL, 'xx', 'xx', '2026-07-14T20:00:00Z', 'semi_finals'),
  ('TBD', 'TBD', NULL, NULL, 'xx', 'xx', '2026-07-15T20:00:00Z', 'semi_finals');

-- -----------------------------------------
-- Tercer lugar - Julio 18
-- -----------------------------------------
INSERT INTO public.matches (home_team, away_team, home_flag_url, away_flag_url, home_team_code, away_team_code, kickoff_at, phase)
VALUES
  ('TBD', 'TBD', NULL, NULL, 'xx', 'xx', '2026-07-18T20:00:00Z', 'third_place');

-- -----------------------------------------
-- Gran Final - Julio 19
-- -----------------------------------------
INSERT INTO public.matches (home_team, away_team, home_flag_url, away_flag_url, home_team_code, away_team_code, kickoff_at, phase)
VALUES
  ('TBD', 'TBD', NULL, NULL, 'xx', 'xx', '2026-07-19T19:00:00Z', 'final');


-- =============================================================================
-- FIN DEL ESQUEMA
-- Total: 72 partidos de fase de grupos + 32 partidos eliminatorios = 104 partidos
-- =============================================================================
