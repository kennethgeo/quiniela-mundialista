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

// Reglas por defecto que se muestran al crear una quiniela (editables).
// Debe coincidir con el DEFAULT de leagues.rules en database/36_group_rules.sql.
export const DEFAULT_RULES = `Reglas de la quiniela

1. Predicciones: cada quiniela juega el torneo elegido por su administrador. Las predicciones se cierran al iniciar cada partido.

2. Puntaje: marcador exacto = 3 pts, resultado correcto = 1 pt. El comodín ×2 duplica los puntos, según los límites de cada jornada/fase.

2.1 Formato del torneo: en las ligas, la fase regular puntúa así (3 / 1). Al terminar la fase regular, la postemporada (semifinales, final o liguilla) se juega como eliminatoria: aplican las reglas de penales (el empate puntúa aunque falles el penal, +1 por acertar quién avanza, y el ×2 duplica todo). En las copas, la fase de grupos es 3 / 1 y la eliminatoria usa esas mismas reglas de penales. El campeón se define en la final y suma con tu predicción global de campeón.

3. Respeto ante todo: mantené el respeto hacia todas las personas del grupo. Si se le falta el respeto a cualquier integrante, el administrador procederá a eliminar a la persona de la quiniela, sin derecho a reclamo alguno.

4. Juego limpio: prohibido hacer trampa o usar cuentas falsas.

5. Diversión: al final es un juego entre amigos. ¡Pura vida! 🇨🇷`

export async function createGroup(name, tournamentId, rules) {
  const payload = { p_name: name, p_tournament_id: tournamentId }
  if (rules != null) payload.p_rules = rules
  let { data, error } = await supabase.rpc('create_group', payload)
  // Fallback si aún no se corrió la migración 36 (RPC sin p_rules).
  if (error && rules != null && /p_rules|does not exist|find the function/i.test(error.message || '')) {
    ({ data, error } = await supabase.rpc('create_group', { p_name: name, p_tournament_id: tournamentId }))
  }
  if (error) throw error
  return data
}

export async function acceptGroupRules(leagueId) {
  const { error } = await supabase.rpc('accept_group_rules', { p_league_id: leagueId })
  if (error) throw error
}

export async function setGroupRules(leagueId, rules) {
  const { error } = await supabase.rpc('set_group_rules', { p_league_id: leagueId, p_rules: rules })
  if (error) throw error
}

// Eliminar quiniela (solo admin).
export async function deleteGroup(leagueId) {
  const { error } = await supabase.rpc('delete_group', { p_league_id: leagueId })
  if (error) throw error
}

// Config de puntaje por quiniela (solo admin de la quiniela).
export async function setGroupScoring(leagueId, cfg) {
  const { error } = await supabase.rpc('set_group_scoring', {
    p_league_id: leagueId,
    p_points_exact: cfg.points_exact,
    p_points_correct: cfg.points_correct,
    p_champion_points: cfg.champion_points,
    p_scorer_points: cfg.scorer_points,
    p_powerup_limit: cfg.powerup_limit,
  })
  if (error) throw error
}

/* ---- Votación de cambios de reglas durante el torneo (migración 42) ---- */

// Proponer un cambio (solo admin). kind: 'scoring' | 'rules'.
export async function proposeRuleChange(leagueId, kind, payload, note) {
  const { data, error } = await supabase.rpc('propose_rule_change', {
    p_league_id: leagueId, p_kind: kind, p_payload: payload, p_note: note ?? null,
  })
  if (error) throw error
  return data
}

// Votar una propuesta abierta (a favor / en contra).
export async function castRuleVote(proposalId, vote) {
  const { error } = await supabase.rpc('cast_rule_vote', { p_proposal_id: proposalId, p_vote: vote })
  if (error) throw error
}

// Cancelar la propuesta abierta (solo admin).
export async function cancelRuleProposal(proposalId) {
  const { error } = await supabase.rpc('cancel_rule_proposal', { p_proposal_id: proposalId })
  if (error) throw error
}

// Propuestas de una quiniela (abierta + historial).
export async function fetchLeagueProposals(leagueId) {
  const { data, error } = await supabase.rpc('league_proposals', { p_league_id: leagueId })
  if (error) throw error
  return data || []
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
