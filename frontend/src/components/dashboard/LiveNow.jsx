// Panel "Jugando Ahora": partidos en curso con marcador y minuto, en vivo.
import { useState, useEffect, useCallback } from 'react'
import { motion } from 'motion/react'
import { ChevronRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

function liveMinute(minute) {
  if (!minute) return null
  return /^\d+$/.test(String(minute)) ? `${minute}'` : String(minute)
}

export default function LiveNow() {
  const [matches, setMatches] = useState([])

  const fetchLive = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('matches')
        .select('*')
        .eq('status', 'in_progress')
        .order('kickoff_at', { ascending: true })
      if (error) throw error
      setMatches(data || [])
    } catch (err) {
      console.error('Error fetching live matches:', err)
    }
  }, [])

  useEffect(() => {
    fetchLive()
  }, [fetchLive])

  // Realtime: recargar cuando cambie cualquier partido (entra/sale de "en vivo")
  useEffect(() => {
    const channel = supabase
      .channel('live-now')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, () => fetchLive())
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [fetchLive])

  // Mientras haya partidos en vivo, pedir al backend que sincronice y recargar
  // cada 30s, así el marcador avanza solo sin depender del cron.
  useEffect(() => {
    if (matches.length === 0) return
    let cancelled = false
    const tick = async () => {
      try {
        await fetch('/_backend/api/matches/refresh-live', { method: 'POST' })
      } catch {
        /* ignorar */
      }
      if (!cancelled) fetchLive()
    }
    const interval = setInterval(tick, 30000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [matches.length, fetchLive])

  if (matches.length === 0) return null

  return (
    <div className="space-y-3 md:col-span-2 lg:col-span-3">
      {/* Header */}
      <div className="flex items-center gap-2 px-1">
        <span className="relative flex h-2.5 w-2.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-rose-500" />
        </span>
        <h3 className="text-sm font-bold text-slate-900 dark:text-slate-200 uppercase tracking-[0.15em]">
          Jugando Ahora
        </h3>
        <span className="text-[10px] font-bold text-rose-500 bg-rose-500/10 border border-rose-500/20 rounded-full px-2 py-0.5">
          {matches.length}
        </span>
      </div>

      {/* Carrusel */}
      <div className="flex gap-3 overflow-x-auto pb-2 snap-x snap-mandatory scrollbar-hide -mx-1 px-1">
        {matches.map((match, index) => (
          <LiveCard key={match.id} match={match} index={index} />
        ))}
      </div>
    </div>
  )
}

/** Tarjeta de partido en vivo */
function LiveCard({ match, index }) {
  const navigate = useNavigate()
  const minute = liveMinute(match.minute)

  return (
    <motion.div
      initial={{ opacity: 0, x: 30 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.08 }}
      onClick={() => navigate(`/match/${match.id}`)}
      className="glass-card min-w-[280px] snap-start cursor-pointer group relative overflow-hidden ring-1 ring-rose-500/30 hover:ring-rose-500/60 transition-all"
    >
      <div className="absolute top-0 left-0 right-0 h-[2px] rounded-t-2xl bg-gradient-to-r from-rose-500/70 via-rose-400/40 to-transparent" />
      <div className="absolute inset-0 bg-rose-500/[0.03] animate-pulse pointer-events-none" />

      <div className="p-4 relative z-10" style={{ paddingTop: '8px' }}>
        {/* Estado en vivo */}
        <div className="flex items-center justify-between gap-2 mb-4">
          <span className="text-[10px] text-slate-600 dark:text-slate-500 font-semibold uppercase tracking-wider whitespace-nowrap">
            {match.group_name ? `Grupo ${match.group_name}` : match.phase?.replace(/_/g, ' ')}
          </span>
          <span className="flex items-center gap-1 text-[10px] font-bold text-rose-500 bg-rose-500/10 px-2 py-0.5 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
            EN VIVO{minute ? ` · ${minute}` : ''}
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
            <span className="text-2xl font-black text-slate-900 dark:text-white tabular-nums">{match.home_goals_actual ?? 0}</span>
            <span className="text-slate-400 dark:text-slate-600 text-lg font-light">:</span>
            <span className="text-2xl font-black text-slate-900 dark:text-white tabular-nums">{match.away_goals_actual ?? 0}</span>
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

        {/* CTA */}
        <div className="flex items-center justify-center gap-1.5 text-[11px] font-bold rounded-xl py-1.5 bg-rose-500/10 text-rose-600 border border-rose-500/20 dark:text-rose-400 dark:border-rose-500/15 group-hover:bg-rose-500/15 transition-colors">
          <span>Ver predicciones de la liga</span>
          <ChevronRight size={12} />
        </div>
      </div>
    </motion.div>
  )
}
