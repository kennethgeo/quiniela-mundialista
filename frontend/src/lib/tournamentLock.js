import { supabase } from './supabase'
import { kickoffDate } from './matchStatus'

/**
 * Determina si las predicciones globales (campeón y goleador) están bloqueadas.
 *
 * Se bloquean si:
 *  - El admin las bloqueó manualmente (tournament_settings.is_locked = true), o
 *  - Ya inició el primer partido del torneo (kickoff del partido más temprano <= ahora).
 *
 * El bloqueo por inicio del torneo es automático: no depende de que el admin
 * recuerde activar el flag ni de fechas hardcodeadas.
 *
 * @returns {Promise<boolean>} true si las predicciones globales están bloqueadas.
 */
export async function getTournamentLocked() {
  const [{ data: settings }, { data: firstMatch }] = await Promise.all([
    supabase
      .from('tournament_settings')
      .select('is_locked')
      .eq('id', 1)
      .maybeSingle(),
    supabase
      .from('matches')
      .select('kickoff_at')
      .order('kickoff_at', { ascending: true })
      .limit(1)
      .maybeSingle(),
  ])

  const manualLock = settings?.is_locked === true

  const kickoff = kickoffDate(firstMatch?.kickoff_at)
  const hasStarted = !!kickoff && kickoff <= new Date()

  return manualLock || hasStarted
}
