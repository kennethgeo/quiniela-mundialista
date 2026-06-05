/* Modal para unirse a una liga con código de invitación */
import { useState } from 'react'
import { motion } from 'motion/react'
import { X, LogIn } from 'lucide-react'
import { api } from '../../lib/api'

export default function JoinLeague({ onClose, onJoined }) {
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const handleJoin = async (e) => {
    e.preventDefault()
    if (!code.trim()) return

    try {
      setLoading(true)
      setError(null)
      await api.post('/api/leagues/join', { invitation_code: code.trim().toUpperCase() })
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
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="glass-strong p-6 w-full max-w-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-white">Unirse a liga</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleJoin}>
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="Código de invitación"
            className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-slate-500 text-sm text-center font-mono tracking-[0.3em] uppercase focus:outline-none focus:border-accent/50 mb-2"
            maxLength={6}
            autoFocus
          />
          <p className="text-xs text-slate-500 text-center mb-4">
            Pide el código de 6 caracteres al creador de la liga
          </p>

          {error && (
            <p className="text-error text-xs mb-3 text-center">{error}</p>
          )}

          <motion.button
            whileTap={{ scale: 0.95 }}
            type="submit"
            disabled={loading || code.length < 6}
            className="w-full py-3 rounded-xl bg-accent text-primary font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <LogIn size={16} /> {loading ? 'Uniéndose...' : 'Unirse'}
          </motion.button>
        </form>
      </motion.div>
    </motion.div>
  )
}
