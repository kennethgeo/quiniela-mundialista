/* Lo que se cuida: la hora que sale en el chat. Costa Rica es UTC-6 fijo, y si
   se usara la zona del dispositivo, alguien de viaje mandaría horas distintas
   al resto del grupo. */
import { describe, it, expect } from 'vitest'
import { horaCostaRica, partidosDeHoy, textoParaWhatsApp } from './partidosDelDia'

const p = (id, kickoff, extra = {}) => ({
  id, kickoff_at: kickoff, home_team: 'Saprissa', away_team: 'Herediano',
  status: 'pending', ...extra,
})

describe('horaCostaRica', () => {
  it('convierte UTC a hora tica en 12h', () => {
    expect(horaCostaRica('2026-08-26T20:00:00Z')).toBe('2:00 pm')
    expect(horaCostaRica('2026-08-26T18:30:00Z')).toBe('12:30 pm')
    expect(horaCostaRica('2026-08-27T01:00:00Z')).toBe('7:00 pm')
  })

  it('asume UTC si el sync guardó la fecha sin zona', () => {
    expect(horaCostaRica('2026-08-26T20:00:00')).toBe('2:00 pm')
  })

  it('medianoche tica se muestra como 12 am, no 0', () => {
    expect(horaCostaRica('2026-08-26T06:00:00Z')).toBe('12:00 am')
  })
})

describe('partidosDeHoy', () => {
  // 26 ago 12:00Z = 6am en Costa Rica. El día local va de 06:00Z a 06:00Z.
  const ahora = new Date('2026-08-26T12:00:00Z')

  it('toma los de hoy en hora tica', () => {
    const r = partidosDeHoy([p(1, '2026-08-26T20:00:00Z')], ahora)
    expect(r.map((x) => x.id)).toEqual([1])
  })

  it('un partido de las 8pm de anoche NO es de hoy', () => {
    // 8pm del 25 en CR = 02:00Z del 26. Con el día UTC saldría como de hoy.
    expect(partidosDeHoy([p(1, '2026-08-26T02:00:00Z')], ahora)).toHaveLength(0)
  })

  it('un partido de las 9pm de hoy SÍ entra, aunque en UTC ya sea mañana', () => {
    // 9pm del 26 en CR = 03:00Z del 27.
    expect(partidosDeHoy([p(1, '2026-08-27T03:00:00Z')], ahora)).toHaveLength(1)
  })

  it('excluye cancelados y pospuestos', () => {
    const ms = [p(1, '2026-08-26T20:00:00Z', { status: 'cancelled' }),
                p(2, '2026-08-26T21:00:00Z', { status: 'postponed' })]
    expect(partidosDeHoy(ms, ahora)).toHaveLength(0)
  })

  it('ordena por hora', () => {
    const ms = [p(2, '2026-08-26T22:00:00Z'), p(1, '2026-08-26T20:00:00Z')]
    expect(partidosDeHoy(ms, ahora).map((x) => x.id)).toEqual([1, 2])
  })
})

describe('textoParaWhatsApp', () => {
  const ahora = new Date('2026-08-26T12:00:00Z')

  it('arma el mensaje con hora y equipos', () => {
    const t = textoParaWhatsApp({
      matches: [p(1, '2026-08-26T20:00:00Z')],
      nombreQuiniela: 'Bundestica', ahora, url: 'https://ticogames.app',
    })
    expect(t).toContain('⚽ Bundestica · Partidos de hoy')
    expect(t).toContain('2:00 pm  Saprissa vs Herediano')
    expect(t).toContain('https://ticogames.app')
  })

  it('lo dice cuando no se juega nada', () => {
    expect(textoParaWhatsApp({ matches: [], ahora })).toContain('Hoy no se juega nada')
  })

  // No filtrar por WhatsApp lo que la app protege con RLS.
  it('no incluye predicciones ni marcadores', () => {
    const t = textoParaWhatsApp({
      matches: [p(1, '2026-08-26T20:00:00Z', { home_goals_actual: 2, away_goals_actual: 1 })],
      ahora,
    })
    expect(t).not.toContain('2-1')
  })
})
