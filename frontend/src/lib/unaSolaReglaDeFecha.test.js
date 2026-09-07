/* Que no vuelva a haber una segunda forma de parsear kickoff_at.

   Esta prueba no mira comportamiento: mira el CÓDIGO. Es a propósito. El
   repo ya vivió el mismo error tres veces —la fórmula del total global
   escrita dos veces, y diez copias de este parseo— y el síntoma nunca es un
   fallo ruidoso: es una pantalla que muestra la hora corrida seis horas, o
   que se cae entera. Un comportamiento así no se cubre solo con pruebas de
   comportamiento, porque nadie escribe la prueba de la copia que no sabe que
   existe.

   Las dos trampas concretas que tenían todas las copias:
     · sin guarda de null -> `.endsWith` de null tira TypeError y el
       ErrorBoundary se lleva la pantalla completa;
     · `.includes('+')` NO reconoce un offset NEGATIVO, así que a un
       "-06:00" —el de Costa Rica— le pegaba una "Z" y corría el partido
       seis horas.

   La regla vive en lib/matchStatus.js (kickoffDate) y no se copia. */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { kickoffDate } from './matchStatus'

const RAIZ = new URL('..', import.meta.url).pathname  // frontend/src
const EXCEPCION = join(RAIZ, 'lib', 'matchStatus.js') // la única fuente de verdad

function archivosFuente(dir) {
  return readdirSync(dir).flatMap((n) => {
    const ruta = join(dir, n)
    if (statSync(ruta).isDirectory()) return archivosFuente(ruta)
    return /\.(js|jsx)$/.test(n) && !/\.test\.jsx?$/.test(n) ? [ruta] : []
  })
}

describe('una sola regla para interpretar kickoff_at', () => {
  it('ningún archivo se arma su propio parseo', () => {
    const culpables = archivosFuente(RAIZ)
      .filter((f) => f !== EXCEPCION)
      .filter((f) => /endsWith\(['"]Z['"]\)/.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(RAIZ.length))
    expect(culpables, `usá kickoffDate de lib/matchStatus en vez de copiar el parseo:\n  ${culpables.join('\n  ')}`).toEqual([])
  })

  it('la regla compartida cubre las dos trampas de las copias', () => {
    // Offset negativo: el de Costa Rica. Las copias lo corrían seis horas.
    expect(kickoffDate('2026-12-09T14:00:00-06:00').toISOString()).toBe('2026-12-09T20:00:00.000Z')
    expect(kickoffDate('2026-12-09T20:00:00+00:00').toISOString()).toBe('2026-12-09T20:00:00.000Z')
    // Sin zona se asume UTC, que es lo que guarda el sync.
    expect(kickoffDate('2026-12-09T20:00:00').toISOString()).toBe('2026-12-09T20:00:00.000Z')
    // Y nada de esto revienta.
    for (const malo of [null, undefined, '', 'sin fecha', 123, {}]) {
      expect(kickoffDate(malo)).toBeNull()
    }
  })
})
