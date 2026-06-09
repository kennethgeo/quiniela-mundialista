/* Vista de fase de grupos con filtro por grupo */
import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import MatchList from './MatchList'
import LoadingSpinner from '../ui/LoadingSpinner'
import GroupStandings from './GroupStandings'

const GROUPS = ['Todos', 'A','B','C','D','E','F','G','H','I','J','K','L']
const MATCHDAYS = ['Todas', 1, 2, 3]

export default function GroupStage() {
  const { profile } = useAuth()
  const [selectedGroup, setSelectedGroup] = useState('Todos')
  const [selectedMatchday, setSelectedMatchday] = useState(1)
  const [matches, setMatches] = useState([])
  const [predictions, setPredictions] = useState([])
  const [powerupLimits, setPowerupLimits] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  // Cargar partidos de fase de grupos y límites de comodines
  useEffect(() => {
    const fetchData = async () => {
      if (!profile) return
      try {
        setLoading(true)
        const [matchesRes, predsRes, limitsRes] = await Promise.all([
          supabase.from('matches').select('*').eq('phase', 'groups').order('kickoff_at', { ascending: true }),
          supabase.from('predictions').select('*').eq('user_id', profile.id),
          supabase.from('powerup_limits').select('*')
        ])
        
        if (matchesRes.error) throw matchesRes.error
        if (predsRes.error) throw predsRes.error
        if (limitsRes.error) throw limitsRes.error
        
        setMatches(matchesRes.data || [])
        setPredictions(predsRes.data || [])

        // Procesar límites en un diccionario fácil de consultar
        const limitsObj = {}
        if (limitsRes.data) {
          limitsRes.data.forEach(l => {
            const key = l.matchday ? `${l.phase}_${l.matchday}` : l.phase
            limitsObj[key] = l.max_uses
          })
        }
        setPowerupLimits(limitsObj)

      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [profile])

  // Asegurar orden cronologico estricto en el cliente
  const chronologicallySortedMatches = [...matches].sort((a, b) => new Date(a.kickoff_at) - new Date(b.kickoff_at))

  // Recalcular matchday basado en el orden cronológico por grupo (para evitar errores de la API)
  const matchesByGroup = {}
  chronologicallySortedMatches.forEach(m => {
    if (!matchesByGroup[m.group_name]) matchesByGroup[m.group_name] = []
    matchesByGroup[m.group_name].push(m)
  })
  
  const fixedMatches = []
  Object.keys(matchesByGroup).forEach(group => {
    matchesByGroup[group].forEach((m, idx) => {
      // En un grupo de 4 equipos, hay 6 partidos. Los partidos 0,1 son J1; 2,3 son J2; 4,5 son J3.
      const calculatedMatchday = Math.floor(idx / 2) + 1
      fixedMatches.push({ ...m, matchday: calculatedMatchday })
    })
  })
  
  // Volver a ordenar cronológicamente todo junto
  const sortedMatches = fixedMatches.sort((a, b) => new Date(a.kickoff_at) - new Date(b.kickoff_at))

  // Filtrar partidos por grupo y jornada seleccionados
  let filteredMatches = sortedMatches
  if (selectedGroup !== 'Todos') {
    filteredMatches = filteredMatches.filter(m => m.group_name === selectedGroup)
  }
  if (selectedMatchday !== 'Todas') {
    filteredMatches = filteredMatches.filter(m => m.matchday === selectedMatchday)
  }

  // Guardar predicción
  const handleSavePrediction = async (prediction) => {
    try {
      setSaving(true)
      const { data: result, error: saveError } = await supabase
        .from('predictions')
        .upsert({ ...prediction, user_id: profile.id }, { onConflict: 'user_id, match_id' })
        .select()
        
      if (saveError) throw saveError
      
      // Actualizar predicciones locales
      setPredictions(prev => {
        const existing = prev.findIndex(p => p.match_id === prediction.match_id)
        if (existing >= 0) {
          const updated = [...prev]
          updated[existing] = { ...updated[existing], ...prediction }
          return updated
        }
        return [...prev, result?.[0] || prediction]
      })
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <LoadingSpinner />

  return (
    <div className="relative z-10">
      {/* Selector de grupo - Premium scrollable chips */}
      <div className="mb-6">
        <div className="flex gap-2 overflow-x-auto pb-3 scrollbar-hide px-0.5">
          {GROUPS.map((group, i) => {
            const isActive = selectedGroup === group
            return (
              <motion.button
                key={group}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                whileTap={{ scale: 0.9 }}
                onClick={() => setSelectedGroup(group)}
                className={`relative flex-shrink-0 w-12 h-12 rounded-2xl font-bold text-sm transition-all duration-300 ${
                  isActive
                    ? 'gradient-gold text-slate-900 shadow-lg shadow-amber-500/30'
                    : 'glass-strong text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:border-slate-300 dark:hover:border-white/15 bg-white dark:bg-transparent'
                }`}
              >
                {/* Active glow ring */}
                {isActive && (
                  <motion.div
                    layoutId="group-glow"
                    className="absolute inset-0 rounded-2xl ring-2 ring-amber-400/40"
                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                  />
                )}
                <span className="relative z-10">{group === 'Todos' ? 'ALL' : group}</span>
              </motion.button>
            )
          })}
        </div>

        {/* Selector de Jornada */}
        <div className="flex gap-2 overflow-x-auto pb-3 scrollbar-hide px-0.5 mt-2">
          {MATCHDAYS.map((md, i) => {
            const isActive = selectedMatchday === md
            return (
              <motion.button
                key={md}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                whileTap={{ scale: 0.9 }}
                onClick={() => setSelectedMatchday(md)}
                className={`relative px-4 py-2 flex-shrink-0 rounded-2xl font-bold text-xs transition-all duration-300 ${
                  isActive
                    ? 'bg-accent text-white shadow-lg shadow-accent/30'
                    : 'glass-strong text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:border-slate-300 dark:hover:border-white/15 bg-white dark:bg-transparent'
                }`}
              >
                {isActive && (
                  <motion.div
                    layoutId="matchday-glow"
                    className="absolute inset-0 rounded-2xl ring-2 ring-accent/40"
                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                  />
                )}
                <span className="relative z-10">
                  {md === 'Todas' ? 'Todas las Jornadas' : `Jornada ${md}`}
                </span>
              </motion.button>
            )
          })}
        </div>

        {/* Active group indicator label */}
        <motion.p
          key={`${selectedGroup}-${selectedMatchday}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-xs text-slate-500 mt-1 px-1"
        >
          {selectedGroup === 'Todos' ? 'Todos los grupos' : `Grupo ${selectedGroup}`} · {filteredMatches.length} {filteredMatches.length === 1 ? 'partido' : 'partidos'}
        </motion.p>
      </div>

      {/* Error */}
      {error && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card p-4 mb-5 border-error/30 text-error text-sm text-center"
        >
          {error}
        </motion.div>
      )}

      {/* Lista de partidos */}
      <AnimatePresence mode="wait">
        <motion.div
          key={selectedGroup}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.2 }}
        >
          {filteredMatches.length === 0 ? (
            <div className="glass-card bg-white dark:bg-transparent p-8 text-center">
              <p className="text-slate-600 dark:text-slate-400 text-sm">No hay partidos para estos filtros</p>
            </div>
          ) : (
            <>
              {selectedGroup !== 'Todos' && <GroupStandings matches={filteredMatches} />}
              <MatchList
                matches={filteredMatches}
                predictions={predictions}
                onSavePrediction={handleSavePrediction}
                isLoading={saving}
                powerupLimits={powerupLimits}
              />
            </>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
