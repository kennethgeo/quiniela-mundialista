import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { motion } from 'motion/react'
import { Trophy, Save, Lock, Unlock, Calculator } from 'lucide-react'
import { calculateTournamentPredictions } from '../../lib/scoring'

const TEAMS_2026 = [
  { name: 'Algeria', code: 'dz' },
  { name: 'Argentina', code: 'ar' },
  { name: 'Australia', code: 'au' },
  { name: 'Austria', code: 'at' },
  { name: 'Belgium', code: 'be' },
  { name: 'Bosnia-Herzegovina', code: 'ba' },
  { name: 'Brazil', code: 'br' },
  { name: 'Canada', code: 'ca' },
  { name: 'Cape Verde', code: 'cv' },
  { name: 'Colombia', code: 'co' },
  { name: 'Croatia', code: 'hr' },
  { name: 'Curaçao', code: 'cw' },
  { name: 'Czechia', code: 'cz' },
  { name: 'DR Congo', code: 'cd' },
  { name: 'Ecuador', code: 'ec' },
  { name: 'Egypt', code: 'eg' },
  { name: 'England', code: 'gb-eng' },
  { name: 'France', code: 'fr' },
  { name: 'Germany', code: 'de' },
  { name: 'Ghana', code: 'gh' },
  { name: 'Haiti', code: 'ht' },
  { name: 'Iran', code: 'ir' },
  { name: 'Iraq', code: 'iq' },
  { name: 'Ivory Coast', code: 'ci' },
  { name: 'Japan', code: 'jp' },
  { name: 'Jordan', code: 'jo' },
  { name: 'Mexico', code: 'mx' },
  { name: 'Morocco', code: 'ma' },
  { name: 'Netherlands', code: 'nl' },
  { name: 'New Zealand', code: 'nz' },
  { name: 'Norway', code: 'no' },
  { name: 'Panama', code: 'pa' },
  { name: 'Paraguay', code: 'py' },
  { name: 'Portugal', code: 'pt' },
  { name: 'Qatar', code: 'qa' },
  { name: 'Saudi Arabia', code: 'sa' },
  { name: 'Scotland', code: 'gb-sct' },
  { name: 'Senegal', code: 'sn' },
  { name: 'South Africa', code: 'za' },
  { name: 'South Korea', code: 'kr' },
  { name: 'Spain', code: 'es' },
  { name: 'Sweden', code: 'se' },
  { name: 'Switzerland', code: 'ch' },
  { name: 'Tunisia', code: 'tn' },
  { name: 'Türkiye', code: 'tr' },
  { name: 'Uruguay', code: 'uy' },
  { name: 'USA', code: 'us' },
  { name: 'Uzbekistan', code: 'uz' }
]

