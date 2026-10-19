// Cada consulta debe seleccionar id, pedir count:'exact' y ordenar por id.
// Avanzar por las filas recibidas soporta un límite del servidor menor al
// solicitado. Nunca publicar el prefijo de una lectura fallida como un total.
export async function leerTodasLasFilas(consulta, { signal, pagina = 500, maximo = 100000 } = {}) {
  const filas = []
  const ids = new Set()
  let total
  for (;;) {
    signal?.throwIfAborted()
    let query = consulta().range(filas.length, filas.length + pagina - 1)
    if (signal) query = query.abortSignal(signal)
    const { data, count, error } = await query
    signal?.throwIfAborted()
    if (error) throw error
    if (!Array.isArray(data)) throw new Error('La respuesta no contiene una lista válida.')
    // Una respuesta vacía sin conteo no contiene un prefijo truncado.
    if (data.length === 0 && filas.length === 0 && count == null) return []
    if (!Number.isSafeInteger(count) || count < 0) throw new Error('No pudimos comprobar que la lista esté completa.')
    if (total !== undefined && count !== total) throw new Error('La lista cambió durante la lectura. Volvé a intentar.')
    total = count
    if (total > maximo) throw new Error('La lista es demasiado grande para cargarla completa en esta pantalla.')
    if (!data.length && filas.length < total) throw new Error('Faltan filas por cargar. Volvé a intentar.')
    for (const fila of data) {
      if (fila.id == null || ids.has(fila.id)) throw new Error('La lista cambió o contiene filas repetidas. Volvé a intentar.')
      ids.add(fila.id)
      filas.push(fila)
    }
    if (filas.length > total) throw new Error('La lista cambió durante la lectura. Volvé a intentar.')
    if (filas.length === total) return filas
  }
}
