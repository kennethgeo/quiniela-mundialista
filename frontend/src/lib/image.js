/**
 * Redimensiona y comprime una imagen en el navegador antes de subirla.
 * Evita subir fotos de teléfono de varios MB que luego se descargan una y otra
 * vez en el ranking/podio/perfil (eso disparaba el Cached Egress de Supabase).
 *
 * Devuelve un Blob webp pequeño (~20-40KB). Si algo falla, devuelve el archivo
 * original para no romper la subida.
 *
 * @param {File} file
 * @param {number} maxSize  lado máximo en píxeles (cuadrado de contención)
 * @param {number} quality  0..1
 * @returns {Promise<Blob>}
 */
export async function resizeImage(file, maxSize = 256, quality = 0.82) {
  try {
    const dataUrl = await new Promise((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(r.result)
      r.onerror = reject
      r.readAsDataURL(file)
    })
    const img = await new Promise((resolve, reject) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = reject
      i.src = dataUrl
    })

    let { width, height } = img
    if (width >= height && width > maxSize) {
      height = Math.round((height * maxSize) / width)
      width = maxSize
    } else if (height > width && height > maxSize) {
      width = Math.round((width * maxSize) / height)
      height = maxSize
    }

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0, width, height)

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', quality))
    return blob || file
  } catch {
    return file
  }
}
