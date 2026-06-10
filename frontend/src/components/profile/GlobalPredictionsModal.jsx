import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { X, Save, Trophy, Target } from 'lucide-react'
import { supabase } from '../../lib/supabase'

const TEAMS_2026 = [
  { name: 'Argentina', code: 'ar' }, { name: 'Algeria', code: 'dz' }, { name: 'Australia', code: 'au' },
  { name: 'Austria', code: 'at' }, { name: 'Belgium', code: 'be' }, { name: 'Bosnia-Herzegovina', code: 'ba' },
  { name: 'Brazil', code: 'br' }, { name: 'Canada', code: 'ca' }, { name: 'Cape Verde', code: 'cv' },
  { name: 'Colombia', code: 'co' }, { name: 'Costa Rica', code: 'cr' }, { name: 'Croatia', code: 'hr' },
  { name: 'Curaçao', code: 'cw' }, { name: 'Czechia', code: 'cz' }, { name: 'Denmark', code: 'dk' },
  { name: 'DR Congo', code: 'cd' }, { name: 'Ecuador', code: 'ec' }, { name: 'Egypt', code: 'eg' },
  { name: 'England', code: 'gb-eng' }, { name: 'France', code: 'fr' }, { name: 'Germany', code: 'de' },
  { name: 'Ghana', code: 'gh' }, { name: 'Haiti', code: 'ht' }, { name: 'Iran', code: 'ir' },
  { name: 'Iraq', code: 'iq' }, { name: 'Italy', code: 'it' }, { name: 'Ivory Coast', code: 'ci' },
  { name: 'Japan', code: 'jp' }, { name: 'Jordan', code: 'jo' }, { name: 'Mexico', code: 'mx' },
  { name: 'Morocco', code: 'ma' }, { name: 'Netherlands', code: 'nl' }, { name: 'New Zealand', code: 'nz' },
  { name: 'Nigeria', code: 'ng' }, { name: 'Norway', code: 'no' }, { name: 'Panama', code: 'pa' },
  { name: 'Paraguay', code: 'py' }, { name: 'Peru', code: 'pe' }, { name: 'Portugal', code: 'pt' },
  { name: 'Qatar', code: 'qa' }, { name: 'Saudi Arabia', code: 'sa' }, { name: 'Senegal', code: 'sn' },
  { name: 'South Africa', code: 'za' }, { name: 'South Korea', code: 'kr' }, { name: 'Spain', code: 'es' },
  { name: 'Sweden', code: 'se' }, { name: 'Switzerland', code: 'ch' }, { name: 'Tunisia', code: 'tn' },
  { name: 'Türkiye', code: 'tr' }, { name: 'USA', code: 'us' }, { name: 'Uruguay', code: 'uy' },
  { name: 'Uzbekistan', code: 'uz' }
].sort((a, b) => a.name.localeCompare(b.name))

export default function GlobalPredictionsModal({ isOpen, onClose, initialData, userId, onSaved }) {
  const [champion, setChampion] = useState('')
  const [topScorer, setTopScorer] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (isOpen) {
      setChampion(initialData?.champion_team || '')
      setTopScorer(initialData?.top_scorer_name || '')
    }
  }, [isOpen, initialData])

  const handleSave = async () => {
    if (!champion && !topScorer) return
    
    try {
      setSaving(true)
      const { error } = await supabase
        .from('tournament_predictions')
        .upsert({
          user_id: userId,
          champion_team: champion,
          top_scorer_name: topScorer
        }, { onConflict: 'user_id' })

      if (error) throw error
      onSaved()
      onClose()
    } catch (err) {
      console.error('Error al guardar predicciones:', err)
      alert('Error guardando: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  if (!isOpen) return null

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
          onClick={onClose}
        />
        <motion.div 
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="relative w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl shadow-2xl overflow-hidden border border-slate-200 dark:border-white/10"
        >
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-white/5">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Trophy size={18} className="text-amber-500" />
              Editar Predicciones
            </h2>
            <button onClick={onClose} className="p-2 -mr-2 text-slate-400 hover:text-slate-600 dark:hover:text-white rounded-full transition-colors">
              <X size={20} />
            </button>
          </div>

          <div className="p-6 space-y-6">
            <div className="space-y-3">
              <label className="block text-sm font-bold text-slate-700 dark:text-slate-300">Equipo Campeón</label>
              <select
                value={champion}
                onChange={(e) => setChampion(e.target.value)}
                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-white/10 rounded-xl px-4 py-3 text-sm font-semibold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-accent/50 transition-shadow"
              >
                <option value="">(Selecciona un equipo)</option>
                {TEAMS_2026.map(t => (
                  <option key={t.name} value={t.name}>{t.name}</option>
                ))}
              </select>
              <p className="text-[11px] text-slate-500">¿Qué país levantará la copa? (Vale 12 pts)</p>
            </div>

            <div className="space-y-3">
              <label className="block text-sm font-bold text-slate-700 dark:text-slate-300">Goleador del Torneo</label>
              <div className="relative">
                <Target size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Ej: Kylian Mbappé"
                  value={topScorer}
                  onChange={(e) => setTopScorer(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-white/10 rounded-xl pl-11 pr-4 py-3 text-sm font-semibold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-accent/50 transition-shadow placeholder:font-normal"
                />
              </div>
              <p className="text-[11px] text-slate-500">Asegúrate de escribir el nombre completo. (Vale 12 pts)</p>
            </div>

            <button
              onClick={handleSave}
              disabled={saving}
              className="w-full py-3.5 bg-accent hover:bg-accent-light text-white font-bold rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <Save size={18} />
              {saving ? 'Guardando...' : 'Guardar Predicciones'}
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  )
}
