/**
 * Orden de desempate del ranking — única fuente de verdad en el frontend.
 *
 * Las métricas las calcula la base de datos (user_badges_view); aquí solo
 * declaramos el orden, que debe coincidir con el ORDER BY de la vista
 * (database/12_leaderboard_tiebreak.sql):
 *
 *   1) total_points   (puntos)                                  ↓
 *   2) exact_count    (marcadores exactos)                      ↓
 *   3) correct_count  (resultados correctos, incluye exactos)   ↓
 *   4) scorer_goals   (goles del goleador elegido)              ↓
 *   5) champion_hit   (acertó al campeón)                       ↓
 *   6) created_at     (fecha de registro: el más antiguo gana)  ↑
 *
 * created_at es único por usuario, así que el orden queda SIEMPRE estricto.
 */

const num = (v) => (typeof v === 'number' ? v : Number(v) || 0)
const ts = (v) => {
  const t = v ? new Date(v).getTime() : 0
  return Number.isFinite(t) ? t : 0
}

/**
 * Comparador para ordenar/reordenar el ranking en cliente (carga inicial y
 * actualizaciones en vivo). Es tolerante a filas sin las columnas de desempate
 * (p. ej. si la migración de la vista aún no se aplicó): los campos ausentes se
 * tratan como 0/false, degradando a un orden solo por puntos sin romperse.
 */
export function compareLeaderboard(a, b) {
  return (
    num(b.total_points) - num(a.total_points) ||
    num(b.exact_count) - num(a.exact_count) ||
    num(b.correct_count) - num(a.correct_count) ||
    num(b.scorer_goals) - num(a.scorer_goals) ||
    (Number(!!b.champion_hit) - Number(!!a.champion_hit)) ||
    (ts(a.created_at) - ts(b.created_at))
  )
}

/** Ordena (copia) una lista de entradas del ranking con el desempate oficial. */
export function sortLeaderboard(entries) {
  return [...(entries || [])].sort(compareLeaderboard)
}
