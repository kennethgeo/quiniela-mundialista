import { expect, it } from 'vitest'
import { ganadorParaCompartir } from './ganadorJornada'

const ganador = { user_id: 'uno', display_name: 'Ana', puntos: 7 }
it('usa la persona ganadora de la RPC aunque la tabla local tenga otro orden', () => {
  expect(ganadorParaCompartir({ cerrada: true, ganador, tabla: [{ user_id: 'otro', puntos: 99 }] })).toBe(ganador)
})
it.each([undefined, { cerrada: false, ganador }, { cerrada: true, ganador: null },
  { cerrada: true, ganador: { ...ganador, puntos: 0 } }, { cerrada: true, ganador: { ...ganador, puntos: 'error' } }])('no anuncia ganadores con cierres inválidos: %j', jornada => {
  expect(ganadorParaCompartir(jornada)).toBeNull()
})
