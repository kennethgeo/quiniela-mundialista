/* El texto de "los partidos de hoy" para mandar al grupo de WhatsApp.

   Se arma acá, puro y probado, en vez de dentro del componente: el formato es
   lo que la gente lee en el chat y una hora mal convertida se nota enseguida.

   Costa Rica es UTC-6 todo el año (no hay horario de verano), así que la
   conversión es fija y no depende del reloj de quien comparte — alguien de
   viaje mandaría horas distintas si se usara la zona del dispositivo. */

const UTC_CR_MS = -6 * 60 * 60 * 1000

/* El sync a veces guarda kickoff_at sin sufijo de zona; se asume UTC, igual que
   hace MatchCard. */
function aFecha(kickoff) {
  if (!kickoff) return null
  const iso = kickoff.endsWith('Z') || kickoff.slice(10).includes('+') ? kickoff : `${kickoff}Z`
  const d = new Date(iso)
  return isNaN(d) ? null : d
}

export function horaCostaRica(kickoff) {
  const d = aFecha(kickoff)
  if (!d) return '--:--'
  const cr = new Date(d.getTime() + UTC_CR_MS)
  const h = cr.getUTCHours()
  const m = String(cr.getUTCMinutes()).padStart(2, '0')
  const ampm = h >= 12 ? 'pm' : 'am'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${m} ${ampm}`
}

/* Los partidos del día natural de Costa Rica que contiene a `ahora`. */
export function partidosDeHoy(matches = [], ahora = new Date()) {
  const cr = new Date(ahora.getTime() + UTC_CR_MS)
  const inicioCr = Date.UTC(cr.getUTCFullYear(), cr.getUTCMonth(), cr.getUTCDate())
  const desde = inicioCr - UTC_CR_MS
  const hasta = desde + 24 * 60 * 60 * 1000

  return matches
    .filter((m) => m.status !== 'cancelled' && m.status !== 'postponed')
    .filter((m) => {
      const d = aFecha(m.kickoff_at)
      return d && d.getTime() >= desde && d.getTime() < hasta
    })
    .sort((a, b) => aFecha(a.kickoff_at) - aFecha(b.kickoff_at))
}

/* El mensaje listo para pegar en el chat.

   Sin marcadores ni predicciones a propósito: se manda por la mañana, cuando
   todavía no hay nada que destapar, y meter predicciones ajenas en un texto
   que circula por WhatsApp sería filtrar justo lo que la app protege. */
export function textoParaWhatsApp({ matches = [], nombreQuiniela = '', ahora = new Date(), url = '' } = {}) {
  const hoy = partidosDeHoy(matches, ahora)
  const titulo = nombreQuiniela ? `⚽ ${nombreQuiniela} · Partidos de hoy` : '⚽ Partidos de hoy'

  if (hoy.length === 0) {
    return `${titulo}\n\nHoy no se juega nada. 😴`
  }

  const lineas = hoy.map((m) => {
    const local = m.home_team || '?'
    const visita = m.away_team || '?'
    return `🕐 ${horaCostaRica(m.kickoff_at)}  ${local} vs ${visita}`
  })

  const partes = [titulo, '', ...lineas, '', '⏰ Cada partido cierra 15 min antes del saque.']
  if (url) partes.push(`👉 ${url}`)
  return partes.join('\n')
}
