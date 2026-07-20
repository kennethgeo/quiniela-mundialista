// Acceso a grupos (quinielas) — envuelve las RPCs de database/26_groups_rpc.sql
import { supabase } from './supabase'

export async function fetchMyGroups() {
  const { data, error } = await supabase.rpc('my_groups')
  if (error) throw error
  return data || []
}

export async function fetchTournaments() {
  const { data, error } = await supabase
    .from('tournaments')
    .select('id, name, kind, status')
    .order('id')
  if (error) throw error
  return data || []
}

export async function createGroup(name, tournamentId) {
  const { data, error } = await supabase.rpc('create_group', {
    p_name: name,
    p_tournament_id: tournamentId,
  })
  if (error) throw error
  return data
}

export async function joinGroupByCode(code) {
  const { data, error } = await supabase.rpc('join_group_by_code', {
    p_code: (code || '').trim().toUpperCase(),
  })
  if (error) throw error
  return data
}

export async function fetchGroupStandings(leagueId) {
  const { data, error } = await supabase.rpc('group_standings', { p_league_id: leagueId })
  if (error) throw error
  return data || []
}

// Tabla real de posiciones de equipos (proxy backend a ESPN).
export async function fetchTeamStandings(tournamentId) {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(`/_backend/api/matches/tournament-standings?tournament_id=${tournamentId}`, {
    headers: { Authorization: `Bearer ${session?.access_token}` },
  })
  if (!res.ok) throw new Error(`Error ${res.status}`)
  return res.json()
}
