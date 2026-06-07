/* Vista de fase de grupos con filtro por grupo */
import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import MatchList from './MatchList'
import LoadingSpinner from '../ui/LoadingSpinner'
import GroupStandings from './GroupStandings'

const GROUPS = ['A','B','C','D','E','F','G','H','I','J','K','L']

export default function GroupStage() {
  const { profile } = useAuth()
  const [selectedGroup, setSelectedGroup] = useState('A')
  const [matches, setMatches] = useState([])
  const [predictions, setPredictions] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  // Cargar partidos de fase de grupos
  useEffect(() => {
    const fetchData = async () => {
      if (!profile) return
      try {
        setLoading(true)
        const [matchesRes, predsRes] = await Promise.all([
          supabase.from('matches').select('*').eq('phase', 'groups').order('kickoff_at', { ascending: true }),
          supabase.from('predictions').select('*').eq('user_id', profile.id)
        ])
        
        if (matchesRes.error) throw matchesRes.error
        if (predsRes.error) throw predsRes.error
        
        setMatches(matchesRes.data || [])
        setPredictions(predsRes.data || [])
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [profile])

  // Asegurar orden cronologico estricto en el cliente
  const sortedMatches = [...matches].sort((a, b) => new Date(a.kickoff_at) - new Date(b.kickoff_at))

  // Filtrar partidos por grupo seleccionado
  const filteredMatches = sortedMatches.filter(m => m.group_name === selectedGroup)

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
                <span className="relative z-10">{group}</span>
              </motion.button>
            )
          })}
        </div>

        {/* Active group indicator label */}
        <motion.p
          key={selectedGroup}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-xs text-slate-500 mt-1 px-1"
        >
          Grupo {selectedGroup} · {filteredMatches.length} {filteredMatches.length === 1 ? 'partido' : 'partidos'}
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
              <p className="text-slate-600 dark:text-slate-400 text-sm">No hay partidos en este grupo aún</p>
            </div>
          ) : (
            <>
              <GroupStandings matches={filteredMatches} />
              <MatchList
                matches={filteredMatches}
                predictions={predictions}
                onSavePrediction={handleSavePrediction}
                isLoading={saving}
              />
            </>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
