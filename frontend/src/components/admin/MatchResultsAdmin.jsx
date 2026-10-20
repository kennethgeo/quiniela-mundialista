/* Admin: editar resultados de partidos (marcador, estado, penales, goleadores).
   Antes vivía inline en AdminPage.jsx mostrando TODOS los torneos mezclados sin
   filtro; ahora tiene selector de torneo. La carga de fixtures nuevos se hace en
   la pestaña Torneos (TournamentMatchesAdmin). */
import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { crestOnError } from '../../lib/teamLogo'

import { Save, Clock, Search, X, Lock } from 'lucide-react'
import MatchEventsEditor from './MatchEventsEditor'

/* Recalcula los puntos de un partido EN EL BACKEND.
   Antes esto se hacía en el navegador con lib/scoring.js, y estaba roto: las
   políticas RLS de 'predictions' solo dejan escribir al dueño de la predicción
   o a service_role, así que el admin actualizaba solo SUS puntos y los del
   resto fallaban en silencio. El backend corre con service_role y usa el mismo
   motor que el sync, que además respeta el puntaje configurado de la quiniela. */
async function recalcMatch(matchId) {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  if (!token) throw new Error('Sesión no válida')
  const res = await fetch('/_backend/api/admin/recalc-match', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ match_id: matchId }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.detail || `Error ${res.status}`)
  return json
}

