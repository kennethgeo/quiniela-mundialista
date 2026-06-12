// Carrusel horizontal de resultados (partidos finalizados) — clic abre el detalle
import { useState, useEffect } from 'react'
import { motion } from 'motion/react'
import { Check, ChevronRight, CheckCircle2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

export default function RecentResults() {
  const [matches, setMatches] = useState([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    const fetchMatches = async () => {
      try {
        const { data, error } = await supabase
          .from('matches')
          .select('*')
          .eq('status', 'finished')
          .order('kickoff_at', { ascending: false })
          .limit(6)

        if (error) throw error
        setMatches(data || [])
      } catch (err) {
        console.error('Error fetching results:', err)
        setMatches([])
      } finally {
        setLoading(false)
      }
    }

    fetchMatches()
  }, [])

  if (loading) {
    return (
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-500 dark:text-slate-300 uppercase tracking-wider px-1">Resultados</h3>
        <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
          {[1, 2, 3].map((i) => (
            <div key={i} className="glass-card min-w-[260px] h-36 shimmer" />
          ))}
        </div>
      </div>
    )
  }

  // Si no hay finalizados, no mostramos la sección
  if (matches.length === 0) return null

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between px-1">
        <h3 className="text-sm font-bold text-slate-900 dark:text-slate-200 uppercase tracking-[0.15em] flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-emerald-500/20 flex items-center justify-center">
            <Check size={13} className="text-emerald-500" />
          </div>
          Resultados
        </h3>
        <button
          onClick={() => navigate('/matches', { state: { tab: 'finished' } })}
          className="text-xs text-purple-600 dark:text-purple-400 flex items-center gap-1 hover:text-purple-500 transition-colors font-semibold"
        >
          Ver todos <ChevronRight size={14} />
        </button>
      </div>

      {/* Scroll horizontal de tarjetas */}
      <div className="flex gap-3 overflow-x-auto pb-2 snap-x snap-mandatory scrollbar-hide -mx-1 px-1">
        {matches.map((match, index) => (
          <ResultCard key={match.id} match={match} index={index} />
        ))}
      </div>
    </div>
  )
}

/** Tarjeta individual de resultado */
function ResultCard({ match, index }) {
  const navigate = useNavigate()

  return (
    <motion.div
      initial={{ opacity: 0, x: 30 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.08 }}
      onClick={() => navigate(`/match/${match.id}`)}
      className="glass-card min-w-[280px] snap-start cursor-pointer group relative hover:ring-1 hover:ring-accent/50 transition-all"
    >
      <div className="absolute top-0 left-0 right-0 h-[2px] rounded-t-2xl bg-gradient-to-r from-emerald-500/50 via-emerald-400/30 to-transparent" />

      <div className="p-4" style={{ paddingTop: '8px' }}>
        {/* Estado */}
        <div className="flex items-center justify-between gap-2 mb-4">
          <span className="text-[10px] text-slate-600 dark:text-slate-500 font-semibold uppercase tracking-wider whitespace-nowrap">
            {match.group_name ? `Grupo ${match.group_name}` : match.phase?.replace(/_/g, ' ')}
          </span>
          <span className="flex items-center gap-1 text-[10px] text-slate-600 dark:text-slate-500 bg-slate-100 dark:bg-white/5 px-2 py-0.5 rounded-full">
            <CheckCircle2 size={11} /> Final
          </span>
        </div>

        {/* Equipos y marcador */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex flex-col items-center gap-2 flex-1 min-w-0">
            <img
              src={`https://flagcdn.com/w80/${(match.home_team_code || 'xx').toLowerCase()}.png`}
              alt={match.home_team}
              className="w-12 h-8 object-cover rounded-md shadow-lg shadow-black/30 ring-1 ring-white/10"
              onError={(e) => { e.target.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>' }}
            />
            <span className="text-[11px] text-slate-900 dark:text-white font-semibold text-center leading-tight truncate max-w-[80px]">
              {match.home_team}
            </span>
          </div>

          <div className="flex items-center gap-2 px-3 shrink-0">
            <span className="text-2xl font-black text-slate-900 dark:text-white tabular-nums">{match.home_goals_actual ?? '-'}</span>
            <span className="text-slate-400 dark:text-slate-600 text-lg font-light">:</span>
            <span className="text-2xl font-black text-slate-900 dark:text-white tabular-nums">{match.away_goals_actual ?? '-'}</span>
          </div>

          <div className="flex flex-col items-center gap-2 flex-1 min-w-0">
            <img
              src={`https://flagcdn.com/w80/${(match.away_team_code || 'xx').toLowerCase()}.png`}
              alt={match.away_team}
              className="w-12 h-8 object-cover rounded-md shadow-lg shadow-black/30 ring-1 ring-white/10"
              onError={(e) => { e.target.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>' }}
            />
            <span className="text-[11px] text-slate-900 dark:text-white font-semibold text-center leading-tight truncate max-w-[80px]">
              {match.away_team}
            </span>
          </div>
        </div>

        {/* CTA ver predicciones */}
        <div className="flex items-center justify-center gap-1.5 text-[11px] font-bold rounded-xl py-1.5 bg-purple-500/10 text-purple-600 border border-purple-500/20 dark:bg-purple-400/10 dark:text-purple-400 dark:border-purple-400/10 group-hover:bg-purple-500/15 transition-colors">
          <span>Ver predicciones de la liga</span>
          <ChevronRight size={12} />
        </div>
      </div>
    </motion.div>
  )
}
