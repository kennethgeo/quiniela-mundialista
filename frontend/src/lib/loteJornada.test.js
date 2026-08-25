/* Test del orden del lote al guardar una jornada completa.
   El porqué está en lib/loteJornada.js: sin este orden, reacomodar los
   comodines dentro de la jornada hace fallar el lote entero. */
import { describe, it, expect } from 'vitest'
import { ordenarLote } from './loteJornada'

const fila = (match_id, use_powerup_x2) => ({ match_id, use_powerup_x2 })

describe('ordenarLote', () => {
  it('manda las activaciones del ×2 al final', () => {
    const r = ordenarLote([fila(1, true), fila(2, false), fila(3, true), fila(4, false)])
    expect(r.map((f) => f.match_id)).toEqual([2, 4, 1, 3])
  })

  it('el caso que revienta en Postgres: prender B y apagar A queda en orden seguro', () => {
    const r = ordenarLote([fila('B', true), fila('A', false)])
    expect(r.map((f) => f.match_id)).toEqual(['A', 'B'])
  })

  it('no pierde ni duplica filas', () => {
    const entrada = [fila(1, true), fila(2, false), fila(3, true)]
    const r = ordenarLote(entrada)
    expect(r).toHaveLength(3)
    expect(new Set(r.map((f) => f.match_id))).toEqual(new Set([1, 2, 3]))
  })

  it('no muta el arreglo original', () => {
    const entrada = [fila(1, true), fila(2, false)]
    ordenarLote(entrada)
    expect(entrada.map((f) => f.match_id)).toEqual([1, 2])
  })

  it('sin comodines deja todo como estaba', () => {
    const r = ordenarLote([fila(1, false), fila(2, false), fila(3, false)])
    expect(r.map((f) => f.match_id)).toEqual([1, 2, 3])
  })

  it('todo con comodín tampoco se desordena', () => {
    const r = ordenarLote([fila(1, true), fila(2, true)])
    expect(r.map((f) => f.match_id)).toEqual([1, 2])
  })
})
