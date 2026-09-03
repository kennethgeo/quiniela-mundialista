// Cupos del comodín x2 por fase/jornada.
// Llave de cupo de un partido. Grupos → 'groups_<jornada>'. Resto de fases →
// su propia fase. Esto replica la llave que usa el trigger de Postgres.
export function powerupKey(phase, matchday) {
  return matchday ? `${phase}_${matchday}` : phase
}

// Construye el mapa { llaveDeCupo: max_uses } desde las filas de powerup_limits.
export function buildPowerupLimits(rows) {
  const o = {}
  for (const l of rows || []) {
    const k = powerupKey(l.phase, l.matchday)
    o[k] = l.max_uses
  }
  return o
}
