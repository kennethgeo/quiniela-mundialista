// Cupos del comodín x2 por fase/jornada.
//
// Regla especial: el TERCER PUESTO y la FINAL comparten un ÚNICO comodín
// (no es uno para cada uno). Por eso ambos colapsan a una sola llave de cupo
// ('final_group'): sus usos se suman juntos y el límite es compartido.
export const POWERUP_FINAL_GROUP = 'final_group'

// Llave de cupo de un partido. Grupos → 'groups_<jornada>'. Resto de fases →
// su propia fase, salvo 3er puesto + final, que comparten 'final_group'.
export function powerupKey(phase, matchday) {
  if (phase === 'third_place' || phase === 'final') return POWERUP_FINAL_GROUP
  return matchday ? `${phase}_${matchday}` : phase
}

// Construye el mapa { llaveDeCupo: max_uses } desde las filas de powerup_limits,
// colapsando 3er puesto + final en 'final_group' con el límite compartido
// (el menor de los dos, por si difirieran).
export function buildPowerupLimits(rows) {
  const o = {}
  for (const l of rows || []) {
    const k = powerupKey(l.phase, l.matchday)
    o[k] = k === POWERUP_FINAL_GROUP ? Math.min(o[k] ?? Infinity, l.max_uses) : l.max_uses
  }
  return o
}
