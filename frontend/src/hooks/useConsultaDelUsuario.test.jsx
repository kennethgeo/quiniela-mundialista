import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useConsultaDelUsuario } from './useConsultaDelUsuario'
import RankingGlobal from '../components/hub/RankingGlobal'

const identidad = vi.hoisted(() => ({ id: 'KGC' }))
vi.mock('./useAuth', () => ({ useAuth: () => ({ user: { id: identidad.id } }) }))
vi.mock('../lib/supabase', () => ({ supabase: { rpc: vi.fn() } }))
let client
function render(Component) {
  return renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(Component)))
}
afterEach(() => client?.clear())

describe('identidad de las consultas SIN vaciar la caché entre cuentas', () => {
  it.each(['ranking_global', 'mi_resumen_global', 'my_groups', 'quiniela_por_id', 'powerup_credits', 'league_proposals', 'perfil_en_quiniela'])('%s conserva dos respuestas aisladas y permite invalidar por prefijo', async (nombre) => {
    client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
    const base = [nombre, 'quiniela']
    const consultar = vi.fn(async () => 'no debería consultar')
    client.setQueryData([...base, 'KGC'], 'respuesta de KGC')
    client.setQueryData([...base, 'KGCNA'], 'respuesta de KGCNA')
    function Consulta() {
      const { data } = useConsultaDelUsuario({ queryKey: base, queryFn: consultar })
      return createElement('span', null, data)
    }
    identidad.id = 'KGC'
    expect(render(Consulta)).toBe('<span>respuesta de KGC</span>')
    identidad.id = 'KGCNA'
    expect(render(Consulta)).toBe('<span>respuesta de KGCNA</span>')
    expect(client.getQueryData([...base, 'KGC'])).toBe('respuesta de KGC')
    expect(consultar).not.toHaveBeenCalled()
    await client.invalidateQueries({ queryKey: [nombre], refetchType: 'none' })
    for (const id of ['KGC', 'KGCNA']) expect(client.getQueryState([...base, id]).isInvalidated).toBe(true)
  })

  it('el resumen global renderiza los puntos de la cuenta activa con ambas respuestas aún guardadas', () => {
    client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
    const resumen = { partidos: 10, quinielas: 1, posicion: 1, jugadores: 23, exactos: 1, aciertos: 2, medallas: 0 }
    client.setQueryData(['mi_resumen_global', 'KGC'], { ...resumen, puntos: 140 })
    client.setQueryData(['mi_resumen_global', 'KGCNA'], { ...resumen, puntos: 37 })
    identidad.id = 'KGC'
    expect(render(RankingGlobal)).toContain('>140</div>')
    identidad.id = 'KGCNA'
    const html = render(RankingGlobal)
    expect(html).toContain('>37</div>')
    expect(html).not.toContain('>140</div>')
    expect(client.getQueryData(['mi_resumen_global', 'KGC']).puntos).toBe(140)
  })
})
