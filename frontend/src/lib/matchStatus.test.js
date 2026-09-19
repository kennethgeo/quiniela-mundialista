import { describe, expect, it } from 'vitest'
import { kickoffDate, matchStatus, predictionDeadline, timeUntilDeadline } from './matchStatus'

const now = new Date('2026-09-03T12:00:00Z')
const game = (kickoff_at, status = 'pending') => ({ kickoff_at, status })

describe('kickoffDate', () => {
  it.each([
    '2026-09-03T14:00:00Z', '2026-09-03T14:00:00+00:00',
    '2026-09-03T08:00:00-06:00', '2026-09-03T08:00:00-0600',
    '2026-09-03T16:00:00+02:00', '2026-09-03T14:00:00',
  ])('normaliza el mismo instante desde %s', value => {
    expect(kickoffDate(value)?.toISOString()).toBe('2026-09-03T14:00:00.000Z')
  })

  it.each([null, undefined, '', 'sin fecha', 42, {}])('rechaza %s sin convertirlo a 1970', value => {
    expect(kickoffDate(value)).toBeNull()
    expect(predictionDeadline(value)).toBeNull()
    expect(matchStatus(game(value), now).canPredict).toBe(false)
  })
})

describe('matchStatus', () => {
  it('distingue abierto, por cerrar y cerrado con el corte real de 15 minutos', () => {
    expect(matchStatus(game('2026-09-03T14:00:00Z'), now).key).toBe('open')
    expect(matchStatus(game('2026-09-03T12:45:00Z'), now).key).toBe('closing')
    expect(matchStatus(game('2026-09-03T12:15:00Z'), now).key).toBe('locked')
  })

  it('el estado de la base domina al reloj', () => {
    expect(matchStatus(game('2026-09-03T14:00:00Z', 'in_progress'), now).key).toBe('live')
    expect(matchStatus(game('2026-09-03T14:00:00Z', 'finished'), now).key).toBe('finished')
    expect(matchStatus(game('2026-09-03T14:00:00Z', 'postponed'), now).key).toBe('postponed')
  })

  it('calcula el plazo visible desde los mismos 15 minutos', () => {
    expect(predictionDeadline('2026-09-03T14:00:00Z').toISOString()).toBe('2026-09-03T13:45:00.000Z')
    expect(timeUntilDeadline('2026-09-03T14:00:00Z', now)).toBe('1 h 45 min')
  })

  it('respeta zonas negativas y no cierra antes de los 15 minutos exactos', () => {
    expect(predictionDeadline('2026-09-03T08:00:00-06:00').toISOString()).toBe('2026-09-03T13:45:00.000Z')
    expect(matchStatus(game('2026-09-03T12:15:00.001Z'), now).canPredict).toBe(true)
    expect(matchStatus(game('2026-09-03T12:15:00.000Z'), now).canPredict).toBe(false)
  })
})

/* Reapertura por partido (migración 77).

   Lo que se fija acá es EXACTAMENTE lo que comprueba la política RLS: la
   pantalla y la base tienen que decidir igual, o alguien ve la casilla abierta
   y la base le rechaza el guardado (o al revés, que es peor). */
