-- =============================================================================
-- 100_escrituras_del_cliente_en_orden.sql
-- Decimoquinta auditoría (Claude, 27 sep 2026). Dos carreras entre el guardado
-- del cliente y operaciones del grupo, REPRODUCIDAS con dos conexiones en un
-- Postgres 16 local con las funciones de producción. Idempotente.
-- =============================================================================
--
-- 1. SALIR MIENTRAS SE GUARDA DEJABA UNA PREDICCIÓN HUÉRFANA.
--    La política mira `is_league_member` con la foto del guardado; si
--    `salir_de_quiniela` (o una expulsión) borra las predicciones mientras
--    tanto, la fila nueva todavía no es visible para ese DELETE, se confirma
--    después y queda a nombre de alguien que ya no es miembro. Reproducido:
--    «miembros_U=0 preds_U=9502». Con un ×2 de por medio, desde la 99 el
--    cruce termina en deadlock (el borrado de créditos espera la fila del
--    crédito que cobró el guardado) y se cancela la salida.
--    Arreglo: el guardado del CLIENTE toma la fila de la membresía FOR KEY
--    SHARE antes que nada (`a_membresia_viva`, primero por orden alfabético).
--    Salir/expulsar la toman FOR UPDATE al empezar: uno espera al otro. Si
--    gana la salida, el guardado ve que ya no hay membresía y se rechaza con
--    42501; si gana el guardado, la salida borra también su fila. Reproducido:
--    «Ya no sos miembro de esta quiniela» y «miembros_U=0 preds_U=-». Igual
--    para las globales. El backend (service_role) no pasa por acá.
--
-- 2. APAGAR UN ×2 EN LA JORNADA DE UN PARTIDO QUE SE ESTÁ ANULANDO SE TRABABA.
--    Un lote de PredecirJornada que solo toca partidos ABIERTOS (no lo cubre
--    la 99) contra `void_cancelled_match` de otro partido de la misma jornada:
--    la anulación toma el candado de cupo y después la fila de `users` (al
--    recalcular el total); el lote toma la fila de `users` (sus AFTER de
--    recálculo) y DESPUÉS el candado de cupo (el del cobrador, al apagar).
--    Reproducido: `deadlock detected` y se cancela el guardado de la persona.
--    Arreglo: `check_powerup_limit` toma el candado de cupo en el BEFORE
--    siempre que el ×2 CAMBIE (prender o apagar), no solo al prender. Los
--    BEFORE de todas las filas corren antes que cualquier AFTER del lote, así
--    que el candado llega antes que la fila de `users`. Reproducido: los dos
--    terminan. El resto de la función queda igual a producción.
--
-- LO QUE SIGUE ABIERTO, DICHO: si el partido pasa a pospuesto en medio de un
-- guardado que ya bloqueó su fila, o si el creador borra la quiniela mientras
-- alguien guarda, la base detecta el ciclo y cancela EL GUARDADO (reproducido
-- los dos). No queda nada a medias; la app ahora dice «intentá de nuevo».
-- =============================================================================

BEGIN;

-- 1 ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.membresia_viva_al_escribir()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.es_backend() THEN
    PERFORM 1 FROM public.league_members
     WHERE league_id = NEW.league_id AND user_id = NEW.user_id
       FOR KEY SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Ya no sos miembro de esta quiniela' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.membresia_viva_al_escribir() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS a_membresia_viva ON public.predictions;
CREATE TRIGGER a_membresia_viva
  BEFORE INSERT OR UPDATE ON public.predictions
  FOR EACH ROW EXECUTE FUNCTION public.membresia_viva_al_escribir();

DROP TRIGGER IF EXISTS a_membresia_viva ON public.tournament_predictions;
CREATE TRIGGER a_membresia_viva
  BEFORE INSERT OR UPDATE ON public.tournament_predictions
  FOR EACH ROW EXECUTE FUNCTION public.membresia_viva_al_escribir();

-- 2 ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_powerup_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_llave text; v_base integer; v_usados integer; v_creditos integer;
  v_activating boolean; v_prev_x2 boolean;
BEGIN
  SELECT use_powerup_x2 INTO v_prev_x2 FROM public.predictions
   WHERE user_id=NEW.user_id AND league_id=NEW.league_id AND match_id=NEW.match_id;
  v_activating := (NEW.use_powerup_x2 = TRUE) AND (COALESCE(v_prev_x2,FALSE)=FALSE);
  -- (100) El candado de cupo se toma siempre que el ×2 CAMBIE, también al
  -- apagar: así llega antes que la fila de `users` que toman los AFTER del lote.
  IF COALESCE(NEW.use_powerup_x2,FALSE) IS DISTINCT FROM COALESCE(v_prev_x2,FALSE)
     AND NEW.league_id IS NOT NULL THEN
    v_llave := public.llave_cupo(NEW.match_id);
    PERFORM pg_advisory_xact_lock(hashtextextended(
      NEW.user_id::text || NEW.league_id::text || COALESCE(v_llave,''), 0));
  END IF;
  IF v_activating AND NEW.league_id IS NOT NULL THEN
    v_base := public.cupo_powerups(NEW.league_id, NEW.match_id);
    -- (97) La misma cuenta que usan el que cobra y la pantalla.
    SELECT c.usados, c.creditos INTO v_usados, v_creditos
      FROM public._x2_cuenta(NEW.user_id, NEW.league_id, v_llave, NEW.match_id) c;
    IF v_usados >= COALESCE(v_base,0) + COALESCE(v_creditos,0) THEN
      RAISE EXCEPTION 'Límite de comodines x2 alcanzado para esta jornada.';
    END IF;
  END IF;
  RETURN NEW;
END; $function$;

-- Comprobaciones ---------------------------------------------------------------
DO $comprobar$
BEGIN
  IF (SELECT count(*) FROM pg_trigger WHERE tgname = 'a_membresia_viva'
        AND tgrelid IN ('public.predictions'::regclass, 'public.tournament_predictions'::regclass)) <> 2 THEN
    RAISE EXCEPTION '100: faltan los triggers de membresía'; END IF;
  IF has_function_privilege('authenticated', 'public.membresia_viva_al_escribir()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.membresia_viva_al_escribir()', 'EXECUTE') THEN
    RAISE EXCEPTION '100: la función del trigger quedó ejecutable por el cliente'; END IF;
  IF (SELECT prosrc FROM pg_proc WHERE oid = 'public.check_powerup_limit'::regproc) NOT LIKE '%(100)%' THEN
    RAISE EXCEPTION '100: check_powerup_limit no quedó con el candado al apagar'; END IF;
END
$comprobar$;

COMMIT;
