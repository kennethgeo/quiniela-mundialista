/* Lista de ligas del usuario */
import { useState, useEffect } from 'react'
import { motion } from 'motion/react'
import { Users, Plus, LogIn, Copy, Check, Shield, Sparkles } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import CreateLeague from './CreateLeague'
import JoinLeague from './JoinLeague'
import LoadingSpinner from '../ui/LoadingSpinner'

export default function LeagueList() {
  const { profile } = useAuth()
  const [leagues, setLeagues] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [showJoin, setShowJoin] = useState(false)
  const [copiedCode, setCopiedCode] = useState(null)

  const fetchLeagues = async () => {
    if (!profile) return
    try {
      setLoading(true)
      const { data, error } = await supabase
        .from('league_members')
        .select(`
          leagues (
            id,
            name,
            invitation_code,
            member_count,
            created_at
          )
        `)
        .eq('user_id', profile.id)

      if (error) throw error
      
      const userLeagues = data?.map(d => d.leagues).filter(Boolean) || []
      setLeagues(userLeagues)
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
          whileHover={{ scale: 1.02 }}
          onClick={() => setShowCreate(true)}
          className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-2xl gradient-2026 text-slate-950 font-bold text-sm shadow-lg shadow-purple-500/20 transition-all"
        >
          <Plus size={18} strokeWidth={2.5} /> Crear liga
        </motion.button>
        <motion.button
          whileTap={{ scale: 0.95 }}
          whileHover={{ scale: 1.02 }}
          onClick={() => setShowJoin(true)}
          className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-2xl glass-strong text-slate-200 font-semibold text-sm hover:bg-white/[0.1] transition-all"
        >
          <LogIn size={18} /> Unirse
        </motion.button>
      </div>

      {/* Lista de ligas */}
      {leagues.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="glass-card p-10 text-center"
        >
          <motion.div
            animate={{ y: [0, -6, 0] }}
            transition={{ repeat: Infinity, duration: 3, ease: 'easeInOut' }}
          >
            <Users size={48} className="text-slate-600 mx-auto mb-4" />
          </motion.div>
          <p className="text-slate-300 text-base font-semibold mb-1">No estás en ninguna liga aún</p>
          <p className="text-slate-500 text-sm">Crea una o únete con un código de invitación</p>
        </motion.div>
      ) : (
        <div className="space-y-3">
          {leagues.map((league, i) => (
            <motion.div
              key={league.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06, type: 'spring', stiffness: 200 }}
              className="glass-card p-5 hover:shadow-lg hover:shadow-purple-500/5 transition-all duration-300"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-accent/20 to-accent/5 border border-accent/20 flex items-center justify-center">
                    <Shield size={18} className="text-accent" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">{league.name}</h3>
                    <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1">
                      <Users size={10} />
                      {league.member_count} {league.member_count === 1 ? 'miembro' : 'miembros'}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => copyCode(league.invitation_code)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium transition-all duration-200 ${
                    copiedCode === league.invitation_code
                      ? 'bg-success/15 text-success border border-success/20'
                      : 'bg-white/5 text-slate-400 hover:text-accent hover:bg-accent/10 border border-white/5 hover:border-accent/20'
                  }`}
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
