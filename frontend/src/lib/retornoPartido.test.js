import { expect, it } from 'vitest'
import { enlacePartido, retornoPartido } from './retornoPartido'

it('preserva grupo, pestaña y jornada al volver', () => {
  expect(retornoPartido('/q/abc-123?tab=matches&jornada=18', 'otro')).toBe('/q/abc-123?tab=matches&jornada=18')
  expect(enlacePartido('partido', '/q/abc-123')).toBe('/match/partido?group=abc-123')
})
it('un enlace directo vuelve al grupo o al Hub', () => {
  expect(retornoPartido(null, 'abc-123')).toBe('/q/abc-123')
  expect(retornoPartido(null, null)).toBe('/')
})
it.each(['https://otro.test', '//otro.test', '/q/../admin', '/auth', '/q/a#otra'])('descarta destinos ajenos o malformados: %s', path => {
  expect(retornoPartido(path, '//otro.test')).toBe('/')
})
