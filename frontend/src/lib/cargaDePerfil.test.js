import { describe, expect, it, vi } from 'vitest'
import { crearCargaDePerfil } from './cargaDePerfil'
const pendiente = () => {
  let resolve, reject
  const promise = new Promise((ok, no) => { resolve = ok; reject = no })
  return { promise, resolve, reject }
}

describe('respuestas de perfil fuera de orden', () => {
  it('una respuesta lenta de KGC no sustituye a KGCNA', async () => {
    const a = pendiente(), b = pendiente(), aplicar = vi.fn()
    const carga = crearCargaDePerfil({ leer: id => id === 'KGC' ? a.promise : b.promise, aplicar })
    carga.cambiarUsuario('KGC'); const primera = carga.cargar('KGC')
    carga.cambiarUsuario('KGCNA'); const segunda = carga.cargar('KGCNA')
    b.resolve({ id: 'KGCNA' }); await segunda
    a.resolve({ id: 'KGC', is_admin: true }); await primera
    expect(aplicar.mock.calls).toEqual([[{ id: 'KGCNA' }]])
  })
  it('salir e ingresar otra vez con el mismo ID invalida la sesión anterior', async () => {
    const a = pendiente(), aplicar = vi.fn()
    const carga = crearCargaDePerfil({ leer: () => a.promise, aplicar })
    carga.cambiarUsuario('KGC'); const primera = carga.cargar('KGC')
    carga.cambiarUsuario(null); carga.cambiarUsuario('KGC')
    a.resolve({ id: 'KGC' }); await primera
    expect(aplicar).not.toHaveBeenCalled()
  })
  it('un error viejo no vacía el perfil nuevo', async () => {
    const a = pendiente(), aplicar = vi.fn(), alFallar = vi.fn()
    const carga = crearCargaDePerfil({ leer: id => id === 'A' ? a.promise : Promise.resolve({ id }), aplicar, alFallar })
    carga.cambiarUsuario('A'); const primera = carga.cargar('A')
    carga.cambiarUsuario('B'); await carga.cargar('B')
    a.reject(new Error('red')); await primera
    expect(aplicar.mock.calls).toEqual([[{ id: 'B' }]])
    expect(alFallar).not.toHaveBeenCalled()
  })
  it('el refresco más nuevo de la misma cuenta gana', async () => {
    const a = pendiente(), aplicar = vi.fn(), leer = vi.fn().mockReturnValueOnce(a.promise).mockResolvedValueOnce({ id: 'A', avatar_url: 'nuevo' })
    const carga = crearCargaDePerfil({ leer, aplicar })
    carga.cambiarUsuario('A'); const primera = carga.cargar('A')
    await carga.cargar('A'); a.resolve({ id: 'A', avatar_url: 'viejo' }); await primera
    expect(aplicar.mock.calls).toEqual([[{ id: 'A', avatar_url: 'nuevo' }]])
  })
  it('rechaza cargar para otra cuenta y respuestas de identidad equivocada', async () => {
    const aplicar = vi.fn(), leer = vi.fn().mockResolvedValue({ id: 'B' })
    const carga = crearCargaDePerfil({ leer, aplicar })
    carga.cambiarUsuario('A')
    await carga.cargar('B'); expect(leer).not.toHaveBeenCalled()
    await carga.cargar('A'); expect(aplicar).toHaveBeenCalledWith(null)
  })
})
