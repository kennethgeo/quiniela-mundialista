/* Modal para unirse a una liga con código de invitación */
import { useState } from 'react'
import { motion } from 'motion/react'
import { X, LogIn, Ticket } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'

export default function JoinLeague({ onClose, onJoined }) {
  const { profile } = useAuth()
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const handleJoin = async (e) => {
    e.preventDefault()
    if (!code.trim() || !profile) return

    try {
      setLoading(true)
      setError(null)
      
      const cleanCode = code.trim().toUpperCase()
      
      const { data: league, error: findError } = await supabase
        .from('leagues')
        .select('id, member_count')
        .eq('invitation_code', cleanCode)
        .single()
        
      if (findError || !league) throw new Error('Código de liga no válido')
      
      const { error: joinError } = await supabase
        .from('league_members')
        .insert({ league_id: league.id, user_id: profile.id, role: 'member', points: 0 })
        
      if (joinError) throw new Error('Ya eres miembro o hubo un error')
      
      // Intentar actualizar conteo (si falla por RLS no importa, podría actualizarse con triggers)
      await supabase.from('leagues').update({ member_count: league.member_count + 1 }).eq('id', league.id)
      
      onJoined()
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
        <div className="absolute -top-10 -left-10 w-32 h-32 bg-purple-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-3">
              <div className="gradient-2026 p-2 rounded-xl shadow-md shadow-purple-500/20">
                <Ticket size={18} className="text-slate-950" />
              </div>
              <h2 className="text-lg font-bold text-white">Unirse a liga</h2>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition-colors">
              <X size={18} />
            </button>
          </div>

          <form onSubmit={handleJoin}>
            <div className="mb-2">
              <label className="text-xs font-medium text-slate-400 mb-2 block text-center">Código de invitación</label>
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="ABCDEF"
                className="w-full px-4 py-4 rounded-2xl bg-white/5 border border-white/10 text-white placeholder-slate-600 text-lg text-center font-mono tracking-[0.35em] uppercase focus:outline-none focus:border-accent/50 focus:bg-white/[0.07] transition-all"
                maxLength={6}
                autoFocus
              />
            </div>
            <p className="text-xs text-slate-500 text-center mb-5">
              Pide el código de 6 caracteres al creador de la liga
            </p>

            {error && (
              <div className="bg-error/10 border border-error/20 rounded-xl px-3 py-2 mb-4">
                <p className="text-error text-xs text-center">{error}</p>
              </div>
            )}

            <motion.button
              whileTap={{ scale: 0.95 }}
              type="submit"
              disabled={loading || code.length < 6}
              className="w-full py-3.5 rounded-2xl gradient-2026 text-slate-950 font-bold text-sm disabled:opacity-40 flex items-center justify-center gap-2 shadow-lg shadow-purple-500/20 transition-all"
            >
              <LogIn size={16} /> {loading ? 'Uniéndose...' : 'Unirse'}
            </motion.button>
          </form>
        </div>
      </motion.div>
    </motion.div>
  )
}
