import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import PozoYPagos from './PozoYPagos'
import JornadasYRachas from './JornadasYRachas'
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'prueba' } }) }))
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: vi.fn() } }))

describe('un error de lectura no desaparece como si no hubiera datos', () => {
  it.each([
    [PozoYPagos, 'league_pozo', 'No pudimos cargar el pozo'],
    [JornadasYRachas, 'league_jornadas', 'No pudimos cargar las jornadas'],
  ])('%s muestra error y reintento', (Component, rpc, texto) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } })
    try {
      client.getQueryCache().build(client, { queryKey: [rpc, 'liga', 'prueba'] }).setState({ status: 'error', error: new Error('respuesta fallida') })
      const html = renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(Component, { leagueId: 'liga' })))
      expect(html).toContain('role="alert"')
      expect(html).toContain(texto)
      expect(html).toContain('Reintentar')
    } finally { client.clear() }
  })
})
