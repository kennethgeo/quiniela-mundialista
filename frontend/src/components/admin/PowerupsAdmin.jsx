import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { motion } from 'motion/react'
import { Save, Zap, AlertCircle } from 'lucide-react'

export default function PowerupsAdmin() {
  const [limits, setLimits] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null)

  useEffect(() => {
    fetchLimits()
  }, [])

  const fetchLimits = async () => {
    try {
      setLoading(true)
      const { data, error } = await supabase
        .from('powerup_limits')
        .select('*')
        .order('phase_label')
      
      if (error) throw error
      setLimits(data || [])
    } catch (err) {
      console.error('Error fetching limits:', err)
      setMessage({ type: 'error', text: 'Error al cargar límites: ' + err.message })
    } finally {
      setLoading(false)
    }
  }

  const handleLimitChange = (id, newLimit) => {
    setLimits(prev => prev.map(limit => 
      limit.id === id ? { ...limit, max_uses: parseInt(newLimit) || 0 } : limit
    ))
  }

  const handleSave = async (e) => {
    e.preventDefault()
    setSaving(true)
    setMessage(null)
    
    try {
      // Upsert all limits
      for (const limit of limits) {
        const { error } = await supabase
          .from('powerup_limits')
          .update({ max_uses: limit.max_uses, updated_at: new Date().toISOString() })
          .eq('id', limit.id)

        if (error) throw error
      }
      
      setMessage({ type: 'success', text: 'Límites de comodines actualizados correctamente.' })
    } catch (err) {
      console.error('Error saving limits:', err)
      setMessage({ type: 'error', text: 'Error al guardar: ' + err.message })
    } finally {
      setSaving(false)
      setTimeout(() => setMessage(null), 3000)
    }
  }

  if (loading) {
    return <div className="p-4 text-center text-slate-500">Cargando límites...</div>
  }

  return (
    <div className="relative z-10 glass-card p-5 max-w-3xl">
      <div className="flex items-center gap-2 mb-6 border-b border-white/10 pb-4">
        <Zap className="text-accent" size={20} />
        <h2 className="text-lg font-bold text-slate-900 dark:text-white">Límites de Comodines x2</h2>
      </div>

      {message && (
        <motion.div 
          initial={{ opacity: 0, y: -10 }} 
          animate={{ opacity: 1, y: 0 }}
          className={`p-3 rounded-xl mb-6 text-sm font-semibold flex items-center gap-2 ${
            message.type === 'success' ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30' : 'bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-500/30'
          }`}
        >
          <AlertCircle size={16} />
          {message.text}
        </motion.div>
      )}

      <form onSubmit={handleSave} className="space-y-6">
        <div className="bg-white/5 dark:bg-black/20 rounded-2xl border border-white/10 overflow-hidden">
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-slate-400 uppercase text-xs">
              <tr>
                <th className="px-4 py-3 font-bold">Fase (Jornada)</th>
                <th className="px-4 py-3 font-bold">Límite de Usos</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-white/5">
              {limits.map((limit) => (
                <tr key={limit.id} className="hover:bg-slate-50 dark:hover:bg-white/5 transition-colors">
                  <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">
                    {limit.phase_label}
                  </td>
                  <td className="px-4 py-3">
                    <input
                      type="number"
                      min="0"
                      max="16"
                      value={limit.max_uses}
                      onChange={(e) => handleLimitChange(limit.id, e.target.value)}
                      className="w-24 bg-white dark:bg-slate-900 border border-slate-300 dark:border-white/10 rounded-lg px-3 py-1.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-accent"
                    />
                  </td>
                </tr>
              ))}
              {limits.length === 0 && (
                <tr>
                  <td colSpan="2" className="px-4 py-4 text-center text-slate-500">
                    No se encontraron fases en la base de datos.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="pt-4 flex justify-end">
          <button 
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 bg-accent hover:bg-accent-light text-slate-950 font-bold px-6 py-3 rounded-xl transition-all shadow-lg shadow-accent/20 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Save size={18} />
            {saving ? 'Guardando...' : 'Guardar Límites'}
          </button>
        </div>
      </form>
    </div>
  )
}
