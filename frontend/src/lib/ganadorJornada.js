// La RPC decide el ganador y los desempates. Este filtro solo comprueba que
// se pueda anunciar un cierre; nunca ordena ni calcula puntos.
export function ganadorParaCompartir(jornada) {
  const ganador = jornada?.ganador
  if (jornada?.cerrada !== true || !ganador?.user_id || !ganador.display_name ||
    !Number.isFinite(Number(ganador.puntos)) || Number(ganador.puntos) <= 0) return null
  return ganador
}
