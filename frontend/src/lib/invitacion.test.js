import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  enlaceDeInvitacion, guardarInvitacion, hayInvitacion, normalizarCodigo, tomarInvitacion,
} from './invitacion'

function almacenFalso({ rompe = false } = {}) {
  const datos = new Map()
  const st = {
    getItem: (k) => { if (rompe) throw new Error('bloqueado'); return datos.has(k) ? datos.get(k) : null },
    setItem: (k, v) => { if (rompe) throw new Error('bloqueado'); datos.set(k, String(v)) },
    removeItem: (k) => { if (rompe) throw new Error('bloqueado'); datos.delete(k) },
  }
  vi.stubGlobal('localStorage', st)
  return datos
}

describe('normalizarCodigo', () => {
  it('sube a mayúsculas y quita lo que no sea alfanumérico', () => {
    expect(normalizarCodigo(' ab-c 123 ')).toBe('ABC123')
  })
  it('aguanta valores vacíos', () => {
    expect(normalizarCodigo(null)).toBe('')
    expect(normalizarCodigo(undefined)).toBe('')
  })
  it('corta un código absurdamente largo', () => {
    expect(normalizarCodigo('A'.repeat(400))).toHaveLength(24)
  })
})

describe('guardar y tomar', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('devuelve lo guardado', () => {
    almacenFalso()
    expect(guardarInvitacion('abc123')).toBe(true)
    expect(hayInvitacion()).toBe(true)
    expect(tomarInvitacion()).toBe('ABC123')
  })

  it('se consume una sola vez', () => {
    almacenFalso()
    guardarInvitacion('ABC123')
    expect(tomarInvitacion()).toBe('ABC123')
    // Si no se borrara, un código que falla se reintentaría en cada arranque.
    expect(tomarInvitacion()).toBeNull()
    expect(hayInvitacion()).toBe(false)
  })

  it('no guarda un código vacío', () => {
    almacenFalso()
    expect(guardarInvitacion('   ')).toBe(false)
    expect(hayInvitacion()).toBe(false)
  })

  it('con el almacenamiento bloqueado no revienta', () => {
    almacenFalso({ rompe: true })
    // Modo privado, o el navegador con las cookies del sitio bloqueadas.
    expect(guardarInvitacion('ABC123')).toBe(false)
    expect(tomarInvitacion()).toBeNull()
    expect(hayInvitacion()).toBe(false)
  })
})

describe('enlaceDeInvitacion', () => {
  it('arma la URL con el origen que se le pase', () => {
    expect(enlaceDeInvitacion('abc123', 'https://tico.app')).toBe('https://tico.app/unirse/ABC123')
  })
})
