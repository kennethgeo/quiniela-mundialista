import { describe, it, expect } from 'vitest'
import { proveedoresHabilitados, traerProveedores } from './proveedoresAuth'

// Recorte de la respuesta REAL de /auth/v1/settings del proyecto (9 sep 2026).
const AJUSTES = {
  external: {
    apple: false, azure: false, discord: false, facebook: false, github: false,
    google: false, email: true, phone: false, anonymous_users: false,
  },
  disable_signup: false,
  mailer_autoconfirm: true,
}

const conGoogle = () => ({ ...AJUSTES, external: { ...AJUSTES.external, google: true } })
const respuesta = (cuerpo, ok = true) => Promise.resolve({ ok, json: async () => cuerpo })

describe('proveedoresHabilitados', () => {
  it('con Google apagado no devuelve nada', () => {
    expect(proveedoresHabilitados(AJUSTES)).toEqual([])
  })

  it('con Google encendido lo devuelve', () => {
    expect(proveedoresHabilitados(conGoogle())).toEqual(['google'])
  })

  /* `email: true` está SIEMPRE. Si contara como proveedor social, el botón
     «Entrar con...» aparecería desde el primer día sin nada detrás. */
  it('el correo no cuenta como proveedor social', () => {
    expect(proveedoresHabilitados(AJUSTES)).not.toContain('email')
    expect(proveedoresHabilitados(conGoogle())).not.toContain('email')
  })

  it('una respuesta rara no revienta ni inventa proveedores', () => {
    for (const raro of [null, undefined, {}, { external: null }, { external: 'si' }]) {
      expect(proveedoresHabilitados(raro)).toEqual([])
    }
  })
})

describe('traerProveedores', () => {
  it('lee la lista del endpoint', async () => {
    const visitadas = []
    const lista = await traerProveedores('https://x.supabase.co', {
      hacerPeticion: (u) => { visitadas.push(u); return respuesta(conGoogle()) },
    })
    expect(lista).toEqual(['google'])
    expect(visitadas).toEqual(['https://x.supabase.co/auth/v1/settings'])
  })

  it('no duplica la barra si la URL trae una al final', async () => {
    const visitadas = []
    await traerProveedores('https://x.supabase.co/', {
      hacerPeticion: (u) => { visitadas.push(u); return respuesta(AJUSTES) },
    })
    expect(visitadas[0]).toBe('https://x.supabase.co/auth/v1/settings')
  })

  /* Lo importante: esto es un EXTRA. Si falla, la pantalla de entrada tiene
     que seguir funcionando; solo se queda sin el botón. */
  it('si la petición falla no lanza: devuelve una lista vacía', async () => {
    const lista = await traerProveedores('https://x.supabase.co', {
      hacerPeticion: () => Promise.reject(new TypeError('Network request failed')),
    })
    expect(lista).toEqual([])
  })

  /* El cuerpo dice que Google está encendido A PROPÓSITO: si el código no
     mirara `ok`, se creería una respuesta de error y pintaría el botón. Con un
     cuerpo vacío esta prueba pasaba con y sin la comprobación — comprobado. */
  it('un error HTTP no se toma por respuesta válida', async () => {
    const lista = await traerProveedores('https://x.supabase.co', {
      hacerPeticion: () => respuesta(conGoogle(), false),
    })
    expect(lista).toEqual([])
  })

  it('si tarda demasiado se rinde en vez de dejar la pantalla esperando', async () => {
    const lista = await traerProveedores('https://x.supabase.co', {
      hacerPeticion: () => new Promise(() => {}),
      limiteMs: 20,
    })
    expect(lista).toEqual([])
  })

  it('sin URL de Supabase no intenta nada', async () => {
    let llamo = false
    const lista = await traerProveedores('', { hacerPeticion: () => { llamo = true; return respuesta({}) } })
    expect(lista).toEqual([])
    expect(llamo).toBe(false)
  })
})
