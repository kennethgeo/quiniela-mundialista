// Solo la última consulta de la sesión vigente puede actualizar el perfil.
// Cambiar de cuenta invalida también respuestas que terminen después de salir.
export function crearCargaDePerfil({ leer, aplicar, alFallar = () => {} }) {
  let usuario = null
  let version = 0
  return {
    cambiarUsuario(id) {
      const actual = id ?? null
      if (actual === usuario) return false
      usuario = actual
      version += 1
      return true
    },
    async cargar(id) {
      if (!id || id !== usuario) return null
      const solicitud = ++version
      const vigente = () => usuario === id && version === solicitud
      try {
        const data = await leer(id)
        if (!vigente()) return null
        if (!data || data.id !== id) throw new Error('Perfil inesperado')
        aplicar(data)
        return data
      } catch {
        if (vigente()) {
          aplicar(null)
          alFallar()
        }
        return null
      }
    },
  }
}
