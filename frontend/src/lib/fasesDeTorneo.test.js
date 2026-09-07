/* Que las sugerencias de fase COINCIDAN con lo que el sync escribe de verdad.

   En la liga tica y en la Champions la clave del cupo de ×2 es la ETIQUETA
   que el sync deja en `matches.stage`. Un nombre que no coincida exacto
   guarda un cupo que NUNCA se aplica: la pantalla dice «listo» y el trigger
   sigue usando el número fijo. Ya pasó — se sugerían «Semis» y «Play-offs»,
   y el sync escribe «Semifinal» y «Repechaje».

   La lista de verdad vive en Python, así que esta prueba LEE ESE ARCHIVO en
   vez de copiar los valores: copiarlos sería reproducir el problema que
   quiere evitar (este repo ya perdió los puntos de asistidor durante meses
   por tener la misma fórmula escrita dos veces). */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { SUGERENCIAS, FASES_REGULARES, nombreDeFase } from './fasesDeTorneo'

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const SYNC = resolve(raiz, 'backend/app/services/espn_tournament_sync.py')

/** Etiquetas de `_STAGE_KEYS`, tal cual las escribe el sync en matches.stage. */
function etiquetasDelSync() {
  const py = readFileSync(SYNC, 'utf8')
  const bloque = py.match(/_STAGE_KEYS\s*=\s*\[([\s\S]*?)\n\]/)
  if (!bloque) throw new Error('no se encontró _STAGE_KEYS en ' + SYNC)
  // ("round-of-16", "Octavos") -> "Octavos"
  return [...bloque[1].matchAll(/\(\s*"[^"]+"\s*,\s*"([^"]+)"\s*\)/g)].map((m) => m[1])
}

describe('sugerencias de fase para el cupo de ×2', () => {
  it('el archivo del sync se puede leer y trae etiquetas', () => {
    const etiquetas = etiquetasDelSync()
    // Sin este ancla, si el regex dejara de casar la prueba de abajo pasaría
    // en vacío y no nos enteraríamos de nada.
    expect(etiquetas.length).toBeGreaterThan(5)
    expect(etiquetas).toContain('Semifinal')
    expect(etiquetas).toContain('Final')
    expect(etiquetas).toContain('Liguilla')
  })

  it('cada sugerencia es una etiqueta REAL del sync, no un sinónimo', () => {
    const etiquetas = etiquetasDelSync()
    expect(SUGERENCIAS.filter((s) => !etiquetas.includes(s))).toEqual([])
  })

  it('no se sugiere una fase regular: su clave es "groups", no la etiqueta', () => {
    expect(SUGERENCIAS.filter((s) => FASES_REGULARES.includes(s))).toEqual([])
  })

  it('se ofrecen TODAS las rondas de eliminatoria que el sync sabe escribir', () => {
    // Si el sync aprende una ronda nueva y no se ofrece, el admin la escribe a
    // mano y con un carácter distinto el cupo deja de aplicarse en silencio.
    const esperadas = [...new Set(etiquetasDelSync())].filter((e) => !FASES_REGULARES.includes(e))
    expect([...SUGERENCIAS].sort()).toEqual(esperadas.sort())
  })

  it('no hay sugerencias repetidas', () => {
    expect(new Set(SUGERENCIAS).size).toBe(SUGERENCIAS.length)
  })
})

describe('nombreDeFase', () => {
  it('traduce las claves del Mundial, que son `phase` y no etiquetas', () => {
    expect(nombreDeFase('round_of_16')).toBe('Octavos')
    expect(nombreDeFase('final')).toBe('Final')
    expect(nombreDeFase('groups')).toBe('Jornadas regulares')
  })

  it('deja intacta una clave desconocida', () => {
    // Es lo que el admin escribió y lo que la base va a comparar: mostrar otra
    // cosa escondería justamente el error que hay que ver.
    expect(nombreDeFase('Liguilla')).toBe('Liguilla')
    expect(nombreDeFase('Repesca Sub-20')).toBe('Repesca Sub-20')
  })
})
