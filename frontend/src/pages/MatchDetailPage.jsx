import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { motion } from 'motion/react'
import { ArrowLeft, Clock, Calendar, MapPin, ShieldAlert, Star, TrendingUp, HelpCircle } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'

export default function MatchDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { profile } = useAuth()
  
  const [match, setMatch] = useState(null)
  const [predictions, setPredictions] = useState([])
  const [loading, setLoading] = useState(true)
  const [isLocked, setIsLocked] = useState(false)

  useEffect(() => {
    const fetchMatchAndPredictions = async () => {
      try {
        setLoading(true)
        
        // 1. Fetch match data
        const { data: matchData, error: matchError } = await supabase
          .from('matches')
          .select('*')
          .eq('id', id)
          .single()
          
        if (matchError) throw matchError
        
        setMatch(matchData)
        
        // Determinar si está bloqueado
        const dateString = matchData.kickoff_at.endsWith('Z') || matchData.kickoff_at.includes('+')
          ? matchData.kickoff_at
          : `${matchData.kickoff_at}Z`
        const kickoff = new Date(dateString)
        const now = new Date()
        
        const locked = (kickoff - now) <= 15 * 60 * 1000 || ['in_progress', 'finished'].includes(matchData.status)
        setIsLocked(locked)

        // 2. Fetch predictions si está bloqueado
        if (locked) {
          const { data: predsData, error: predsError } = await supabase
            .from('predictions')
            .select(`
              *,
              users!inner (
                display_name,
                total_points
              )
            `)
            .eq('match_id', id)
            .order('points_earned', { ascending: false })
            
          if (predsError) throw predsError
          setPredictions(predsData || [])
        }
      } catch (err) {
        console.error('Error fetching match details:', err)
      } finally {
        setLoading(false)
      }
    }

    if (id) {
      fetchMatchAndPredictions()
    }
  }, [id])

  if (loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center h-[50vh] text-slate-400">
        <div className="animate-spin text-4xl mb-4">⚽</div>
        <p>Cargando detalles del partido...</p>
      </div>
    )
  }

  if (!match) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center h-[50vh] text-slate-400">
        <ShieldAlert size={48} className="text-rose-500 mb-4" />
        <p>Partido no encontrado.</p>
        <button onClick={() => navigate('/matches')} className="mt-4 text-accent hover:underline">
          Volver a Partidos
        </button>
      </div>
    )
  }

  const dateString = match.kickoff_at.endsWith('Z') || match.kickoff_at.includes('+')
    ? match.kickoff_at
    : `${match.kickoff_at}Z`
  const kickoff = new Date(dateString)
  const isFinished = match.status === 'finished'

  return (
    <div className="space-y-6 pb-8">
      {/* ── Header: Botón de regresar ── */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate(-1)}
          className="p-2 rounded-full glass hover:bg-white/10 transition-colors text-slate-400 hover:text-white"
        >
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-xl font-bold text-slate-900 dark:text-white">Detalles del Partido</h1>
      </div>

      {/* ── Match Info Card ── */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card overflow-hidden relative"
      >
        <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-accent via-purple-500 to-amber-500" />
        
        <div className="p-6">
          <div className="flex justify-between items-center mb-6">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 bg-white/5 px-3 py-1.5 rounded-full">
              <Calendar size={14} />
              {format(kickoff, "EEEE d 'de' MMMM", { locale: es })}
            </div>
            <div className={`flex items-center gap-1.5 text-xs font-bold uppercase px-3 py-1.5 rounded-full ${
              match.status === 'finished' ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' :
              match.status === 'in_progress' ? 'bg-rose-500/10 text-rose-500 border border-rose-500/20 animate-pulse' :
              'bg-slate-500/10 text-slate-500 border border-slate-500/20'
            }`}>
              {match.status === 'finished' ? 'Finalizado' :
               match.status === 'in_progress' ? 'En Vivo' : 
               match.status === 'scheduled' ? 'Programado' : match.status}
            </div>
          </div>

          <div className="flex items-center justify-between gap-4">
            {/* Local */}
            <div className="flex-1 flex flex-col items-center gap-3">
              <div className="relative">
                <div className="absolute inset-0 bg-white/5 blur-xl rounded-full scale-150" />
                <img
                  src={`https://flagcdn.com/w160/${(match.home_team_code || 'xx').toLowerCase()}.png`}
                  alt={match.home_team}
                  className="relative w-24 h-16 object-cover rounded-lg shadow-lg ring-1 ring-white/10"
                  onError={(e) => { e.target.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>' }}
                />
              </div>
              <span className="text-lg font-black text-slate-900 dark:text-white text-center leading-tight">
                {match.home_team || 'Local'}
              </span>
            </div>

            {/* Marcador / VS */}
            <div className="flex flex-col items-center gap-2">
              <div className="flex items-center gap-3 text-4xl font-black font-['Russo_One'] tracking-tight">
                {isFinished || match.status === 'in_progress' ? (
                  <>
                    <span className="text-white">{match.home_score}</span>
                    <span className="text-slate-600">-</span>
                    <span className="text-white">{match.away_score}</span>
                  </>
                ) : (
                  <span className="text-slate-600 text-3xl">VS</span>
                )}
              </div>
              <div className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400 text-sm font-medium">
                <Clock size={14} />
                <span>{format(kickoff, "HH:mm")}</span>
              </div>
            </div>

            {/* Visitante */}
            <div className="flex-1 flex flex-col items-center gap-3">
              <div className="relative">
                <div className="absolute inset-0 bg-white/5 blur-xl rounded-full scale-150" />
                <img
                  src={`https://flagcdn.com/w160/${(match.away_team_code || 'xx').toLowerCase()}.png`}
                  alt={match.away_team}
                  className="relative w-24 h-16 object-cover rounded-lg shadow-lg ring-1 ring-white/10"
                  onError={(e) => { e.target.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>' }}
                />
              </div>
              <span className="text-lg font-black text-slate-900 dark:text-white text-center leading-tight">
                {match.away_team || 'Visitante'}
              </span>
            </div>
          </div>

          <div className="mt-8 pt-4 border-t border-white/5 flex flex-wrap items-center justify-center gap-6">
            {match.stadium && (
              <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 text-sm">
                <MapPin size={16} />
                {match.stadium} {match.city ? `(${match.city})` : ''}
              </div>
            )}
            <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 text-sm font-semibold uppercase tracking-wider">
              {match.stage === 'group' ? `Fase de Grupos - ${match.group_name || ''}` : match.stage}
            </div>
          </div>
        </div>
      </motion.div>

      {/* ── Predicciones de la Liga ── */}
      <div className="space-y-4">
        <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
          <TrendingUp className="text-accent" />
          Predicciones de la Liga
        </h2>

        {!isLocked ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="glass-card p-8 text-center flex flex-col items-center border border-purple-500/20 bg-purple-500/5"
          >
            <div className="w-16 h-16 rounded-full bg-purple-500/10 flex items-center justify-center mb-4">
              <span className="text-3xl">🤫</span>
            </div>
            <h3 className="text-xl font-bold text-white mb-2">Modo Incógnito</h3>
            <p className="text-slate-400 max-w-sm mx-auto leading-relaxed">
              Las predicciones de los demás jugadores están ocultas para evitar copias. Se revelarán exactamente <span className="text-white font-bold">15 minutos antes</span> de que comience el partido.
            </p>
          </motion.div>
        ) : predictions.length === 0 ? (
          <div className="glass-card p-8 text-center">
            <HelpCircle size={32} className="text-slate-500 mx-auto mb-3" />
            <p className="text-slate-400">Nadie hizo predicciones para este partido.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {predictions.map((pred, i) => {
              const isMe = pred.user_id === profile?.id;
              return (
                <motion.div
                  key={pred.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className={`glass-card p-4 flex items-center justify-between ${
                    isMe ? 'border-accent/50 bg-accent/5' : ''
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center text-white font-bold border border-white/10 shadow-inner">
                      {pred.users?.display_name?.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white">
                          {pred.users?.display_name}
                        </span>
                        {isMe && (
                          <span className="text-[10px] font-bold uppercase bg-accent/20 text-accent px-2 py-0.5 rounded-full">
                            Tú
                          </span>
                        )}
                        {pred.use_powerup_x2 && (
                          <span className="text-[10px] font-bold uppercase bg-amber-500/20 text-amber-500 border border-amber-500/30 px-2 py-0.5 rounded-full flex items-center gap-1 shadow-[0_0_10px_rgba(245,158,11,0.2)]">
                            <Star size={10} fill="currentColor" />
                            x2 Comodín
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-slate-400">
                        Puntos totales: {pred.users?.total_points}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-1">
                    <div className="px-4 py-1.5 rounded-xl bg-slate-900/80 border border-white/5 font-mono text-lg font-bold text-white shadow-inner">
                      {pred.home_score} - {pred.away_score}
                    </div>
                    {isFinished && (
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-md ${
                        pred.points_earned > 0 
                          ? 'bg-emerald-500/20 text-emerald-400' 
                          : 'bg-rose-500/20 text-rose-400'
                      }`}>
                        +{pred.points_earned} pts
                      </span>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  )
}
