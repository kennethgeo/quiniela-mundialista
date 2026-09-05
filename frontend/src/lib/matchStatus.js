export const PREDICTION_CLOSE_MINUTES = 15

export function kickoffDate(value) {
  if (!value) return null
  if (typeof value !== 'string') return null
  const iso = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? null : date
}

export function matchStatus(match, now = new Date()) {
  const status = String(match?.status || '').toLowerCase()

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
