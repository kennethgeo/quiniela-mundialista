import { describe, expect, it, vi } from 'vitest'
import { cambiarNombre } from './cuenta'

function preparar({ sessionId = 'a', result = { data: { id: 'a', display_name: 'Nuevo' } } } = {}) {
  const query = { eq: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue(result) }
  const update = vi.fn(() => query)
  const client = {
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: sessionId } } } }) },
    from: vi.fn(() => ({ update })),
  }
  return { client, query, update }
}
const cambiar = (client, extra = {}) => cambiarNombre({ client, userId: 'a', anterior: 'Viejo', nombre: ' Nuevo ', ...extra })

describe('edición de nombre sin alterar otros datos', () => {
  it('actualiza solo el nombre de la fila y versión esperadas', async () => {
    const { client, query, update } = preparar()
    await expect(cambiar(client)).resolves.toBe('Nuevo')
    expect(client.from).toHaveBeenCalledWith('users')
    expect(update).toHaveBeenCalledWith({ display_name: 'Nuevo' })
    expect(query.eq.mock.calls).toEqual([['id', 'a'], ['display_name', 'Viejo']])
    expect(query.select).toHaveBeenCalledWith('id,display_name')
  })
  it('no escribe si la cuenta cambió mientras estaba abierto el formulario', async () => {
    const { client } = preparar({ sessionId: 'b' })
    await expect(cambiar(client)).rejects.toThrow('sesión cambió')
    expect(client.from).not.toHaveBeenCalled()
  })
  it.each(['', ' ', 'x', 'x'.repeat(51)])('rechaza un nombre inválido antes de escribir: %s', async nombre => {
    const { client } = preparar()
    await expect(cambiar(client, { nombre })).rejects.toThrow('2 y 50')
    expect(client.from).not.toHaveBeenCalled()
  })
  it.each([{ data: null }, { error: { code: 'PGRST116' } }, { data: { id: 'b', display_name: 'Nuevo' } }])('no anuncia éxito sin una fila confirmada', async result => {
    const { client } = preparar({ result })
    await expect(cambiar(client)).rejects.toThrow('No pudimos confirmar')
  })
})
