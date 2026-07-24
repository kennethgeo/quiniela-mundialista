// Lectura de medallas (migración database/46_badges_rework.sql).
import { supabase } from './supabase'

// Todas mis medallas, en todas las quinielas.
export async function fetchMyMedals() {
  const { data, error } = await supabase.rpc('my_medals')
  if (error) throw error
  return data || []
}

// Medallas de una quiniela (todos los miembros).
export async function fetchLeagueMedals(leagueId) {
  const { data, error } = await supabase.rpc('league_medals', { p_league_id: leagueId })
  if (error) throw error
  return data || []
}

// Agrupa filas de my_medals por badge_key: mejor tier, mejor count, en qué quinielas.
export function aggregateMedals(rows) {
  const by = {}
  for (const r of rows || []) {
    const e = (by[r.badge_key] ||= { tier: 0, count: 0, leagues: [] })
    e.tier = Math.max(e.tier, r.tier || 1)
    e.count = Math.max(e.count, r.meta?.count ?? 0)
    if (r.league_name && !e.leagues.includes(r.league_name)) e.leagues.push(r.league_name)
  }
  return by
}
