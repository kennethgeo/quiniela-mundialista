// Catálogo de medallas (display). Las CONDICIONES viven en el motor SQL
// database/46_badges_rework.sql (recompute_league_badges). Mantener sincronizados:
// si cambiás un umbral acá, cambialo también allá.

export const BADGE_FAMILIES = {
  precision: 'Precisión',
  streak: 'Rachas',
  powerup: 'Comodín',
  milestone: 'Hitos',
  fun: 'Divertidas',
}

// tiers: umbrales [bronce, plata, oro]. single: medalla sin niveles.
export const BADGES = {
  francotirador:    { name: 'Francotirador',    emoji: '🎯', family: 'precision', desc: 'Marcadores exactos',                       tiers: [3, 10, 25], unit: 'exactos' },
  rey_empate:       { name: 'Rey del empate',   emoji: '🤝', family: 'precision', desc: 'Empates exactos acertados',                tiers: [3, 8, 15],  unit: 'empates' },
  vidente:          { name: 'Vidente',          emoji: '🔮', family: 'precision', desc: 'Predicciones globales acertadas (campeón/goleador/asistidor)', tiers: [1, 2, 3], unit: 'aciertos' },
  jornada_perfecta: { name: 'Jornada perfecta', emoji: '💯', family: 'precision', desc: 'Acertar todos los partidos de una jornada', tiers: [1, 3, 5], unit: 'jornadas' },
  en_racha:         { name: 'En racha',         emoji: '🔥', family: 'streak',    desc: 'Aciertos seguidos',                        tiers: [3, 6, 10], unit: 'seguidos' },
  estratega:        { name: 'Estratega',        emoji: '⚡', family: 'powerup',   desc: 'Aciertos usando el comodín ×2',            tiers: [1, 5, 12], unit: 'con ×2' },
  pecho_frio:       { name: 'Pecho frío',       emoji: '🥶', family: 'fun',       desc: 'Usaste un ×2 y lo fallaste',               single: true },
  gallina:          { name: 'Gallina',          emoji: '🐔', family: 'fun',       desc: '10+ predicciones sin animarte a usar el ×2', single: true },
  fantasma:         { name: 'Fantasma',         emoji: '👻', family: 'fun',       desc: 'No predijiste ningún partido del torneo',  single: true },
  taylor:           { name: '0T',               emoji: '💩', family: 'fun',       desc: 'La medalla de Taylor (broma del grupo)',   single: true },
  debut:            { name: 'Debut',            emoji: '👋', family: 'milestone', desc: 'Hiciste tu primera predicción',            single: true },
  fundador:         { name: 'Fundador',         emoji: '🚩', family: 'milestone', desc: 'Creaste una quiniela',                     single: true },
  reglamentario:    { name: 'Reglamentario',    emoji: '✅', family: 'milestone', desc: 'Aceptaste las reglas de la quiniela',      single: true },
  votante:          { name: 'Votante',          emoji: '🗳️', family: 'milestone', desc: 'Votaste una propuesta de cambio de reglas', single: true },
}

export const TIER_LABEL = ['', 'Bronce', 'Plata', 'Oro']
export const TIER_COLOR = ['', '#CD7F32', '#C7CDD6', '#E8B75A']

// Orden de familias para la vitrina.
export const FAMILY_ORDER = ['precision', 'streak', 'powerup', 'milestone', 'fun']

export function badgeMeta(key) {
  return BADGES[key] || { name: key, emoji: '🏅', family: 'fun', desc: '', single: true }
}

// Próximo nivel y progreso (para medallas con niveles). Devuelve null si es 'single'.
export function tierProgress(key, tier, count) {
  const b = BADGES[key]
  if (!b || b.single || !b.tiers) return null
  const next = b.tiers.find((t) => (count ?? 0) < t)
  return { current: tier || 0, count: count ?? 0, next: next ?? null, max: b.tiers[b.tiers.length - 1] }
}
