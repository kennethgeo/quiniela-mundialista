/* Modal para crear una nueva liga */
import { useState } from 'react'
import { motion } from 'motion/react'
import { X, Plus, Shield } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'

export default function CreateLeague({ onClose, onCreated }) {
  const { profile } = useAuth()
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const handleCreate = async (e) => {
    e.preventDefault()
    if (!name.trim() || !profile) return

    try {
      setLoading(true)
      setError(null)
      
      const code = Math.random().toString(36).substring(2, 8).toUpperCase()
      
      const { data: league, error: createError } = await supabase
        .from('leagues')
        .insert({ name: name.trim(), admin_id: profile.id, invitation_code: code })
        .select()
        .single()
        
      if (createError) throw createError
      
      const { error: joinError } = await supabase
        .from('league_members')
        .insert({ league_id: league.id, user_id: profile.id, role: 'admin', points: 0 })
        
      if (joinError) throw joinError
      
      onCreated()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.85, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 25 }}
        className="glass-strong p-6 w-full max-w-sm relative overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Background glow */}
        <div className="absolute -top-10 -right-10 w-32 h-32 bg-purple-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-3">
              <div className="gradient-2026 p-2 rounded-xl shadow-md shadow-purple-500/20">
                <Shield size={18} className="text-slate-950" />
              </div>
              <h2 className="text-lg font-bold text-white">Crear liga</h2>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition-colors">
              <X size={18} />
            </button>
          </div>

          <form onSubmit={handleCreate}>
            <div className="mb-4">
              <label className="text-xs font-medium text-slate-400 mb-2 block">Nombre de la liga</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ej: Los Champions"
                className="w-full px-4 py-3.5 rounded-2xl bg-white/5 border border-white/10 text-white placeholder-slate-600 text-sm focus:outline-none focus:border-accent/50 focus:bg-white/[0.07] transition-all"
                maxLength={50}
                autoFocus
              />
            </div>

            {error && (
              <div className="bg-error/10 border border-error/20 rounded-xl px-3 py-2 mb-4">
                <p className="text-error text-xs">{error}</p>
              </div>
            )}

            <motion.button
              whileTap={{ scale: 0.95 }}
              type="submit"
              disabled={loading || !name.trim()}
              className="w-full py-3.5 rounded-2xl gradient-2026 text-slate-950 font-bold text-sm disabled:opacity-40 flex items-center justify-center gap-2 shadow-lg shadow-purple-500/20 transition-all"
            >
              <Plus size={16} strokeWidth={2.5} /> {loading ? 'Creando...' : 'Crear liga'}
            </motion.button>
          </form>
        </div>
      </motion.div>
    </motion.div>
  )
}