describe('predictions_force_open', () => {
  const enCurso = (extra = {}) => ({
    status: 'in_progress',
    kickoff_at: new Date(Date.now() - 30 * 60000).toISOString(),
    ...extra,
  })

  it('un partido en curso NO acepta predicciones sin la reapertura', () => {
    expect(matchStatus(enCurso()).canPredict).toBe(false)
  })

  it('con la reapertura, un partido en curso SÍ acepta', () => {
    const r = matchStatus(enCurso({ predictions_force_open: true }))
    expect(r.canPredict).toBe(true)
    expect(r.key).toBe('reopened')
  })

  it('también sirve si el saque ya pasó pero el estado sigue pendiente', () => {
    // Es el caso real: ESPN trae mal la hora y el partido queda "cerrado" sin
    // haber empezado de verdad.
    const r = matchStatus({
      status: 'pending',
      kickoff_at: new Date(Date.now() - 10 * 60000).toISOString(),
      predictions_force_open: true,
    })
    expect(r.canPredict).toBe(true)
  })

  it('EN UN PARTIDO FINALIZADO NO HACE NADA', () => {
    // Con el marcador puesto no es reabrir, es copiar. La reapertura se apaga
    // sola al terminar el partido: nadie tiene que acordarse de apagarla.
    const r = matchStatus(enCurso({ status: 'finished', predictions_force_open: true }))
    expect(r.canPredict).toBe(false)
    expect(r.key).toBe('finished')
  })

  it('tampoco en cancelado ni pospuesto', () => {
    for (const status of ['cancelled', 'canceled', 'postponed']) {
      const r = matchStatus(enCurso({ status, predictions_force_open: true }))
      expect(r.canPredict, status).toBe(false)
    }
  })

  it('un partido sin la columna se comporta como siempre', () => {
    // La columna nace en false y las consultas viejas puede que ni la pidan:
    // ausente tiene que significar "cerrado", nunca "abierto".
    expect(matchStatus(enCurso({ predictions_force_open: undefined })).canPredict).toBe(false)
    expect(matchStatus(enCurso({ predictions_force_open: null })).canPredict).toBe(false)
    expect(matchStatus(enCurso({ predictions_force_open: 'true' })).canPredict).toBe(false)
  })

  it('no altera un partido que todavía no empezó', () => {
    const futuro = { status: 'pending', kickoff_at: new Date(Date.now() + 3 * 3600000).toISOString() }
    expect(matchStatus(futuro).key).toBe('open')
    expect(matchStatus({ ...futuro, predictions_force_open: true }).key).toBe('open')
  })
})

/* EL CASO QUE LLEGÓ DE PRODUCCIÓN (19 sep 2026): Pérez Zeledón–Sporting
   terminó a las 02:00Z del viernes y la app lo seguía mostrando «EN JUEGO» a
   la mañana siguiente. La base decía `pending` —el sync no lo había tocado en
   doce horas, porque le pedía a ESPN por rangos de fecha y ESPN devuelve cero
   eventos a cualquier rango— y la pantalla deducía «en juego» solo de que la
   hora del saque ya había pasado, sin ningún tope. */
describe('un partido que el sync nunca actualizó', () => {
  const saque = '2026-09-19T02:00:00Z'

  it('se ve EN JUEGO mientras podría estar jugándose', () => {
    expect(matchStatus(game(saque), new Date('2026-09-19T02:30:00Z')).key).toBe('started')
    expect(matchStatus(game(saque), new Date('2026-09-19T05:00:00Z')).key).toBe('started')
  })

  it('pero NO doce horas después: ahí se dice que no hay dato', () => {
    const tarde = matchStatus(game(saque), new Date('2026-09-19T14:00:00Z'))
    expect(tarde.key).toBe('stale')
    expect(tarde.label).toBe('Sin datos')
    expect(tarde.canPredict).toBe(false)
  })

  it('el corte está donde deja de ser creíble, no antes', () => {
    // 240 minutos: 90 + descanso + añadido + prórroga y penales, con margen.
    expect(matchStatus(game(saque), new Date('2026-09-19T05:59:00Z')).key).toBe('started')
    expect(matchStatus(game(saque), new Date('2026-09-19T06:01:00Z')).key).toBe('stale')
  })

  it('un partido que la base SÍ da por terminado no se toca', () => {
    const fin = matchStatus(game(saque, 'finished'), new Date('2026-09-19T14:00:00Z'))
    expect(fin.key).toBe('finished')
  })

  it('ni uno que la base da EN CURSO, por largo que se haga', () => {
    /* Acá el «en vivo» es un dato de la fuente, no una deducción del reloj:
       un partido suspendido y reanudado puede durar horas y la base lo sabe. */
    expect(matchStatus(game(saque, 'in_progress'), new Date('2026-09-19T14:00:00Z')).key).toBe('live')
  })

  it('si el admin lo reabrió a propósito, se sigue pudiendo corregir', () => {
    /* La reapertura (migración 77) existe justo para cuando el cierre fue un
       error de los datos, que es exactamente este caso. «Sin datos» no la
       pisa: quien la encendió sabe lo que hace, y la política RLS permite lo
       mismo. */
    const reabierto = { kickoff_at: saque, status: 'pending', predictions_force_open: true }
    const estado = matchStatus(reabierto, new Date('2026-09-19T14:00:00Z'))
    expect(estado.key).toBe('reopened')
    expect(estado.canPredict).toBe(true)
  })
})
