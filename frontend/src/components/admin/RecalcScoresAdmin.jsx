import { useState } from 'react'
import { motion } from 'motion/react'
import { Calculator, Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'

/**
 * Botón de admin para recalcular los puntos de TODOS los partidos finalizados
 * con las reglas actuales. Necesario tras cambiar una regla de puntaje: los
 * points_earned viejos no se recalculan solos. Lo hace el backend (service role),
 * así actualiza las predicciones de todos. Idempotente.
 */
export default function RecalcScoresAdmin() {
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  const run = async () => {
    if (!confirm('¿Recalcular los puntos de todos los partidos finalizados con las reglas actuales? Es seguro (idempotente).')) return
    try {
      setRunning(true); setError(null); setResult(null)
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error('Sesión no válida, volvé a iniciar sesión')

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 120000)
      const res = await fetch('/_backend/api/admin/recalc-scores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        signal: controller.signal,
      })
      clearTimeout(timer)
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.detail || `Error ${res.status}`)
      setResult(body)
    } catch (err) {
      setError(err.name === 'AbortError' ? 'La operación tardó demasiado (timeout).' : err.message)
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="glass-card p-5">
      <div className="flex items-center gap-2 mb-2">
        <Calculator size={18} className="text-accent" />
        <h3 className="text-base font-bold text-slate-900 dark:text-white">Recalcular puntos</h3>
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
        Reaplica las reglas de puntaje actuales a todos los partidos finalizados.
        Usalo después de cambiar una regla (ej. penales) para actualizar los puntos
        ya cargados. Es seguro y se puede repetir.
      </p>

      <button
        onClick={run}
        disabled={running}
        className="flex items-center gap-2 px-4 py-2.5 rounded-xl gradient-2026 text-white font-bold text-sm shadow-sm hover:opacity-95 transition disabled:opacity-50"
      >
        {running ? <Loader2 size={16} className="animate-spin" /> : <Calculator size={16} />}
        {running ? 'Recalculando…' : 'Recalcular puntos'}
      </button>

      {result && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-4 text-sm text-slate-700 dark:text-slate-300">
          ✅ Recalculados <b>{result.recalculated}</b> de {result.finished} partidos finalizados.
          {result.errors?.length > 0 && <span className="text-rose-500 text-xs block mt-1">Errores: {result.errors.length}</span>}
        </motion.div>
      )}
      {error && <p className="mt-4 text-sm text-rose-500">❌ {error}</p>}
    </div>
  )
}
