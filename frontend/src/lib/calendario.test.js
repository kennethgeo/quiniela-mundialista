import { describe, expect, it } from 'vitest'
import { crearCalendario, partidosParaCalendario } from './calendario'

const ahora = Date.parse('2026-09-06T12:00:00Z')
const group = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Mi quiniela' }
const partido = { id: 1, home_team: 'Local', away_team: 'Visita', status: 'pending',
  kickoff_at: '2026-09-07T20:00:00Z', matchday: 2 }
const exportar = (extra = {}) => crearCalendario({ matches: [partido], group,
  origin: 'https://tico-games.example', ahora, ...extra })
const desplegar = s => s.replace(/\r\n[ \t]/g, '')
const propiedad = (s, nombre) => desplegar(s).split('\r\n').filter(l => l.startsWith(`${nombre}:`)).map(l => l.slice(nombre.length + 1))

describe('calendario de partidos', () => {
  it('convierte la zona del partido a UTC, incluyendo el cambio de día', () => {
    const { contenido } = exportar({ matches: [{ ...partido, kickoff_at: '2026-09-07T21:30:00-06:00' }] })
    expect(propiedad(contenido, 'DTSTART')).toEqual(['20260908T033000Z'])
    expect(propiedad(contenido, 'DTEND')).toEqual(['20260908T053000Z'])
    expect(propiedad(contenido, 'DTSTAMP')).toEqual(['20260906T120000Z'])
  })

  it('omite fechas desconocidas, sin zona, pasadas o partidos que ya no están pendientes', () => {
    const invalidos = [null, '', 'sin fecha', '2026-09-09T20:00:00', '2026-09-06T12:00:00Z', '2026-09-05T20:00:00Z']
      .map((kickoff_at, i) => ({ ...partido, id: i + 2, kickoff_at }))
    const otrosEstados = ['finished', 'live', 'cancelled', 'postponed', 'suspended', null]
      .map((status, i) => ({ ...partido, id: i + 20, status }))
    expect(partidosParaCalendario([...invalidos, ...otrosEstados, partido], ahora)).toEqual([partido])
  })

  it('ordena por inicio, elimina duplicados y conserva intacta la entrada', () => {
    const temprano = { ...partido, id: 2, kickoff_at: '2026-09-07T10:00:00Z' }
    const matches = [partido, temprano, partido]
    expect(partidosParaCalendario(matches, ahora)).toEqual([temprano, partido])
    expect(matches).toEqual([partido, temprano, partido])
    expect(exportar({ matches }).cantidad).toBe(2)
  })

  it('no admite IDs inventados dentro de propiedades del archivo', () => {
    expect(partidosParaCalendario([{ ...partido, id: '1\r\nATTENDEE:otro' }, { ...partido, id: -1 }], ahora)).toEqual([])
    expect(() => exportar({ group: { id: 'otro\r\nBEGIN:VEVENT' } })).toThrow('identificar la quiniela')
  })

  it('mantiene el UID al reexportar y lo separa entre quinielas', () => {
    const uid = propiedad(exportar().contenido, 'UID')
    expect(propiedad(exportar({ ahora: ahora + 60_000 }).contenido, 'UID')).toEqual(uid)
    expect(propiedad(exportar({ group: { ...group, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' } }).contenido, 'UID')).not.toEqual(uid)
  })

  it('escapa texto y saltos para impedir la inyección de propiedades o eventos', () => {
    const { contenido } = exportar({ matches: [{ ...partido,
      home_team: 'Local, A; B\\C\r\nBEGIN:VEVENT', venue: 'Estadio\nATTENDEE:intruso' }] })
    expect(propiedad(contenido, 'BEGIN')).toEqual(['VCALENDAR', 'VEVENT'])
    expect(propiedad(contenido, 'ATTENDEE')).toEqual([])
    expect(propiedad(contenido, 'SUMMARY')).toEqual(['Local\\, A\\; B\\\\C\\nBEGIN:VEVENT vs Visita'])
    expect(propiedad(contenido, 'LOCATION')).toEqual(['Estadio\\nATTENDEE:intruso'])
  })

  it('pliega a 75 octetos UTF-8 sin cortar caracteres ni perder texto', () => {
    const nombre = 'Águilas ⚽ '.repeat(30)
    const { contenido } = exportar({ matches: [{ ...partido, home_team: nombre }] })
    for (const linea of contenido.split('\r\n')) expect(new TextEncoder().encode(linea).length).toBeLessThanOrEqual(75)
    expect(propiedad(contenido, 'SUMMARY')).toEqual([`${nombre} vs Visita`])
    expect(contenido).not.toContain('\uFFFD')
    expect(contenido.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/)
    expect(contenido.endsWith('END:VCALENDAR\r\n')).toBe(true)
  })

  it('enlaza a la quiniela y jornada correctas, sin arrastrar parámetros del navegador', () => {
    const { contenido } = exportar({ origin: 'https://tico-games.example/unirse/SECRETO?token=privado',
      matches: [{ ...partido, stage: 'Octavos · Ida' }] })
    const url = new URL(propiedad(contenido, 'URL')[0])
    expect(url.pathname).toBe(`/q/${group.id}`)
    expect([...url.searchParams]).toEqual([['tab', 'matches'], ['j', 'Octavos · Ida']])
    expect(contenido).not.toContain('SECRETO')
    expect(contenido).not.toContain('privado')
  })

  it('reconoce jornadas por número y fases sin etiqueta', () => {
    expect(new URL(propiedad(exportar().contenido, 'URL')[0]).searchParams.get('j')).toBe('Jornada 2')
    const { contenido } = exportar({ matches: [{ ...partido, matchday: null, phase: 'third_place' }] })
    expect(new URL(propiedad(contenido, 'URL')[0]).searchParams.get('j')).toBe('third place')
  })

  it('no serializa predicciones, invitaciones, perfiles ni administradores', () => {
    const { contenido } = exportar({ group: { ...group, invitation_code: 'CODIGOSECRETO', admin_id: 'ADMINPRIVADO' },
      matches: [{ ...partido, predictions: [{ user_id: 'USUARIOPRIVADO', email: 'persona@privado.test', home_goals: 4 }] }] })
    expect(contenido).not.toMatch(/CODIGOSECRETO|ADMINPRIVADO|USUARIOPRIVADO|persona@privado/)
    expect(propiedad(contenido, 'BEGIN')).not.toContain('VALARM')
    expect(propiedad(contenido, 'ORGANIZER')).toEqual([])
    expect(propiedad(contenido, 'DESCRIPTION')[0]).toContain('no se actualiza automáticamente')
  })

  it('rechaza exportaciones vacías y orígenes inseguros', () => {
    expect(() => exportar({ matches: [] })).toThrow('No hay partidos próximos')
    expect(() => exportar({ origin: 'javascript:alert(1)' })).toThrow('dirección')
    expect(() => exportar({ origin: 'https://usuario:clave@example.test' })).toThrow('dirección')
  })

  it('revalida el reloj en cada exportación sin exportar un partido recién iniciado', () => {
    expect(exportar().cantidad).toBe(1)
    expect(() => exportar({ ahora: Date.parse(partido.kickoff_at) })).toThrow('No hay partidos próximos')
    expect(() => exportar({ ahora: NaN })).toThrow('fecha')
  })
})
