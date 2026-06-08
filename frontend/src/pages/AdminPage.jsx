import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { motion } from 'motion/react'
import { ShieldAlert, Save, Clock, Search, X, RefreshCw } from 'lucide-react'

import GlobalSettingsAdmin from '../components/admin/GlobalSettingsAdmin'
import BracketAdmin from '../components/admin/BracketAdmin'
import PowerupsAdmin from '../components/admin/PowerupsAdmin'

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState('settings') // 'settings' or 'matches'

  const [matches, setMatches] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [syncing, setSyncing] = useState(false)
  
  // Form state
  const [formState, setFormState] = useState({})

  useEffect(() => {
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
    // Format the date for datetime-local input (YYYY-MM-DDThh:mm)
    // Parse UTC to local format
    const date = new Date(match.kickoff_at)
    const tzOffset = date.getTimezoneOffset() * 60000
    const localISOTime = new Date(date.getTime() - tzOffset).toISOString().slice(0, 16)

    setFormState({
      status: match.status,
      kickoff_at: localISOTime,
      home_goals_actual: match.home_goals_actual,
      away_goals_actual: match.away_goals_actual
    })
    setEditingId(match.id)
  }

  const handleSave = async (id) => {
    try {
      setSaving(true)
      
      // Convert local datetime back to UTC ISO string
      const date = new Date(formState.kickoff_at)
      const utcIsoTime = date.toISOString()

      const updates = {
        status: formState.status,
        kickoff_at: utcIsoTime,
        home_goals_actual: formState.home_goals_actual,
        away_goals_actual: formState.away_goals_actual
      }

      const { error } = await supabase
        .from('matches')
        .update(updates)
        .eq('id', id)

      if (error) throw error
      
      // If status is finished, calculate points!
      if (formState.status === 'finished') {
        const { calculateAndUpdateScores } = await import('../lib/scoring')
        const result = await calculateAndUpdateScores(id)
        if (result.status === 'error') {
            console.error("Error calculating scores:", result.message)
        } else {
            console.log("Scores calculated:", result)
        }
      }

      // Update local state
      setMatches(prev => prev.map(m => m.id === id ? { ...m, ...updates } : m))
      setEditingId(null)
    } catch (err) {
      console.error('Error updating match:', err)
      alert('Error al guardar: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleSyncAPI = async () => {
    try {
      setSyncing(true)
      const res = await fetch('/api/games')
      const apiData = await res.json()
      const apiGames = apiData.games || []

      const teamAlias = {
        'Czech Republic': 'Czechia',
        'Bosnia and Herzegovina': 'Bosnia-Herzegovina',
        'Democratic Republic of the Congo': 'DR Congo',
        'United States': 'USA',
        'Ivory Coast': 'Ivory Coast',
        'Curaçao': 'Curaçao',
        'Saudi Arabia': 'Saudi Arabia'
      }

      const getSupabaseTeam = (name) => teamAlias[name] || name

      let updatedCount = 0

      // Groups mapping (API id 1 to 72)
      const apiGroups = apiGames.filter(g => g.type === 'group')
      for (const apiGame of apiGroups) {
        const dbMatch = matches.find(m => 
          m.phase === 'groups' && 
          m.group_name === apiGame.group && 
          m.matchday === parseInt(apiGame.matchday) && 
          (m.home_team === getSupabaseTeam(apiGame.home_team_name_en) || m.away_team === getSupabaseTeam(apiGame.home_team_name_en))
        )

        if (dbMatch) {
          const newStatus = apiGame.finished === "TRUE" ? 'finished' : (apiGame.time_elapsed !== 'notstarted' ? 'in_progress' : 'pending')
          const newHomeGoals = apiGame.home_score ? parseInt(apiGame.home_score) : null
          const newAwayGoals = apiGame.away_score ? parseInt(apiGame.away_score) : null

          const hasChanged = dbMatch.status !== newStatus || dbMatch.home_goals_actual !== newHomeGoals || dbMatch.away_goals_actual !== newAwayGoals

          if (hasChanged && newStatus !== 'pending') {
            await supabase.from('matches').update({
              status: newStatus,
              home_goals_actual: newHomeGoals,
              away_goals_actual: newAwayGoals
            }).eq('id', dbMatch.id)

            if (newStatus === 'finished' && dbMatch.status !== 'finished') {
              const { calculateAndUpdateScores } = await import('../lib/scoring')
              await calculateAndUpdateScores(dbMatch.id)
            }
            updatedCount++
          }
        }
      }

      // Knockouts mapping (API id 73 to 104)
      const apiKnockouts = apiGames.filter(g => g.type !== 'group').sort((a,b) => parseInt(a.id) - parseInt(b.id))
      const dbKnockouts = matches.filter(m => m.phase !== 'groups').sort((a,b) => a.id - b.id)
      
      for (let i = 0; i < apiKnockouts.length; i++) {
        const apiGame = apiKnockouts[i]
        const dbMatch = dbKnockouts[i]

        if (apiGame && dbMatch) {
          const newStatus = apiGame.finished === "TRUE" ? 'finished' : (apiGame.time_elapsed !== 'notstarted' ? 'in_progress' : 'pending')
          const newHomeGoals = apiGame.home_score ? parseInt(apiGame.home_score) : null
          const newAwayGoals = apiGame.away_score ? parseInt(apiGame.away_score) : null

          const hasChanged = dbMatch.status !== newStatus || dbMatch.home_goals_actual !== newHomeGoals || dbMatch.away_goals_actual !== newAwayGoals

          if (hasChanged && newStatus !== 'pending') {
            await supabase.from('matches').update({
              status: newStatus,
              home_goals_actual: newHomeGoals,
              away_goals_actual: newAwayGoals
            }).eq('id', dbMatch.id)

            if (newStatus === 'finished' && dbMatch.status !== 'finished') {
              const { calculateAndUpdateScores } = await import('../lib/scoring')
              await calculateAndUpdateScores(dbMatch.id)
            }
            updatedCount++
          }
        }
      }

      alert(`Sincronización completada. Se actualizaron ${updatedCount} partidos.`)
      await fetchMatches()

    } catch (err) {
      console.error('Error syncing:', err)
      alert('Error sincronizando la API: ' + err.message)
    } finally {
      setSyncing(false)
    }
  }

  const filteredMatches = matches.filter(m => 
    m.home_team?.toLowerCase().includes(searchTerm.toLowerCase()) || 
    m.away_team?.toLowerCase().includes(searchTerm.toLowerCase())
  )

  return (
    <div className="px-4 py-5 bg-world-cup h-full min-h-screen md:min-h-0 relative">
      <motion.div
        initial={{ opacity: 0, y: -15 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-6 relative z-10"
      >
        <div className="flex items-center gap-3 mb-1.5">
          <div className="w-10 h-10 rounded-2xl bg-rose-500/20 flex items-center justify-center border border-rose-500/30">
            <ShieldAlert size={20} className="text-rose-500" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">Panel de Administración</h1>
            <p className="text-xs text-slate-500">Solo usuarios con is_admin = true</p>
          </div>
        </div>
        
        {/* Tabs */}
        <div className="flex gap-4 mt-6 border-b border-white/10 pb-1">
          <button 
            onClick={() => setActiveTab('settings')}
            className={`pb-3 text-sm font-bold transition-colors relative ${activeTab === 'settings' ? 'text-accent' : 'text-slate-500 hover:text-slate-300'}`}
          >
            Configuración Global
            {activeTab === 'settings' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent rounded-t-full" />}
          </button>
          <button 
            onClick={() => setActiveTab('matches')}
            className={`pb-3 text-sm font-bold transition-colors relative ${activeTab === 'matches' ? 'text-accent' : 'text-slate-500 hover:text-slate-300'}`}
          >
            Partidos / Resultados
            {activeTab === 'matches' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent rounded-t-full" />}
          </button>
          <button 
            onClick={() => setActiveTab('powerups')}
            className={`pb-3 text-sm font-bold transition-colors relative ${activeTab === 'powerups' ? 'text-accent' : 'text-slate-500 hover:text-slate-300'}`}
          >
            Comodines (x2)
            {activeTab === 'powerups' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent rounded-t-full" />}
          </button>
          <button 
            onClick={() => setActiveTab('bracket')}
            className={`pb-3 text-sm font-bold transition-colors relative ${activeTab === 'bracket' ? 'text-accent' : 'text-slate-500 hover:text-slate-300'}`}
          >
            Bracket (Eliminatorias)
            {activeTab === 'bracket' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent rounded-t-full" />}
          </button>
        </div>
      </motion.div>

      {/* Conditional Rendering based on activeTab */}
      {activeTab === 'settings' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <GlobalSettingsAdmin />
        </motion.div>
      )}

      {activeTab === 'powerups' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-4">
          <PowerupsAdmin />
        </motion.div>
      )}

      {activeTab === 'bracket' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="relative z-10 pb-20">
          <BracketAdmin />
        </motion.div>
      )}

      {activeTab === 'matches' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4 relative z-10 pb-20">
          {/* Control Panel */}
          <div className="mb-4 glass-card p-4 flex flex-col md:flex-row gap-3 items-center">
            <div className="relative flex-1 w-full">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Buscar por país..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-slate-100 dark:bg-slate-900/50 border border-slate-200 dark:border-white/10 rounded-xl pl-9 pr-4 py-2.5 text-sm text-slate-900 dark:text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
            <button
              onClick={handleSyncAPI}
              disabled={syncing}
              className="w-full md:w-auto px-4 py-2.5 bg-accent hover:bg-accent/90 disabled:opacity-50 text-slate-900 font-bold text-sm rounded-xl flex items-center justify-center gap-2 transition-colors"
            >
              <RefreshCw size={16} className={syncing ? 'animate-spin' : ''} />
              {syncing ? 'Sincronizando...' : 'Sincronizar API en Vivo'}
            </button>
          </div>

      {/* Matches List */}
      <div className="space-y-4 relative z-10 pb-20">
        {loading ? (
          <div className="text-center py-10 text-slate-400 text-sm">Cargando partidos...</div>
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
                    <img src={`https://flagcdn.com/w40/${match.home_team_code}.png`} alt="" className="w-6 h-4 rounded-sm object-cover" />
                    <span className="text-sm font-bold text-slate-900 dark:text-white truncate">{match.home_team}</span>
                  </div>

                  <div className="flex items-center gap-2 px-3 py-1 bg-slate-200 dark:bg-black/20 rounded-lg">
                    <span className="text-lg font-black text-slate-900 dark:text-white">{match.home_goals_actual ?? '-'}</span>
                    <span className="text-slate-500 font-bold">:</span>
                    <span className="text-lg font-black text-slate-900 dark:text-white">{match.away_goals_actual ?? '-'}</span>
                  </div>

                  <div className="flex items-center gap-2 flex-1 justify-end">
                    <span className="text-sm font-bold text-slate-900 dark:text-white truncate text-right">{match.away_team}</span>
                    <img src={`https://flagcdn.com/w40/${match.away_team_code}.png`} alt="" className="w-6 h-4 rounded-sm object-cover" />
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
                          onChange={(e) => setFormState({...formState, home_goals_actual: e.target.value ? parseInt(e.target.value) : null})}
                          className="w-14 text-center bg-white dark:bg-slate-900 border border-slate-300 dark:border-white/10 rounded-lg py-1.5 text-lg font-black text-slate-900 dark:text-white focus:outline-none focus:border-accent"
                        />
                      </div>
                      <span className="text-slate-400 font-bold">-</span>
                      <div className="flex items-center gap-2">
                        <input 
                          type="number" 
                          min="0"
                          value={formState.away_goals_actual ?? ''}
                          onChange={(e) => setFormState({...formState, away_goals_actual: e.target.value ? parseInt(e.target.value) : null})}
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
                          onChange={(e) => setFormState({...formState, status: e.target.value})}
                          className="w-full bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-accent"
                        >
                          <option value="pending">Pendiente / Programado</option>
                          <option value="in_progress">En Vivo</option>
                          <option value="finished">Finalizado</option>
                        </select>
                      </div>
                      <div className="flex-1">
                        <label className="block text-[10px] text-slate-400 mb-1 font-semibold uppercase">Fecha y Hora</label>
                        <input 
                          type="datetime-local"
                          value={formState.kickoff_at}
                          onChange={(e) => setFormState({...formState, kickoff_at: e.target.value})}
                          className="w-full bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-accent"
                        />
                      </div>
                    </div>
                  </div>
                )}
                
                {!isEditing && (
                   <div className="mt-3 flex items-center justify-between text-[11px] text-slate-500">
                     <span className="flex items-center gap-1">
                       <Clock size={10} /> 
                       {new Date(match.kickoff_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                     </span>
                     <span className={`font-semibold ${match.status === 'in_progress' ? 'text-accent' : match.status === 'finished' ? 'text-slate-500 dark:text-slate-400' : 'text-slate-600 dark:text-slate-300'}`}>
                       {match.status === 'in_progress' ? 'En Vivo' : match.status === 'finished' ? 'Finalizado' : 'Pendiente'}
                     </span>
                   </div>
                )}
              </div>
            )
          })
        )}
      </div>
      </motion.div>
      )}
    </div>
  )
}
