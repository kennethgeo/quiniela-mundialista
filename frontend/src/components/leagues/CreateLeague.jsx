/* Modal para crear una nueva liga */
import { useState } from 'react'
import { motion } from 'motion/react'
import { X, Plus } from 'lucide-react'
import { api } from '../../lib/api'

export default function CreateLeague({ onClose, onCreated }) {
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const handleCreate = async (e) => {
    e.preventDefault()
    if (!name.trim()) return

    try {
      setLoading(true)
      setError(null)
      await api.post('/api/leagues', { name: name.trim() })
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
          <h2 className="text-lg font-bold text-white">Crear liga</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleCreate}>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nombre de la liga"
            className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-accent/50 mb-4"
            maxLength={50}
            autoFocus
          />

          {error && (
            <p className="text-error text-xs mb-3">{error}</p>
          )}

          <motion.button
            whileTap={{ scale: 0.95 }}
            type="submit"
            disabled={loading || !name.trim()}
            className="w-full py-3 rounded-xl bg-accent text-primary font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <Plus size={16} /> {loading ? 'Creando...' : 'Crear liga'}
          </motion.button>
        </form>
      </motion.div>
    </motion.div>
  )
}
