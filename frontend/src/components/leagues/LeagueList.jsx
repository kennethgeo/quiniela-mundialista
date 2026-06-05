/* Lista de ligas del usuario */
import { useState, useEffect } from 'react'
import { motion } from 'motion/react'
import { Users, Plus, LogIn, Copy, Check } from 'lucide-react'
import { api } from '../../lib/api'
import CreateLeague from './CreateLeague'
import JoinLeague from './JoinLeague'
import LoadingSpinner from '../ui/LoadingSpinner'

export default function LeagueList() {
  const [leagues, setLeagues] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [showJoin, setShowJoin] = useState(false)
  const [copiedCode, setCopiedCode] = useState(null)

  const fetchLeagues = async () => {
    try {
      setLoading(true)
      const data = await api.get('/api/leagues/mine')
      setLeagues(data)
    } catch (err) {
      console.error('Error cargando ligas:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchLeagues() }, [])

  const copyCode = async (code) => {
    await navigator.clipboard.writeText(code)
    setCopiedCode(code)
    setTimeout(() => setCopiedCode(null), 2000)
  }

  if (loading) return <LoadingSpinner />

  return (
    <div>
      {/* Botones de acción */}
      <div className="flex gap-3 mb-6">
        <motion.button
          whileTap={{ scale: 0.95 }}
          onClick={() => setShowCreate(true)}
          className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-accent/20 text-accent font-semibold text-sm border border-accent/30 hover:bg-accent/30 transition-colors"
        >
          <Plus size={18} /> Crear liga
        </motion.button>
        <motion.button
          whileTap={{ scale: 0.95 }}
          onClick={() => setShowJoin(true)}
          className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl glass text-slate-300 font-semibold text-sm hover:bg-white/[0.08] transition-colors"
        >
          <LogIn size={18} /> Unirse
        </motion.button>
      </div>

      {/* Lista de ligas */}
      {leagues.length === 0 ? (
        <div className="glass p-8 text-center">
          <Users size={40} className="text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400 text-sm">No estás en ninguna liga aún</p>
          <p className="text-slate-500 text-xs mt-1">Crea una o únete con un código de invitación</p>
        </div>
      ) : (
        <div className="space-y-3">
          {leagues.map((league, i) => (
            <motion.div
              key={league.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="glass p-4"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-slate-200">{league.name}</h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {league.member_count} {league.member_count === 1 ? 'miembro' : 'miembros'}
                  </p>
                </div>
                <button
                  onClick={() => copyCode(league.invitation_code)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 text-xs text-slate-400 hover:text-accent transition-colors"
                >
                  {copiedCode === league.invitation_code ? (
                    <><Check size={12} /> Copiado</>
                  ) : (
                    <><Copy size={12} /> {league.invitation_code}</>
                  )}
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Modales */}
      {showCreate && (
        <CreateLeague
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); fetchLeagues() }}
        />
      )}
      {showJoin && (
        <JoinLeague
          onClose={() => setShowJoin(false)}
          onJoined={() => { setShowJoin(false); fetchLeagues() }}
        />
      )}
    </div>
  )
}
