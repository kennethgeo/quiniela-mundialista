import { describe, expect, it } from 'vitest'
import { describirMovimiento, plata } from './historialPagos'

const ANA = '00000000-0000-4000-8000-0000000000a1'
const BETO = '00000000-0000-4000-8000-0000000000b1'
const nombres = { [ANA]: 'Ana', [BETO]: 'Beto' }

/* Las filas tienen la forma que escribe el trigger de la 109: numeric llega
   como número, `por` puede ser NULL y `created_at` es un timestamptz en UTC. */
const fila = (extra) => ({
  id: 1, league_id: 'l', user_id: BETO, accion: 'confirmado', monto: 10000, moneda: 'CRC',
  por: ANA, created_at: '2026-09-21T18:10:00+00:00', sembrada: false, ...extra,
})

describe('historial de pagos', () => {
  it('conserva los centavos en dólares y colones, también en la bitácora', () => {
    expect(plata(12.75, 'USD')).toBe('$12,75')
    expect(plata(12, 'USD')).toBe('$12,00')
    expect(plata(10000.25, 'CRC')).toMatch(/^₡10\D000,25$/)
    expect(describirMovimiento(fila({ monto: 12.75, moneda: 'USD' }), nombres).monto).toBe('$12,75')
  })
  it('dice quién confirmó, a quién y cuánto', () => {
    const m = describirMovimiento(fila(), nombres)
    expect(m.texto).toBe('Ana confirmó el pago de Beto')
    expect(m.monto).toBe(plata(10000, 'CRC'))
    expect(m.monto).toMatch(/^₡10/)
  })

  it('«quitar» y expulsar con pago se dicen como lo que son', () => {
    expect(describirMovimiento(fila({ accion: 'quitado' }), nombres).texto)
      .toBe('Ana quitó el pago confirmado de Beto')
    expect(describirMovimiento(fila({ accion: 'borrado' }), nombres).texto)
      .toMatch(/sacó de la quiniela a Beto, que tenía el pago confirmado/)
  })

  it('a quien ya no está no se lo muestra como un id', () => {
    const m = describirMovimiento(fila({ accion: 'borrado' }), { [ANA]: 'Ana' })
    expect(m.texto).toContain('alguien que ya no está en la quiniela')
    expect(m.texto).not.toContain(BETO)
  })

  it('sin autor lo hizo el sistema, no «nadie»', () => {
    expect(describirMovimiento(fila({ por: null }), nombres).texto).toBe('el sistema confirmó el pago de Beto')
  })

  it('la hora es la de Costa Rica (UTC-6), no la del teléfono', () => {
    // 18:10 UTC = 12:10 en Costa Rica.
    expect(describirMovimiento(fila(), nombres).cuando).toMatch(/12:10/)
  })

  it('un abono (110) dice lo que se sumó y el total que quedó', () => {
    const m = describirMovimiento(fila({ accion: 'abono', monto: 5000, monto_total: 10000 }), nombres)
    expect(m.texto).toBe('Ana confirmó un abono de Beto')
    expect(m.monto).toMatch(/^₡5.?000$/)
    expect(m.nota).toMatch(/^total ₡10.?000$/)
  })

  it('los pagos copiados al crear el historial se marcan', () => {
    expect(describirMovimiento(fila({ sembrada: true }), nombres).nota).toMatch(/antes de que existiera/)
    expect(describirMovimiento(fila(), nombres).nota).toBeNull()
  })
})