export default function MatchResultsAdmin() {
  const [tournaments, setTournaments] = useState([])
  const [tid, setTid] = useState('') // '' = todos los torneos
  const [matches, setMatches] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [formState, setFormState] = useState({})

  useEffect(() => {
    supabase.from('tournaments').select('id, name').order('id').then(({ data }) => setTournaments(data || []))
    fetchMatches()
  }, [])

  const fetchMatches = async () => {
    try {
      setLoading(true)
      const { data, error } = await supabase
        .from('matches')
        .select('*')
        .order('kickoff_at', { ascending: true })

      if (error) throw error
      setMatches(data || [])
    } catch (err) {
      console.error('Error fetching matches:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleEditClick = (match) => {
    const date = new Date(match.kickoff_at)
    const tzOffset = date.getTimezoneOffset() * 60000
    const localISOTime = new Date(date.getTime() - tzOffset).toISOString().slice(0, 16)

    setFormState({
      status: match.status,
      kickoff_at: localISOTime,
      home_goals_actual: match.home_goals_actual,
      away_goals_actual: match.away_goals_actual,
      goes_to_penalties: match.goes_to_penalties || false,
      penalties_winner_real: match.penalties_winner_real || '',
      score_locked: match.score_locked || false,
      predictions_force_open: match.predictions_force_open || false
    })
    setEditingId(match.id)
  }

  const handleSave = async (id) => {
    try {
      setSaving(true)

      const date = new Date(formState.kickoff_at)
      const utcIsoTime = date.toISOString()

      const updates = {
        status: formState.status,
        kickoff_at: utcIsoTime,
        home_goals_actual: formState.home_goals_actual,
        away_goals_actual: formState.away_goals_actual,
        goes_to_penalties: formState.goes_to_penalties || false,
        penalties_winner_real: formState.goes_to_penalties ? (formState.penalties_winner_real || null) : null,
        score_locked: !!formState.score_locked,
        predictions_force_open: !!formState.predictions_force_open
      }

      const { error } = await supabase
        .from('matches')
        .update(updates)
        .eq('id', id)

      if (error) throw error

      const oldMatch = matches.find(m => m.id === id)
      if (oldMatch && (formState.status !== oldMatch.status || formState.home_goals_actual !== oldMatch.home_goals_actual || formState.away_goals_actual !== oldMatch.away_goals_actual || (formState.goes_to_penalties || false) !== (oldMatch.goes_to_penalties || false) || (formState.penalties_winner_real || '') !== (oldMatch.penalties_winner_real || ''))) {
        await recalcMatch(id)
      }

      setMatches(prev => prev.map(m => m.id === id ? { ...m, ...updates } : m))
      setEditingId(null)
    } catch (err) {
      console.error('Error updating match:', err)
      alert('Error al guardar: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  const filteredMatches = matches
    .filter(m => !tid || m.tournament_id === tid)
    .filter(m =>
      m.home_team?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      m.away_team?.toLowerCase().includes(searchTerm.toLowerCase())
    )

  return (
    <div className="space-y-4">
      {/* Control Panel */}
      <div className="glass-card p-4 flex flex-col md:flex-row gap-3 items-center">
        <select
          value={tid}
          onChange={(e) => setTid(e.target.value ? Number(e.target.value) : '')}
          className="w-full md:w-56 shrink-0 bg-slate-100 dark:bg-slate-900/50 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-accent"
        >
          <option value="">Todos los torneos</option>
          {tournaments.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <div className="relative flex-1 w-full">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Buscar por equipo..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-slate-100 dark:bg-slate-900/50 border border-slate-200 dark:border-white/10 rounded-xl pl-9 pr-4 py-2.5 text-sm text-slate-900 dark:text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>

      </div>

      {/* Matches List */}
      <div className="space-y-4">
        {loading ? (
          <div className="text-center py-10 text-slate-400 text-sm">Cargando partidos...</div>
        ) : filteredMatches.length === 0 ? (
          <div className="text-center py-10 text-slate-400 text-sm">Sin partidos para este filtro.</div>
        ) : (
          filteredMatches.map(match => {
            const isEditing = editingId === match.id
            return (
              <div key={match.id} className={`glass-card p-4 transition-all ${isEditing ? 'ring-1 ring-accent' : ''}`}>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest bg-white/5 px-2 py-0.5 rounded-md">
                    {match.phase} {match.group_name && `· Grupo ${match.group_name}`}
                  </span>

                  {isEditing ? (
                    <div className="flex gap-2">
                      <button onClick={() => setEditingId(null)} className="p-1.5 bg-white/5 hover:bg-white/10 text-slate-300 rounded-lg">
                        <X size={14} />
                      </button>
                      <button onClick={() => handleSave(match.id)} disabled={saving} className="p-1.5 bg-accent/20 hover:bg-accent/30 text-accent rounded-lg">
                        <Save size={14} />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => handleEditClick(match)}
                      className="text-xs font-semibold text-accent hover:text-amber-300 transition-colors"
                    >
                      Editar
                    </button>
                  )}
                </div>

                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2 flex-1">
                    <img src={match.home_flag_url || (match.home_team_code?.startsWith('https://') ? match.home_team_code : `https://flagcdn.com/w40/${match.home_team_code || 'xx'}.png`)} onError={crestOnError(match.home_team)} alt="" className="w-6 h-6 object-contain" />
                    <span className="text-sm font-bold text-slate-900 dark:text-white truncate">{match.home_team}</span>
                  </div>

                  <div className="flex items-center gap-2 px-3 py-1 bg-slate-200 dark:bg-black/20 rounded-lg">
                    <span className="text-lg font-black text-slate-900 dark:text-white">{match.home_goals_actual ?? '-'}</span>
                    <span className="text-slate-500 font-bold">:</span>
                    <span className="text-lg font-black text-slate-900 dark:text-white">{match.away_goals_actual ?? '-'}</span>
                  </div>

                  <div className="flex items-center gap-2 flex-1 justify-end">
                    <span className="text-sm font-bold text-slate-900 dark:text-white truncate text-right">{match.away_team}</span>
                    <img src={match.away_flag_url || (match.away_team_code?.startsWith('https://') ? match.away_team_code : `https://flagcdn.com/w40/${match.away_team_code || 'xx'}.png`)} onError={crestOnError(match.away_team)} alt="" className="w-6 h-6 object-contain" />
                  </div>
                </div>

                {isEditing && (
                  <div className="mt-4 pt-4 border-t border-white/5 flex flex-col gap-4">
                    <div className="flex items-center justify-center gap-4 bg-slate-100 dark:bg-black/20 p-3 rounded-xl">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-500 uppercase">{match.home_team}</span>
                        <input
                          type="number"
                          min="0"
                          value={formState.home_goals_actual ?? ''}
                          onChange={(e) => setFormState({ ...formState, home_goals_actual: e.target.value ? parseInt(e.target.value) : null })}
                          className="w-14 text-center bg-white dark:bg-slate-900 border border-slate-300 dark:border-white/10 rounded-lg py-1.5 text-lg font-black text-slate-900 dark:text-white focus:outline-none focus:border-accent"
                        />
                      </div>
                      <span className="text-slate-400 font-bold">-</span>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min="0"
                          value={formState.away_goals_actual ?? ''}
                          onChange={(e) => setFormState({ ...formState, away_goals_actual: e.target.value ? parseInt(e.target.value) : null })}
                          className="w-14 text-center bg-white dark:bg-slate-900 border border-slate-300 dark:border-white/10 rounded-lg py-1.5 text-lg font-black text-slate-900 dark:text-white focus:outline-none focus:border-accent"
                        />
                        <span className="text-xs font-bold text-slate-500 uppercase">{match.away_team}</span>
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-3">
                      <div className="flex-1">
                        <label className="block text-[10px] text-slate-400 mb-1 font-semibold uppercase">Estado</label>
                        <select
                          value={formState.status}
                          onChange={(e) => setFormState({
                            ...formState,
                            status: e.target.value,
                            // Marcar un partido como no disputado es siempre una
                            // decisión manual: se fija para que el sync no la pise.
                            score_locked: e.target.value === 'cancelled' ? true : formState.score_locked,
                          })}
                          className="w-full bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-accent"
                        >
                          <option value="pending">Pendiente / Programado</option>
                          <option value="in_progress">En Vivo</option>
                          <option value="finished">Finalizado</option>
                          <option value="cancelled">Suspendido / No disputado</option>
                        </select>
                      </div>
                      <div className="flex-1">
                        <label className="block text-[10px] text-slate-400 mb-1 font-semibold uppercase">Fecha y Hora</label>
                        <input
                          type="datetime-local"
                          value={formState.kickoff_at}
                          onChange={(e) => setFormState({ ...formState, kickoff_at: e.target.value })}
                          className="w-full bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-accent"
                        />
                      </div>
                    </div>

                    {/* Penales (solo eliminatoria) */}
                    {match.phase !== 'groups' && (
                      <div className="bg-slate-100 dark:bg-black/20 p-3 rounded-xl">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={!!formState.goes_to_penalties}
                            onChange={(e) => setFormState({ ...formState, goes_to_penalties: e.target.checked, penalties_winner_real: e.target.checked ? formState.penalties_winner_real : '' })}
                            className="accent-purple-500 w-4 h-4"
                          />
                          <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">Se definió por penales</span>
                        </label>
                        {formState.goes_to_penalties && (
                          <div className="mt-2">
                            <label className="block text-[10px] text-slate-400 mb-1 font-semibold uppercase">Ganó la tanda</label>
                            <select
                              value={formState.penalties_winner_real || ''}
                              onChange={(e) => setFormState({ ...formState, penalties_winner_real: e.target.value })}
                              className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-accent"
                            >
                              <option value="">— elegir quién avanza —</option>
                              <option value={match.home_team}>{match.home_team}</option>
                              <option value={match.away_team}>{match.away_team}</option>
                            </select>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Candado: la fuente automática (ESPN) deja de tocar este partido */}
                    <label className="flex items-start gap-2 cursor-pointer bg-slate-100 dark:bg-black/20 p-3 rounded-xl">
                      <input
                        type="checkbox"
                        checked={!!formState.score_locked}
                        onChange={(e) => setFormState({ ...formState, score_locked: e.target.checked })}
                        className="accent-amber-500 w-4 h-4 mt-0.5 shrink-0"
                      />
                      <span className="min-w-0">
                        <span className="block text-xs font-semibold text-slate-700 dark:text-slate-200">
                          🔒 Fijar este resultado (el sync no lo cambia)
                        </span>
                        <span className="block text-[11px] text-slate-500 mt-0.5">
                          Actívalo cuando el marcador oficial no coincide con lo que reporta ESPN:
                          alineación indebida, walkover o un partido que no se jugó. Sin esto, la
                          próxima sincronización lo devuelve a lo que diga ESPN.
                        </span>
                      </span>
                    </label>


                    {/* Reabrir las predicciones de ESTE partido. Solo se ofrece
                        mientras el partido NO haya terminado: en uno finalizado
                        la política RLS lo ignora, así que mostrar la casilla
                        sería ofrecer un interruptor que guarda y no hace nada
                        —el fallo silencioso que este repo ya pagó dos veces. */}
                    {/* Solo con el partido PENDIENTE: la rama forzada de la RLS exige
                        status = 'pending' (migración 105). En vivo la casilla
                        guardaba y no hacía nada. */}
                    {formState.status === 'pending' && (
                      <label className="flex items-start gap-2 cursor-pointer bg-slate-100 dark:bg-black/20 p-3 rounded-xl">
                        <input
                          type="checkbox"
                          checked={!!formState.predictions_force_open}
                          onChange={(e) => setFormState({ ...formState, predictions_force_open: e.target.checked })}
                          className="accent-amber-500 w-4 h-4 mt-0.5 shrink-0"
                        />
                        <span className="min-w-0">
                          <span className="block text-xs font-semibold text-slate-700 dark:text-slate-200">
                            🔓 Reabrir predicciones de este partido
                          </span>
                          <span className="block text-[11px] text-slate-500 mt-0.5">
                            Para cuando el cierre fue un error de los datos: la hora del saque
                            vino mal o el partido se reprogramó. Mientras dure, todos pueden
                            corregir la suya y <b>las predicciones ajenas se vuelven a tapar</b>,
                            para que nadie copie al vecino. <b>Vale solo mientras el partido
                            siga Pendiente</b>: en cuanto pasa a En vivo la base deja de
                            aceptar cambios, aunque la casilla siga marcada.
                          </span>
                        </span>
                      </label>
                    )}

                    {/* Goleadores (todos los partidos) */}
                    <MatchEventsEditor
                      match={match}
                      onSaved={(events) => setMatches(prev => prev.map(m => m.id === match.id ? { ...m, events_json: events } : m))}
                    />
                  </div>
                )}

                {!isEditing && (
                  <div className="mt-3 flex items-center justify-between text-[11px] text-slate-500">
                    <span className="flex items-center gap-1.5">
                      <Clock size={10} />
                      {new Date(match.kickoff_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                      {match.predictions_force_open && match.status === 'pending' && (
                        <span className="flex items-center gap-0.5 font-bold text-[10px] text-[#FF7A59]"
                          title="Predicciones reabiertas: todos pueden corregir la suya mientras siga pendiente">
                          🔓 reabierto
                        </span>
                      )}
                      {match.score_locked && (
                        <span className="flex items-center gap-0.5 font-bold text-[10px] text-amber-500"
                          title="Resultado fijado a mano: el sync automático no lo cambia">
                          <Lock size={9} /> fijado
                        </span>
                      )}
                    </span>
                    <span className={`font-semibold ${match.status === 'in_progress' ? 'text-accent' : match.status === 'cancelled' || match.status === 'postponed' ? 'text-[#FF7A59]' : match.status === 'finished' ? 'text-slate-500 dark:text-slate-400' : 'text-slate-600 dark:text-slate-300'}`}>
                      {match.status === 'in_progress' ? 'En Vivo' : match.status === 'cancelled' || match.status === 'postponed' ? 'Suspendido' : match.status === 'finished' ? 'Finalizado' : 'Pendiente'}
                    </span>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
