import { describe, expect, it, vi } from 'vitest'
import { avatarPath, changeAvatar } from './avatar'

const userId = '00000000-0000-4000-8000-000000000001'
const prefix = 'https://pruebas.supabase.co/storage/v1/object/public/avatars/'
const oldPath = `${userId}-old.webp`
const previousUrl = prefix + oldPath
const blob = new Blob(['photo'], { type: 'image/webp' })

function setup({ updateError, throwUpdate, empty, removeError, emptyRemove, uploadError } = {}) {
  const events = []
  let nextUrl
  const bucket = {
    getPublicUrl: (path) => ({ data: { publicUrl: prefix + path } }),
    upload: vi.fn(async () => { events.push('upload'); return { error: uploadError } }),
    remove: vi.fn(async () => { events.push('remove'); return { error: removeError, data: emptyRemove ? [] : [{ name: oldPath }] } }),
  }
  const query = {
    eq: vi.fn(() => query), is: vi.fn(() => query), select: vi.fn(() => query),
    single: vi.fn(async () => {
      events.push('confirm')
      if (throwUpdate) throw new Error('connection reset after commit')
      return { error: updateError, data: empty ? null : { avatar_url: nextUrl } }
    }),
  }
  const update = vi.fn((value) => { nextUrl = value.avatar_url; return query })
  const client = { storage: { from: () => bucket }, from: () => ({ update }) }
  return { client, bucket, query, events, update }
}

describe('avatar seguro', () => {
  it('confirma una fila del perfil antes de borrar el archivo anterior', async () => {
    const s = setup()
    const result = await changeAvatar({ client: s.client, userId, previousUrl, blob })
    expect(s.events).toEqual(['upload', 'confirm', 'remove'])
    expect(result.cleanupPending).toBe(false)
    expect(result.avatarUrl).toMatch(/\.webp$/)
    expect(s.query.eq).toHaveBeenCalledWith('avatar_url', previousUrl)
    expect(s.query.select).toHaveBeenCalledWith('avatar_url')
    expect(s.bucket.upload.mock.calls[0][2].upsert).toBe(false)
  })
  it.each([{ updateError: { message: 'denied' } }, { empty: true }, { throwUpdate: true }])(
    'preserva ambos archivos si la escritura es rechazada o incierta: %j', async (options) => {
      const s = setup(options)
      await expect(changeAvatar({ client: s.client, userId, previousUrl, blob })).rejects.toThrow('confirmar')
      expect(s.bucket.remove).not.toHaveBeenCalled()
    },
  )
  it('no cambia el perfil si falla la subida', async () => {
    const s = setup({ uploadError: { message: 'denied' } })
    await expect(changeAvatar({ client: s.client, userId, previousUrl, blob })).rejects.toThrow('subir')
    expect(s.update).not.toHaveBeenCalled()
    expect(s.bucket.remove).not.toHaveBeenCalled()
  })
  it.each([{ emptyRemove: true }, { removeError: { message: 'denied' } }])(
    'informa limpieza pendiente incluso con respuesta vacía: %j', async (options) => {
      const s = setup(options)
      expect((await changeAvatar({ client: s.client, userId, previousUrl, blob })).cleanupPending).toBe(true)
    },
  )
  it('quita la referencia antes de borrar y no sube nada al eliminar', async () => {
    const s = setup()
    const result = await changeAvatar({ client: s.client, userId, previousUrl, blob: null })
    expect(s.events).toEqual(['confirm', 'remove'])
    expect(result.avatarUrl).toBeNull()
  })
  it('protege el primer avatar frente a otra escritura concurrente', async () => {
    const s = setup()
    await changeAvatar({ client: s.client, userId, previousUrl: null, blob })
    expect(s.query.is).toHaveBeenCalledWith('avatar_url', null)
    expect(s.bucket.remove).not.toHaveBeenCalled()
  })
  it('conserva el MIME real si el navegador devuelve PNG en vez de WebP', async () => {
    const s = setup()
    await changeAvatar({ client: s.client, userId, previousUrl, blob: new Blob(['png'], { type: 'image/png' }) })
    expect(s.bucket.upload.mock.calls[0][0]).toMatch(/\.png$/)
    expect(s.bucket.upload.mock.calls[0][2].contentType).toBe('image/png')
  })
  it('rechaza archivos grandes o tipos no permitidos antes de subir', async () => {
    const s = setup()
    for (const file of [new Blob(['svg'], { type: 'image/svg+xml' }), new Blob([new Uint8Array(1048577)], { type: 'image/png' })]) {
      await expect(changeAvatar({ client: s.client, userId, previousUrl, blob: file })).rejects.toThrow('1 MB')
    }
    expect(s.bucket.upload).not.toHaveBeenCalled()
  })
  it('nunca deriva una ruta borrable desde otro dominio, usuario o carpeta', () => {
    const { bucket } = setup()
    expect(avatarPath(previousUrl, bucket, userId)).toBe(oldPath)
    for (const url of [previousUrl.replace('pruebas.supabase.co', 'example.org'), prefix + 'otro.webp', prefix + userId + '-folder%2Ffile.webp', 'invalid%']) {
      expect(avatarPath(url, bucket, userId)).toBeNull()
    }
  })
})
