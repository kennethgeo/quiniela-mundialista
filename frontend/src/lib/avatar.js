// Solo limpiamos objetos de este proyecto, con ruta plana propia y después
// de una respuesta que confirme la actualización del perfil.
export function avatarPath(url, bucket, userId) {
  if (!url) return null
  try {
    const base = new URL(bucket.getPublicUrl('').data.publicUrl)
    const candidate = new URL(url)
    if (candidate.origin !== base.origin || !candidate.pathname.startsWith(base.pathname)) return null
    const path = decodeURIComponent(candidate.pathname.slice(base.pathname.length))
    if (!path.startsWith(`${userId}-`) || path.includes('/') || path.includes('\\')) return null
    return path
  } catch { return null }
}

export async function changeAvatar({ client, userId, previousUrl, blob }) {
  const bucket = client.storage.from('avatars')
  let nextUrl = null
  if (blob) {
    const extension = { 'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpg' }[blob.type]
    if (!extension || blob.size > 1024 * 1024) throw new Error('Usá una imagen JPG, PNG o WebP de hasta 1 MB después de optimizarla.')
    const path = `${userId}-${crypto.randomUUID()}.${extension}`
    const { error } = await bucket.upload(path, blob, {
      contentType: blob.type, cacheControl: '31536000', upsert: false,
    })
    if (error) throw new Error('No pudimos subir la foto. Revisá tu conexión e intentá de nuevo.')
    nextUrl = bucket.getPublicUrl(path).data.publicUrl
  }

  let update = client.from('users').update({ avatar_url: nextUrl }).eq('id', userId)
  // Evita sobrescribir una foto cambiada desde otro dispositivo.
  update = previousUrl == null ? update.is('avatar_url', null) : update.eq('avatar_url', previousUrl)
  let result
  try { result = await update.select('avatar_url').single() } catch {
    throw new Error('No pudimos confirmar el cambio. Recargá el perfil antes de intentar de nuevo; conservamos los archivos.')
  }
  if (result.error || !result.data || result.data.avatar_url !== nextUrl) {
    // La respuesta puede haberse perdido DESPUÉS del commit. Nunca eliminar
    // la nueva imagen como compensación: podría ser el avatar vigente.
    throw new Error('No pudimos confirmar el cambio. Recargá el perfil antes de intentar de nuevo; conservamos los archivos.')
  }

  const oldPath = avatarPath(previousUrl, bucket, userId)
  let cleanupPending = false
  if (oldPath && previousUrl !== nextUrl) {
    try {
      const removed = await bucket.remove([oldPath])
      // Storage puede responder 200 y [] cuando RLS no permite borrar.
      cleanupPending = !!removed.error || !removed.data?.some((item) => item.name === oldPath)
    } catch { cleanupPending = true }
  }
  return { avatarUrl: nextUrl, cleanupPending }
}