export default function TournamentPredictionsAdmin() {
  const [settings, setSettings] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [calculating, setCalculating] = useState(false)
  const [message, setMessage] = useState(null)
  
  const [isLocked, setIsLocked] = useState(false)
  const [champion, setChampion] = useState('')
  const [topScorer, setTopScorer] = useState('')

  useEffect(() => {
    fetchSettings()
  }, [])

  const fetchSettings = async () => {
    try {
      setLoading(true)
      const { data } = await supabase
        .from('tournament_settings')
        .select('*')
        .eq('id', 1)
        .single()
      
      if (data) {
        setSettings(data)
        setIsLocked(data.is_locked)
        setChampion(data.actual_champion || '')
        setTopScorer(data.actual_top_scorer || '')
      }
    } catch (err) {
      console.error('Error fetching tournament settings', err)
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    try {
      setSaving(true)
      const { error } = await supabase
        .from('tournament_settings')
        .update({
          is_locked: isLocked,
          actual_champion: champion,
          actual_top_scorer: topScorer
        })
        .eq('id', 1)

      if (error) throw error
      setMessage({ type: 'success', text: 'Guardado correctamente' })
    } catch (err) {
      console.error(err)
      setMessage({ type: 'error', text: 'Error al guardar' })
    } finally {
      setSaving(false)
      setTimeout(() => setMessage(null), 3000)
    }
  }

  const handleCalculate = async () => {
    if (!confirm('¿Estás seguro de recalcular los puntos de campeón y goleador para todos los usuarios?')) return
    
    try {
      setCalculating(true)
      // Asegurarse de que esté guardado primero
      await handleSave()
      
      const result = await calculateTournamentPredictions()
      if (result.status === 'error') {
        setMessage({ type: 'error', text: result.message })
      } else {
        setMessage({ type: 'success', text: `Cálculo exitoso. Predicciones actualizadas: ${result.updatedPredictions}, Usuarios: ${result.updatedUsers}` })
      }
    } catch (err) {
      console.error(err)
      setMessage({ type: 'error', text: 'Error en el cálculo' })
    } finally {
      setCalculating(false)
      setTimeout(() => setMessage(null), 5000)
    }
  }

  if (loading) return <div className="p-4">Cargando...</div>

  return (
    <div className="relative z-10 glass-card p-5 max-w-3xl mt-6">
      <div className="flex items-center gap-2 mb-6 border-b border-white/10 pb-4">
        <Trophy className="text-amber-500" size={20} />
        <h2 className="text-lg font-bold text-slate-900 dark:text-white">Predicciones Globales (Admin)</h2>
      </div>

      {message && (
        <motion.div 
          initial={{ opacity: 0, y: -10 }} 
          animate={{ opacity: 1, y: 0 }}
          className={`p-3 rounded-xl mb-6 text-sm font-semibold flex items-center gap-2 ${
            message.type === 'success' ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400' : 'bg-rose-500/20 text-rose-600 dark:text-rose-400'
          }`}
        >
          {message.text}
        </motion.div>
      )}

      <div className="space-y-6">
        {/* Bloqueo */}
        <div className="flex items-center justify-between bg-slate-50 dark:bg-white/5 p-4 rounded-xl border border-slate-200 dark:border-white/10">
          <div>
            <h3 className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
              {isLocked ? <Lock size={16} className="text-rose-500" /> : <Unlock size={16} className="text-emerald-500" />}
              Bloquear Predicciones
            </h3>
            <p className="text-xs text-slate-500 mt-1">Si se bloquea, los usuarios no podrán modificar a su campeón y goleador, y podrán ver las predicciones de los demás.</p>
          </div>
          <button
            onClick={() => setIsLocked(!isLocked)}
            className={`px-4 py-2 rounded-lg font-bold text-sm transition-colors ${
              isLocked 
                ? 'bg-rose-500/20 text-rose-600 dark:text-rose-400 hover:bg-rose-500/30'
                : 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/30'
            }`}
          >
            {isLocked ? 'Desbloquear' : 'Bloquear'}
          </button>
        </div>

        {/* Resultados Reales */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-slate-500 uppercase">Campeón Real</label>
            <select
              value={champion}
              onChange={(e) => setChampion(e.target.value)}
              className="w-full bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white"
            >
              <option value="">(No definido)</option>
              {TEAMS_2026.map(t => (
                <option key={t.name} value={t.name}>{t.name}</option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-semibold text-slate-500 uppercase">Goleador Real</label>
            <input
              type="text"
              value={topScorer}
              onChange={(e) => setTopScorer(e.target.value)}
              className="w-full bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white"
              placeholder="(No definido)"
            />
          </div>
        </div>

        {/* Acciones */}
        <div className="pt-4 flex justify-end gap-3 border-t border-white/5">
          <button 
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 bg-slate-200 hover:bg-slate-300 dark:bg-white/10 dark:hover:bg-white/20 text-slate-900 dark:text-white font-bold px-6 py-3 rounded-xl transition-all"
          >
            <Save size={18} />
            {saving ? 'Guardando...' : 'Guardar'}
          </button>

          <button 
            onClick={handleCalculate}
            disabled={calculating || (!champion && !topScorer)}
            className="flex items-center gap-2 bg-accent hover:bg-accent-light text-white font-bold px-6 py-3 rounded-xl transition-all shadow-lg shadow-accent/20 disabled:opacity-50"
          >
            <Calculator size={18} />
            {calculating ? 'Calculando...' : 'Calcular Puntos'}
          </button>
        </div>
      </div>
    </div>
  )
}
