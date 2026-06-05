/* Vista de fase de grupos con filtro por grupo */
import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { api } from '../../lib/api'
import MatchList from './MatchList'
import LoadingSpinner from '../ui/LoadingSpinner'

const GROUPS = ['A','B','C','D','E','F','G','H','I','J','K','L']

export default function GroupStage() {
  const [selectedGroup, setSelectedGroup] = useState('A')
  const [matches, setMatches] = useState([])
  const [predictions, setPredictions] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  // Cargar partidos de fase de grupos
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true)
        const [matchesData, predsData] = await Promise.all([
          api.get('/api/matches?phase=groups'),
          api.get('/api/predictions/mine')
        ])
        setMatches(matchesData)
        setPredictions(predsData)
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [])

  // Filtrar partidos por grupo seleccionado
  const filteredMatches = matches.filter(m => m.group_name === selectedGroup)

  // Guardar predicción
  const handleSavePrediction = async (prediction) => {
    try {
      setSaving(true)
      const result = await api.post('/api/predictions', prediction)
      // Actualizar predicciones locales
      setPredictions(prev => {
        const existing = prev.findIndex(p => p.match_id === prediction.match_id)
        if (existing >= 0) {
          const updated = [...prev]
          updated[existing] = { ...updated[existing], ...prediction }
          return updated
        }
        return [...prev, result.data?.[0] || prediction]
      })
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <LoadingSpinner />

  return (
    <div>
      {/* Selector de grupo */}
      <div className="flex gap-1.5 overflow-x-auto pb-3 mb-4 scrollbar-hide">
        {GROUPS.map(group => (
          <motion.button
            key={group}
            whileTap={{ scale: 0.92 }}
            onClick={() => setSelectedGroup(group)}
            className={`flex-shrink-0 w-10 h-10 rounded-xl font-bold text-sm transition-all ${
              selectedGroup === group
                ? 'bg-accent text-primary shadow-lg shadow-accent/30'
                : 'glass text-slate-400 hover:text-slate-200'
            }`}
          >
            {group}
          </motion.button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="glass p-3 mb-4 border-error/30 text-error text-sm text-center">
          {error}
        </div>
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
          <MatchList
            matches={filteredMatches}
            predictions={predictions}
            onSavePrediction={handleSavePrediction}
            isLoading={saving}
          />
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
