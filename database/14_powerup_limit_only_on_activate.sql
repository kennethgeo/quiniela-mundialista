-- =============================================================================
-- 14_powerup_limit_only_on_activate.sql
-- =============================================================================
-- BUG: si una predicción YA tenía el comodín x2 puesto y el usuario editaba
-- solo el marcador, el guardado (un UPDATE que reenvía use_powerup_x2 = true)
-- era rechazado con "Límite de comodines x2 alcanzado", aunque no estuviera
-- agregando un comodín nuevo.
--
-- CAUSA: check_powerup_limit() valida el límite en CUALQUIER INSERT/UPDATE con
-- use_powerup_x2 = true. Al editar una predicción que ya tenía el x2, el
-- recuento de la jornada no se descuenta a sí misma de forma confiable en un
-- upsert (la fila entrante trae otro id), y si el usuario ya gastó sus
-- comodines de la jornada, la cuenta llega al límite y rebota la edición.
--
-- SOLUCIÓN: validar el límite SOLO cuando el comodín se ACTIVA (alta nueva o
-- transición de apagado -> encendido), no cuando ya estaba puesto y solo se
-- edita el marcador.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.check_powerup_limit() RETURNS trigger AS $$
DECLARE
    v_phase TEXT;
    v_matchday INTEGER;
    v_max_uses INTEGER;
    v_current_uses INTEGER;
BEGIN
    -- Solo validar al ACTIVAR el comodín: alta nueva (INSERT) o cuando antes
    -- estaba apagado y ahora se prende (UPDATE de false -> true). Editar el
    -- marcador de una predicción que ya tenía el x2 no vuelve a validar.
    IF NEW.use_powerup_x2 = TRUE
       AND (TG_OP = 'INSERT' OR OLD.use_powerup_x2 IS DISTINCT FROM TRUE) THEN

        SELECT phase, COALESCE(matchday, 0) INTO v_phase, v_matchday
        FROM public.matches WHERE id = NEW.match_id;

        SELECT max_uses INTO v_max_uses
        FROM public.powerup_limits
        WHERE phase = v_phase AND matchday = v_matchday;

        SELECT COUNT(*) INTO v_current_uses
        FROM public.predictions p
        JOIN public.matches m ON p.match_id = m.id
        WHERE p.user_id = NEW.user_id
          AND p.use_powerup_x2 = TRUE
          AND m.phase = v_phase
          AND COALESCE(m.matchday, 0) = v_matchday
          AND p.id != NEW.id;

        IF v_max_uses IS NOT NULL AND v_current_uses >= v_max_uses THEN
            RAISE EXCEPTION 'Límite de comodines x2 alcanzado para esta fase/jornada.';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- El trigger enforce_powerup_limit ya apunta a esta función; no hace falta
-- recrearlo. Refrescar la caché de PostgREST por las dudas.
NOTIFY pgrst, 'reload schema';
