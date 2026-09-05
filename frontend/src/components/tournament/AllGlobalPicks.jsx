// Predicciones de campeón/goleador/asistidor de TODOS los miembros de la
// quiniela — solo una vez que las predicciones del torneo están bloqueadas
// (mismo criterio que GlobalPicksBoard), para que nadie copie antes de tiempo.
import { useConsultaDelUsuario } from '../../hooks/useConsultaDelUsuario'
import { motion } from 'motion/react'
import { Users, Crown, Target, Handshake } from 'lucide-react'
import { supabase } from '../../lib/supabase'

const AVATAR_GRADIENTS = [
  'from-violet-500 to-purple-600', 'from-sky-500 to-blue-600',
  'from-emerald-500 to-teal-600', 'from-amber-500 to-orange-600',
  'from-rose-500 to-pink-600', 'from-cyan-500 to-sky-600',
  'from-fuchsia-500 to-purple-600', 'from-lime-500 to-green-600',
]
function gradientFor(name = '') {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return AVATAR_GRADIENTS[h % AVATAR_GRADIENTS.length]
}

export default function AllGlobalPicks({ tournamentId, leagueId }) {
  const { data, isLoading } = useConsultaDelUsuario({
    queryKey: ['all_global_picks', leagueId],
    enabled: !!tournamentId && !!leagueId,
    queryFn: async () => {
      const { data: t } = await supabase.from('tournaments').select('predictions_locked').eq('id', tournamentId).single()
      if (!t?.predictions_locked) return { locked: false, rows: [] }
      const [{ data: preds }, { data: users }] = await Promise.all([
        supabase.from('tournament_predictions').select('*').eq('league_id', leagueId),
        supabase.from('users').select('id, display_name'),
      ])
      const nameById = {}
      ;(users || []).forEach((u) => { nameById[u.id] = u.display_name })
      const rows = (preds || [])
        .filter((p) => p.champion_team || p.top_scorer_name || p.top_assist_name)
        .filter((p) => Object.prototype.hasOwnProperty.call(nameById, p.user_id))
        .map((p) => ({ ...p, display_name: nameById[p.user_id] || 'Jugador' }))
        .sort((a, b) => (a.display_name || '').localeCompare(b.display_name || ''))
      return { locked: true, rows }
    },
  })

  if (isLoading || !data?.locked || data.rows.length === 0) return null

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-5 mt-4">
      <div className="flex items-center gap-2 mb-4">
        <Users size={18} className="text-accent" />
        <h3 className="font-bold text-slate-900 dark:text-white">Predicciones de la quiniela</h3>
        <span className="ml-auto text-xs text-slate-500">{data.rows.length}</span>
      </div>

      <div className="space-y-2">
        {data.rows.map((r) => (
          <div key={r.id} className="flex items-center gap-3 p-3 rounded-xl bg-black/[0.03] dark:bg-white/[0.03] border border-black/5 dark:border-white/5">
            <div className={`w-8 h-8 shrink-0 rounded-full bg-gradient-to-br ${gradientFor(r.display_name)} flex items-center justify-center text-white text-xs font-bold`}>
              {(r.display_name?.charAt(0) || '?').toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">{r.display_name}</p>
              <div className="flex items-center gap-x-4 gap-y-1 mt-1 flex-wrap text-xs">
                <span className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300 min-w-0">
                  <Crown size={12} className="text-gold shrink-0" />
                  <span className="truncate">{r.champion_team || <span className="text-slate-400 italic">—</span>}</span>
                </span>
                <span className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300 min-w-0">
                  <Target size={12} className="text-accent shrink-0" />
                  <span className="truncate">{r.top_scorer_name || <span className="text-slate-400 italic">—</span>}</span>
                </span>
                <span className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300 min-w-0">
                  <Handshake size={12} className="text-accent shrink-0" />
                  <span className="truncate">{r.top_assist_name || <span className="text-slate-400 italic">—</span>}</span>
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  )
}
