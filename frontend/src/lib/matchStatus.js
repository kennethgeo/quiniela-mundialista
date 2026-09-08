export const PREDICTION_CLOSE_MINUTES = 15

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

   SOLO VALE MIENTRAS EL PARTIDO ESTÁ EN CURSO. En uno finalizado no es
   reabrir, es dejar predecir con el marcador puesto — así que la reapertura se
   apaga sola al terminar el partido y nadie tiene que acordarse de nada.
   Cancelado o pospuesto tampoco: ahí no hay nada que predecir y
   `void_cancelled_match` ya anuló lo que hubiera.

   La pantalla NO es la que manda: la política RLS comprueba exactamente lo
   mismo. Esto solo evita que la casilla se vea apagada. */
const CERRADOS = ['finished', 'cancelled', 'canceled', 'postponed']

function reabierto(match, status) {
  return match?.predictions_force_open === true && !CERRADOS.includes(status)
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
  if (minutesUntilKickoff <= 0) return { key: 'started', label: 'En juego', tone: 'live', canPredict: false }
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
