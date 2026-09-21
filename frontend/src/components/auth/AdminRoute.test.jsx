/* El panel global (/admin) SOLO estaba detrás de ProtectedRoute, que comprueba
   sesión y correo verificado. Cualquiera de los 26 podía escribir /admin en la
   barra y le salía entero: editar resultados, sincronizar torneos, repartir los
   puntos de campeón y goleador.

   No era una escalada de privilegios —la RLS y los endpoints siguen exigiendo
   `is_admin` del lado del servidor— pero sí una pantalla que no le corresponde
   a nadie más, con botones que disparan syncs. */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import AdminRoute from './AdminRoute'

const sesion = vi.hoisted(() => ({ user: null, profile: null, loading: false }))
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => sesion }))

function renderizar (estado) {
  Object.assign(sesion, { user: null, profile: null, loading: false }, estado)
  return renderToStaticMarkup(createElement(MemoryRouter, null,
    createElement(AdminRoute, null, createElement('p', null, 'Panel global'))))
}

const PANEL = 'Panel global'

describe('quién entra al panel global', () => {
  it('un admin global lo ve', () => {
    expect(renderizar({ user: { id: 'A' }, profile: { id: 'A', is_admin: true } })).toContain(PANEL)
  })

  it('EL FALLO: un jugador cualquiera NO lo ve', () => {
    expect(renderizar({ user: { id: 'B' }, profile: { id: 'B', is_admin: false } })).not.toContain(PANEL)
  })

  it('un perfil sin la bandera tampoco', () => {
    // `is_admin` ausente no es `is_admin: true`.
    expect(renderizar({ user: { id: 'C' }, profile: { id: 'C' } })).not.toContain(PANEL)
  })

  it('sin sesión tampoco', () => {
    expect(renderizar({ user: null, profile: null })).not.toContain(PANEL)
  })
})

describe('mientras carga no se decide nada', () => {
  /* Un `Navigate` en este hueco sacaría al ADMIN de su propio panel al recargar
     la página, que es cuando el perfil todavía viene en camino. */
  it('con la sesión cargando no se muestra ni se expulsa', () => {
    const html = renderizar({ loading: true })
    expect(html).not.toContain(PANEL)
    expect(html).toContain('Cargando')
  })

  it('con sesión pero sin perfil todavía, se espera', () => {
    const html = renderizar({ user: { id: 'A' }, profile: null })
    expect(html).not.toContain(PANEL)
    expect(html).toContain('Cargando')
  })
})
