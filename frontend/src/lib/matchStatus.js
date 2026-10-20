export const PREDICTION_CLOSE_MINUTES = 15

/* Cuánto puede durar un partido antes de que «sigue en juego» deje de ser
   creíble: 90 minutos + descanso + añadido + prórroga y penales, con margen.
   Por encima de esto, si la base sigue en `pending` es que no nos llegó el
   dato. */
export const MINUTOS_MAXIMOS_DE_PARTIDO = 240

export function kickoffDate(value) {
  if (!value) return null
  if (typeof value !== 'string') return null
  const iso = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? null : date
}

/* REAPERTURA POR PARTIDO (migración 77). Solo la enciende el admin global, y
   solo para cuando el cierre fue un error de los datos: ESPN trae mal la hora
   del saque, o el partido se reprograma.

   SOLO VALE MIENTRAS EL PARTIDO SIGUE `pending` en la base: es lo que exige la
   rama forzada de la RLS desde la migración 105 (`predictions_force_open AND
   status = 'pending'`, leído en producción el 20 oct 2026). En cuanto el sync
   lo marca en vivo, la base deja de aceptar el guardado: decir «Reabierto» ahí
   era ofrecer +/− y un botón que respondía 42501. Antes esta función solo
   excluía terminado/cancelado/pospuesto (lo reprodujo Codex).

   La pantalla NO es la que manda: la política RLS decide. Esto solo hace que
   la pantalla diga lo mismo que la base. */
function reabierto(match, status) {
  return match?.predictions_force_open === true && status === 'pending'
}

function estadoNormal(match, now, status) {
  if (['cancelled', 'canceled'].includes(status)) return { key: 'cancelled', label: 'Cancelado', tone: 'muted', canPredict: false }
  if (status === 'postponed') return { key: 'postponed', label: 'Pospuesto', tone: 'warning', canPredict: false }
  if (status === 'suspended') return { key: 'suspended', label: 'Suspendido', tone: 'warning', canPredict: false }
  if (status === 'finished') return { key: 'finished', label: 'Finalizado', tone: 'muted', canPredict: false }
  if (['in_progress', 'live'].includes(status)) return { key: 'live', label: 'En vivo', tone: 'live', canPredict: false }

  const kickoff = kickoffDate(match?.kickoff_at)
  if (!kickoff) return { key: 'unknown', label: 'Por confirmar', tone: 'muted', canPredict: false }

  const minutesUntilKickoff = (kickoff.getTime() - now.getTime()) / 60000
  if (minutesUntilKickoff <= 0) {
    /* «En juego» acá es una DEDUCCIÓN del reloj, no un dato: la base sigue
       diciendo `pending` y lo único que sabemos es que pasó la hora del saque.
       Sin tope, un partido que el sync nunca actualizó se queda «en juego»
       para siempre — pasó de verdad el 19 sep 2026: Pérez Zeledón–Sporting
       llevaba doce horas terminado (ESPN lo daba FT 1-2) y la app lo seguía
       mostrando en vivo, porque el sync traía cero eventos en cada corrida.
       Pasado el tiempo que puede durar un partido, lo honesto es decir que no
       tenemos el dato, no inventar que se está jugando. */
    if (-minutesUntilKickoff > MINUTOS_MAXIMOS_DE_PARTIDO) {
      return { key: 'stale', label: 'Sin datos', tone: 'muted', canPredict: false }
    }
    return { key: 'started', label: 'En juego', tone: 'live', canPredict: false }
  }
  /* YA DESTAPADO (migración 106): la base guarda el primer destape en
     `destapado_at` y desde ahí la rama normal no deja escribir, aunque después
     se atrase el saque — todos ya vieron las predicciones de todos. Sin esto
     la pantalla decía «Abierto» con el saque atrasado y la base rechazaba el
     guardado (y LLENAR fallaba entero). Solo la reapertura explícita del
     admin lo vuelve a abrir. Una consulta que no pida la columna la trae
     `undefined`: eso no es destapado. */
  if (match?.destapado_at) return { key: 'locked', label: 'Cerrado', tone: 'warning', canPredict: false }
  if (minutesUntilKickoff <= PREDICTION_CLOSE_MINUTES) return { key: 'locked', label: 'Cerrado', tone: 'warning', canPredict: false }
  if (minutesUntilKickoff <= 60) return { key: 'closing', label: 'Cierra pronto', tone: 'warning', canPredict: true }
  return { key: 'open', label: 'Abierto', tone: 'success', canPredict: true }
}

export function matchStatus(match, now = new Date()) {
  const status = String(match?.status || '').toLowerCase()
  const base = estadoNormal(match, now, status)

  /* La reapertura SOLO pisa lo que estaría cerrado. En un partido que todavía
     no empezó no cambia nada —ya está abierto— y decir «Reabierto» ahí sería
     mentirle a quien lo lee. */
  if (!base.canPredict && reabierto(match, status)) {
    return { key: 'reopened', label: 'Reabierto', tone: 'warning', canPredict: true }
  }
  return base
}

export function predictionDeadline(value) {
  const kickoff = kickoffDate(value)
  return kickoff ? new Date(kickoff.getTime() - PREDICTION_CLOSE_MINUTES * 60000) : null
}

export function timeUntilDeadline(value, now = new Date()) {
  const deadline = predictionDeadline(value)
  if (!deadline) return ''
  const minutes = Math.max(0, Math.ceil((deadline.getTime() - now.getTime()) / 60000))
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours < 24) return rest ? `${hours} h ${rest} min` : `${hours} h`
  const days = Math.floor(hours / 24)
  const hoursRest = hours % 24
  return hoursRest ? `${days} d ${hoursRest} h` : `${days} d`
}

export function matchRoundLabel(match) {
  return match?.stage || (match?.matchday ? `Jornada ${match.matchday}` : (match?.phase ? match.phase.replace(/_/g, ' ') : 'Partidos'))
}
