/* Admin: reconciliar el total de puntos con la suma real (sin tocar predicciones) */
import { useState } from 'react'
import { Scale, Search, Wrench, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react'
import { reconcileTotals } from '../../lib/scoring'

export default function ScoreReconcileAdmin() {
  const [loading, setLoading] = useState(false)
  const [report, setReport] = useState(null) // { discrepancies, usersChecked }
  const [message, setMessage] = useState(null) // { type, text }

  const review = async () => {
    setLoading(true)
    setMessage(null)
    const res = await reconcileTotals({ apply: false })
    setLoading(false)
    if (res.status === 'error') {
      setMessage({ type: 'error', text: res.message })
      return
    }
    setReport(res)
    if (res.discrepancies.length === 0) {
      setMessage({ type: 'ok', text: `Todo cuadra ✅ (${res.usersChecked} usuarios revisados).` })
    } else {
      setMessage({ type: 'warn', text: `${res.discrepancies.length} usuario(s) descuadrado(s) de ${res.usersChecked}.` })
    }
  }

  const fix = async () => {
    if (!confirm('Esto corregirá el total de puntos de los usuarios descuadrados para que coincida con la suma real. No modifica predicciones ni los puntos por partido. ¿Continuar?')) return
    setLoading(true)
    setMessage(null)
    const res = await reconcileTotals({ apply: true })
    setLoading(false)
    if (res.status === 'error') {
      setMessage({ type: 'error', text: res.message })
      return
    }
    setReport({ ...res, discrepancies: [] })
    setMessage({ type: 'ok', text: `Corregidos ${res.applied} usuario(s). Totales sincronizados.` })
  }

  const msgStyle = {
    ok: 'text-emerald-500',
    warn: 'text-amber-500',
    error: 'text-rose-500',
  }

  return (
    <div className="glass-card p-5 mt-6">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-9 h-9 rounded-xl bg-accent/15 flex items-center justify-center">
          <Scale size={18} className="text-accent" />
        </div>
        <div>
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">Reconciliar puntos</h3>
          <p className="text-[11px] text-slate-500">Corrige el total si no cuadra con la suma real. No toca predicciones.</p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2 mt-4">
        <button
          onClick={review}
          disabled={loading}
          className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 bg-slate-100 dark:bg-white/5 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-white/10 transition-colors disabled:opacity-50"
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
          Revisar descuadre
        </button>
        <button
          onClick={fix}
          disabled={loading || !report || report.discrepancies.length === 0}
          className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 gradient-2026 text-white transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Wrench size={16} />
          {report?.discrepancies?.length ? `Corregir totales (${report.discrepancies.length})` : 'Corregir totales'}
        </button>
      </div>

      {message && (
        <div className={`mt-4 flex items-center gap-2 text-xs font-semibold ${msgStyle[message.type]}`}>
          {message.type === 'ok' ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
          {message.text}
        </div>
      )}

      {report && report.discrepancies.length > 0 && (
        <div className="mt-4 border-t border-slate-200 dark:border-white/10 pt-3 space-y-1.5 max-h-72 overflow-y-auto">
          {report.discrepancies.map((d) => (
            <div key={d.user_id} className="flex items-center justify-between text-xs">
              <span className="text-slate-700 dark:text-slate-300 truncate mr-2">{d.display_name || d.user_id}</span>
              <span className="tabular-nums shrink-0 text-slate-500">
                {d.stored} <span className="text-slate-400">→</span>{' '}
                <span className="font-bold text-slate-900 dark:text-white">{d.computed}</span>{' '}
                <span className={d.diff > 0 ? 'text-emerald-500' : 'text-rose-500'}>
                  ({d.diff > 0 ? '+' : ''}{d.diff})
                </span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
