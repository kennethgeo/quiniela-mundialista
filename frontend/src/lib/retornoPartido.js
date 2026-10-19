// Solo rutas internas de quiniela; una URL compartida conserva el grupo.
export function retornoPartido(origen, grupo) {
  if (typeof origen === 'string' && /^\/q\/[a-zA-Z0-9-]+(?:\?[^#]*)?$/.test(origen)) return origen
  if (typeof grupo === 'string' && /^[a-zA-Z0-9-]+$/.test(grupo)) return `/q/${grupo}`
  return '/'
}

export function enlacePartido(id, origen) {
  const grupo = /^\/q\/([a-zA-Z0-9-]+)/.exec(origen)?.[1]
  return `/match/${id}${grupo ? `?group=${grupo}` : ''}`
}
