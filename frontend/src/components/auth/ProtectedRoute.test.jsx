import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import ProtectedRoute from './ProtectedRoute'

const sesion = vi.hoisted(() => ({ user: null, loading: false }))
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => sesion }))
vi.mock('../../lib/supabase', () => ({ supabase: { auth: { getUser: vi.fn() } } }))

function renderizar(user, estadoConsulta) {
  sesion.user = user
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } })
  try {
    if (estadoConsulta) client.getQueryCache().build(client, { queryKey: ['verificacion-correo', user.id] }).setState(estadoConsulta)
    return renderToStaticMarkup(createElement(QueryClientProvider, { client },
      createElement(MemoryRouter, null, createElement(ProtectedRoute, null,
        createElement('p', null, 'Contenido protegido')))))
  } finally { client.clear() }
}

describe('puerta de acceso renderizada', () => {
  it('muestra la ruta para una sesión verificada', () => {
    expect(renderizar({ id: 'A', email_confirmed_at: '2026-01-01' })).toContain('Contenido protegido')
  })
  it('no muestra la ruta si falta comprobar la sesión', () => {
    const html = renderizar({ id: 'A' })
    expect(html).toContain('Comprobando tu sesión')
    expect(html).not.toContain('Contenido protegido')
  })
  it('un null explícito no se convierte en verificado por una respuesta cacheada', () => {
    const html = renderizar({ id: 'A', email_confirmed_at: null }, { status: 'success', data: 'verificado' })
    expect(html).toContain('Email no verificado')
    expect(html).not.toContain('Contenido protegido')
  })
  it('abre la ruta si Auth completa la información ausente', () => {
    expect(renderizar({ id: 'A' }, { status: 'success', data: 'verificado' })).toContain('Contenido protegido')
  })
  it('muestra la verificación pendiente si Auth confirma que falta el correo', () => {
    const html = renderizar({ id: 'A' }, { status: 'success', data: 'sin-verificar' })
    expect(html).toContain('Email no verificado')
    expect(html).not.toContain('Contenido protegido')
  })
  it('muestra error recuperable ante una comprobación fallida', () => {
    const html = renderizar({ id: 'A' }, { status: 'error', error: new Error('error sintético') })
    expect(html).toContain('role="alert"')
    expect(html).toContain('Reintentar')
    expect(html).not.toContain('Contenido protegido')
  })
})
