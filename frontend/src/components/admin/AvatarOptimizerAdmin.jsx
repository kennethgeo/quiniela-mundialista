import { useState } from 'react'
import { motion } from 'motion/react'
import { ImageDown, Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'

/**
 * Botón de admin para optimizar (redimensionar/comprimir) los avatares ya
 * subidos. Llama al backend, que con la service key recorre el bucket, reduce
 * cada foto a ~256px webp y actualiza las URLs. Baja el Cached Egress.
 */
export default function AvatarOptimizerAdmin() {
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  const run = async () => {
    if (!confirm('¿Optimizar todos los avatares ya subidos? Reduce el peso de las fotos para bajar el consumo. Es seguro.')) return
    try {
      setRunning(true); setError(null); setResult(null)
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error('Sesión no válida, volvé a iniciar sesión')

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 120000)
      const res = await fetch('/_backend/api/admin/optimize-avatars', {
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
        <ImageDown size={18} className="text-accent" />
        <h3 className="text-base font-bold text-slate-900 dark:text-white">Optimizar avatares</h3>
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
        Reduce el peso de las fotos de perfil ya subidas (a ~256px webp). Baja el
        consumo de Storage (Cached Egress) de Supabase. Las subidas nuevas ya se
        comprimen solas; esto arregla las viejas. Es seguro y se puede repetir.
      </p>

      <button
        onClick={run}
        disabled={running}
        className="flex items-center gap-2 px-4 py-2.5 rounded-xl gradient-2026 text-white font-bold text-sm shadow-sm hover:opacity-95 transition disabled:opacity-50"
      >
        {running ? <Loader2 size={16} className="animate-spin" /> : <ImageDown size={16} />}
        {running ? 'Optimizando…' : 'Optimizar avatares'}
      </button>

      {result && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-4 text-sm text-slate-700 dark:text-slate-300 space-y-1">
          <p>✅ Optimizados: <b>{result.optimized}</b> · Saltados (ya livianos): <b>{result.skipped}</b></p>
          {(result.kb_before > 0 || result.kb_after > 0) && (
            <p className="text-emerald-600 dark:text-emerald-400">
              Peso: {result.kb_before} KB → <b>{result.kb_after} KB</b>
              {result.kb_before > 0 && <> ({Math.max(0, Math.round((1 - result.kb_after / result.kb_before) * 100))}% menos)</>}
            </p>
          )}
          {result.errors?.length > 0 && (
            <p className="text-rose-500 text-xs">Errores: {result.errors.length} ({result.errors.slice(0, 2).join('; ')}{result.errors.length > 2 ? '…' : ''})</p>
          )}
        </motion.div>
      )}
      {error && <p className="mt-4 text-sm text-rose-500">❌ {error}</p>}
    </div>
  )
}
