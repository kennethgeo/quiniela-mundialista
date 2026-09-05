import { describe, expect, it } from 'vitest'
import { CLAVES_DEL_DISPOSITIVO, limpiarDatosDeSesion } from './sesionLocal'

function almacenFalso(inicial = {}) {
  const datos = { ...inicial }
  return {
    datos,
    getItem: (k) => (k in datos ? datos[k] : null),
    removeItem: (k) => { delete datos[k] },
    setItem: (k, v) => { datos[k] = v },
  }
}

describe('limpiar los datos de sesión', () => {
  it('borra lo de la persona y respeta lo del aparato', () => {
    const a = almacenFalso({
      tutorial_seen: 'true', 'tico:invitacion': 'ABC123',
      qm_theme: 'dark', pwaPromptDismissed: 'true', 'tico:anuncio:xyz': '1',
    })
    const borradas = limpiarDatosDeSesion(a)
    expect(borradas.sort()).toEqual(['tico:invitacion', 'tutorial_seen'])
    expect(a.datos.tutorial_seen).toBeUndefined()
    expect(a.datos['tico:invitacion']).toBeUndefined()
    // El tema y el "no me ofrezcas instalar" son del aparato: se quedan.
    for (const clave of CLAVES_DEL_DISPOSITIVO) expect(a.datos[clave]).toBeDefined()
    // Y lo que no está en ninguna lista no se toca por las dudas.
    expect(a.datos['tico:anuncio:xyz']).toBe('1')
  })

  it('no informa como borrado lo que no estaba', () => {
    expect(limpiarDatosDeSesion(almacenFalso({ qm_theme: 'dark' }))).toEqual([])
  })

  it('no revienta si el almacenamiento está bloqueado (modo privado)', () => {
    const bloqueado = {
      getItem: () => { throw new Error('acceso denegado') },
      removeItem: () => { throw new Error('acceso denegado') },
    }
    expect(() => limpiarDatosDeSesion(bloqueado)).not.toThrow()
    expect(limpiarDatosDeSesion(bloqueado)).toEqual([])
  })

  it('sigue con las demás claves aunque una falle', () => {
    const a = almacenFalso({ tutorial_seen: 'true', 'tico:invitacion': 'ABC' })
    const parcial = {
      getItem: (k) => a.getItem(k),
      removeItem: (k) => { if (k === 'tutorial_seen') throw new Error('bloqueada'); a.removeItem(k) },
    }
    expect(limpiarDatosDeSesion(parcial)).toEqual(['tico:invitacion'])
    expect(a.datos['tico:invitacion']).toBeUndefined()
  })
})
