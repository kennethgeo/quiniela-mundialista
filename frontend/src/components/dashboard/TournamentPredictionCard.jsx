import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Trophy, Target, Check, AlertCircle, Lock } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { getTournamentLocked } from '../../lib/tournamentLock'
import { useAuth } from '../../hooks/useAuth'

// Lista de los 48 equipos de 2026 para el select
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

export default function TournamentPredictionCard() {
  const { profile } = useAuth()
  const [prediction, setPrediction] = useState(null)
  const [isLocked, setIsLocked] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  const [championTeam, setChampionTeam] = useState('')
  const [topScorer, setTopScorer] = useState('')

  useEffect(() => {
    if (!profile) return

    const fetchData = async () => {
      try {
        // Bloqueo: manual (admin) o automático al iniciar el primer partido
        setIsLocked(await getTournamentLocked())

        // Fetch user prediction
        const { data: pred } = await supabase
          .from('tournament_predictions')
          .select('*')
          .eq('user_id', profile.id)
          .maybeSingle()

        if (pred) {
          setPrediction(pred)
          setChampionTeam(pred.champion_team || '')
          setTopScorer(pred.top_scorer_name || '')
        }
      } catch (err) {
        console.error('Error fetching global predictions:', err)
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [profile])

  const handleSave = async () => {
    if (!profile || isLocked) return
    setSaving(true)
    setMessage('')

    try {
      if (prediction) {
        // Update
        const { error } = await supabase
          .from('tournament_predictions')
          .update({
            champion_team: championTeam,
            top_scorer_name: topScorer
          })
          .eq('id', prediction.id)
        if (error) throw error
      } else {
        // Insert
        const { data, error } = await supabase
          .from('tournament_predictions')
          .insert({
            user_id: profile.id,
            champion_team: championTeam,
            top_scorer_name: topScorer
          })
          .select()
          .single()
        if (error) throw error
        setPrediction(data)
      }
      
      setMessage('Predicción guardada exitosamente')
      setTimeout(() => setMessage(''), 3000)
    } catch (err) {
      console.error('Error saving:', err)
      setMessage('Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="glass-card p-6 animate-pulse">
        <div className="h-6 w-48 bg-slate-200 dark:bg-white/10 rounded mb-4" />
        <div className="h-10 bg-slate-200 dark:bg-white/10 rounded mb-4" />
        <div className="h-10 bg-slate-200 dark:bg-white/10 rounded" />
      </div>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card p-5 relative overflow-hidden"
    >
      <div className="absolute top-0 right-0 p-4 opacity-10 pointer-events-none">
        <Trophy size={100} />
      </div>

      <div className="relative z-10">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-gold">
            <Trophy size={20} />
            <h3 className="font-bold text-slate-900 dark:text-white">Predicción Global</h3>
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-accent/10 text-accent text-xs font-bold border border-accent/20">
            <span>12 pts c/u</span>
          </div>
        </div>

        {isLocked && (
          <div className="mb-4 p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl flex items-start gap-3">
            <Lock size={16} className="text-amber-500 mt-0.5 shrink-0" />
            <p className="text-xs text-amber-600 dark:text-amber-400">
              El torneo ya comenzó. Las predicciones globales están bloqueadas.
            </p>
          </div>
        )}

        <div className="space-y-4">
          {/* Campeón */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5 uppercase tracking-wider">
              Equipo Campeón
            </label>
            <div className="relative">
              <select
                value={championTeam}
                onChange={(e) => setChampionTeam(e.target.value)}
                disabled={isLocked || saving}
                className="w-full h-12 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl px-4 appearance-none focus:outline-none focus:ring-2 focus:ring-accent/50 text-slate-900 dark:text-white disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <option value="">Selecciona un equipo...</option>
                {TEAMS_2026.map(t => (
                  <option key={t.name} value={t.name}>{t.name}</option>
                ))}
              </select>
              {championTeam && (
                <div className="absolute right-10 top-1/2 -translate-y-1/2 pointer-events-none">
                  <img 
                    src={`https://flagcdn.com/w40/${TEAMS_2026.find(t => t.name === championTeam)?.code || 'xx'}.png`}
                    alt={championTeam}
                    className="w-6 h-4 rounded-sm object-cover shadow-sm"
                  />
                </div>
              )}
            </div>
          </div>

          {/* Goleador */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5 uppercase tracking-wider">
              Jugador Goleador (Bota de Oro)
            </label>
            <div className="relative">
              <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">
                <Target size={18} />
              </div>
              <input
                type="text"
                value={topScorer}
                onChange={(e) => setTopScorer(e.target.value)}
                disabled={isLocked || saving}
                placeholder="Ej. Kylian Mbappé"
                className="w-full h-12 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl pl-11 pr-4 focus:outline-none focus:ring-2 focus:ring-accent/50 text-slate-900 dark:text-white disabled:opacity-60 disabled:cursor-not-allowed"
              />
            </div>
          </div>

          {/* Guardar */}
          <AnimatePresence>
            {!isLocked && (championTeam !== (prediction?.champion_team || '') || topScorer !== (prediction?.top_scorer_name || '')) && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="pt-2"
              >
                <button
                  onClick={handleSave}
                  disabled={saving || (!championTeam && !topScorer)}
                  className="w-full h-12 rounded-xl bg-accent hover:bg-accent-light text-white font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg shadow-accent/20"
                >
                  {saving ? (
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <>
                      <Check size={18} />
                      Guardar Predicción
                    </>
                  )}
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Message */}
          <AnimatePresence>
            {message && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="mt-3 text-center text-sm font-medium text-success"
              >
                {message}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  )
}
