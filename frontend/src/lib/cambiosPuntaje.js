import { nombreDeFase } from './fasesDeTorneo'

const ETIQUETAS = {
  points_exact: 'Marcador exacto',
  points_correct: 'Resultado correcto',
  powerup_limit: 'Comodines ×2 por jornada',
  powerup_por_partidos: 'Un ×2 cada N partidos',
  champion_points: 'Acertar campeón',
  scorer_points: 'Acertar goleador',
  assist_points: 'Acertar asistidor',
}

export function cambiosPuntaje(payload = {}, current = {}) {
  const rows = Object.entries(ETIQUETAS)
    .filter(([k]) => payload[k] != null && Number(payload[k]) !== Number(current[k]))
    .map(([k, label]) => ({ key: k, label, from: current[k] ?? '—', to: payload[k] }))

  // El objeto es un REEMPLAZO: quitar una clave vuelve al cupo general, no a
  // cero. Mirar también las claves anteriores evita ocultar esas bajas.
  if (payload.powerup_limits != null) {
    const before = current.powerup_limits || {}
    const after = payload.powerup_limits
    const keys = new Set([...Object.keys(before), ...Object.keys(after)])
    const valor = (v) => v == null ? 'Cupo general' : v
    for (const key of keys) {
      const a = before[key] ?? null
      const b = after[key] ?? null
      if (a === b || (a != null && b != null && Number(a) === Number(b))) continue
      rows.push({ key: `fase:${key}`, label: `Comodines ×2 · ${nombreDeFase(key)}`, from: valor(a), to: valor(b) })
    }
  }
  return rows
}
