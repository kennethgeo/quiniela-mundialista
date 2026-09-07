// iCalendar (RFC 5545): fechas UTC, texto escapado y líneas de hasta 75 octetos.
// Exportación local: no consulta cuentas de calendario ni escribe en Supabase.
const MINUTO = 60_000
const encoder = new TextEncoder()

function texto(valor) {
  return Array.from(String(valor ?? '')).filter(c => c >= ' ' || c === '\r' || c === '\n')
    .join('').replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n')
    .replace(/;/g, '\\;').replace(/,/g, '\\,')
}

function plegar(linea) {
  const lineas = []
  let actual = '', bytes = 0
  for (const caracter of linea) {
    const ancho = encoder.encode(caracter).length
    if (bytes + ancho > 75) {
      lineas.push(actual)
      actual = ' '
      bytes = 1
    }
    actual += caracter
    bytes += ancho
  }
  return [...lineas, actual].join('\r\n')
}

function fechaUTC(fecha) {
  return new Date(fecha).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

function instanteConZona(valor) {
  // No interpretar una hora sin zona en la zona del teléfono.
  if (typeof valor !== 'string' || !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(valor)) return NaN
  return Date.parse(valor)
}

export function partidosParaCalendario(matches = [], ahora = Date.now()) {
  const vistos = new Set()
  const tiempo = Number(new Date(ahora))
  if (!Number.isFinite(tiempo)) throw new Error('No se pudo determinar la fecha de exportación.')
  return matches.filter(m => {
    const inicio = instanteConZona(m.kickoff_at)
    if (!Number.isSafeInteger(m.id) || m.id < 1 || vistos.has(m.id) || m.status !== 'pending'
        || !Number.isFinite(inicio) || inicio <= tiempo) return false
    vistos.add(m.id)
    return true
  }).sort((a, b) => Date.parse(a.kickoff_at) - Date.parse(b.kickoff_at) || a.id - b.id)
}

export function crearCalendario({ matches, group, origin, ahora = Date.now() }) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(group?.id ?? '')) {
    throw new Error('No se pudo identificar la quiniela.')
  }
  const sitio = new URL(origin)
  if (!['https:', 'http:'].includes(sitio.protocol) || sitio.username || sitio.password) {
    throw new Error('La dirección de la aplicación no es válida.')
  }
  const partidos = partidosParaCalendario(matches, ahora)
  if (!partidos.length) throw new Error('No hay partidos próximos con horario confirmado en esta selección.')
  const lineas = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Tico Games//Calendario de partidos//ES',
    'CALSCALE:GREGORIAN', `X-WR-CALNAME:${texto(group.name || 'Mi quiniela')}`]
  for (const m of partidos) {
    const inicio = Date.parse(m.kickoff_at)
    const enlace = new URL(`/q/${group.id}`, sitio.origin)
    enlace.searchParams.set('tab', 'matches')
    // MatchList y GroupPage usan esta etiqueta para seleccionar la jornada.
    const jornada = m.stage || (m.matchday ? `Jornada ${m.matchday}` : (m.phase ? m.phase.replace(/_/g, ' ') : 'Partidos'))
    enlace.searchParams.set('j', jornada)
    lineas.push('BEGIN:VEVENT', `UID:${group.id}-${m.id}@tico-games`, `DTSTAMP:${fechaUTC(ahora)}`,
      `DTSTART:${fechaUTC(inicio)}`, `DTEND:${fechaUTC(inicio + 120 * MINUTO)}`,
      `SUMMARY:${texto(m.home_team || 'Por definir')} vs ${texto(m.away_team || 'Por definir')}`,
      `DESCRIPTION:${texto(`${group.name || 'Mi quiniela'} · ${jornada}\nLas predicciones cierran 15 minutos antes del saque.\nDuración estimada: 2 horas. Los horarios pueden cambiar; revisá la app antes del partido.\nEsta importación no se actualiza automáticamente.`)}`,
      `URL:${enlace.href}`, 'TRANSP:TRANSPARENT')
    if (m.venue) lineas.push(`LOCATION:${texto(m.venue)}`)
    lineas.push('END:VEVENT')
  }
  lineas.push('END:VCALENDAR')
  return { contenido: lineas.map(plegar).join('\r\n') + '\r\n', cantidad: partidos.length }
}
