/* Tarjeta de partido con predicción y resultado (Motor Avanzado) */
import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Lock, Check, X, Zap, Timer, Info } from 'lucide-react'
import { format, differenceInMinutes, differenceInSeconds } from 'date-fns'
import { es } from 'date-fns/locale'
import { useNavigate } from 'react-router-dom'
import GoalCounter from './GoalCounter'

export default function MatchCard({ match, prediction, onSavePrediction, isLoading, hasUsedPowerupInGroup }) {
  const navigate = useNavigate()
  
  // Estado local basado en props
  const [homeGoals, setHomeGoals] = useState(prediction?.home_goals_pred ?? 0)
  const [awayGoals, setAwayGoals] = useState(prediction?.away_goals_pred ?? 0)
  const [usePowerup, setUsePowerup] = useState(prediction?.use_powerup_x2 || false)
  const [penaltiesWinner, setPenaltiesWinner] = useState(prediction?.penalties_winner_pred || '')
  
  const [countdown, setCountdown] = useState('')

  // Asegurar que la fecha se parsea como UTC si Supabase omite la zona horaria
  const dateString = match.kickoff_at.endsWith('Z') || match.kickoff_at.includes('+')
    ? match.kickoff_at
    : `${match.kickoff_at}Z`
    
  const kickoff = new Date(dateString)
  const now = new Date()
  const minutesUntil = differenceInMinutes(kickoff, now)
  const isLocked = minutesUntil <= 15
  const isFinished = match.status === 'finished'
  const isInProgress = match.status === 'in_progress'
  const isKnockout = match.phase !== 'groups'

  // Determinar si hay empate en la predicción actual para mostrar penales
  const isTiePredicted = homeGoals === awayGoals && homeGoals !== null

  // Countdown timer
  useEffect(() => {
    if (isFinished || isInProgress) return
    const timer = setInterval(() => {
      const now = new Date()
      const diff = differenceInSeconds(kickoff, now)
      if (diff <= 0) {
        setCountdown('En curso')
        clearInterval(timer)
        return
      }
      const h = Math.floor(diff / 3600)
      const m = Math.floor((diff % 3600) / 60)
      const s = diff % 60
      if (h > 24) {
        const d = Math.floor(h / 24)
        setCountdown(`${d}d ${h % 24}h`)
      } else {
        setCountdown(`${h}h ${m}m ${s}s`)
      }
    }, 1000)
    return () => clearInterval(timer)
  }, [kickoff, isFinished, isInProgress])

  const handleSave = () => {
    if (isLocked || isFinished) return

    onSavePrediction({
      match_id: match.id,
      prediction_type: 'Marcador',
      home_goals_pred: homeGoals,
      away_goals_pred: awayGoals,
      penalties_winner_pred: (isKnockout && isTiePredicted) ? penaltiesWinner : null,
      use_powerup_x2: usePowerup
    })
  }

  // Estilos de puntuación
  const getPointsStyle = (points) => {
    if (points >= 6) return 'text-gold bg-gold/20 border-gold/30'
    if (points >= 3) return 'text-accent bg-accent/20 border-accent/30'
    if (points >= 1) return 'text-success bg-success/20 border-success/30'
    return 'text-error bg-error/20 border-error/30'
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className={`glass-card bg-white dark:bg-transparent border border-slate-200 dark:border-white/10 shadow-sm dark:shadow-none p-6 md:p-7 relative overflow-hidden ${
        usePowerup
          ? 'ring-1 ring-accent/60 shadow-[0_0_25px_rgba(245,158,11,0.15)]'
          : ''
      } ${isInProgress ? 'ring-1 ring-accent/40' : ''}`}
    >
      {/* Indicador de Powerup Visual (Background glow) */}
      {usePowerup && (
        <div className="absolute top-0 right-0 w-40 h-40 bg-accent/8 rounded-full blur-3xl pointer-events-none" />
      )}

      {/* Live match subtle pulse */}
      {isInProgress && (
        <div className="absolute inset-0 rounded-2xl animate-pulse bg-accent/[0.02] pointer-events-none" />
      )}

      {/* ═══ Header: phase, date, countdown ═══ */}
      <div className="flex items-center justify-between mb-2 relative z-10">
        <div className="flex items-center gap-2">
          <button 
            onClick={() => navigate(`/match/${match.id}`)} 
            className="p-1 hover:bg-slate-100 dark:hover:bg-white/10 rounded-full transition-colors text-slate-400 hover:text-accent"
            title="Ver detalles del partido"
          >
            <Info size={14} />
          </button>
          <span className="text-[11px] uppercase tracking-widest font-semibold text-slate-500">
            {match.group_name ? `Grupo ${match.group_name}` : match.phase.replace(/_/g, ' ')}
            {match.matchday && ` · J${match.matchday}`}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {isLocked && !isFinished ? (
            <span className="flex items-center gap-1 text-[11px] font-semibold text-error-light bg-error/10 px-2 py-0.5 rounded-full">
              <Lock size={11} /> Bloqueado
            </span>
          ) : isInProgress ? (
            <span className="flex items-center gap-1 text-[11px] font-bold text-accent bg-accent/10 px-2 py-0.5 rounded-full animate-pulse">
              <span className="w-1.5 h-1.5 rounded-full bg-accent" />
              EN VIVO
            </span>
          ) : isFinished ? (
            <span className="flex items-center gap-1 text-[11px] text-slate-600 dark:text-slate-500 bg-slate-100 dark:bg-white/5 px-2 py-0.5 rounded-full">
              <Check size={11} /> Finalizado
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[11px] text-slate-600 dark:text-slate-400 font-medium bg-slate-100 dark:bg-white/5 px-2 py-0.5 rounded-full tabular-nums">
              <Timer size={11} /> {countdown}
            </span>
          )}
        </div>
      </div>

      <p className="text-[11px] text-slate-600 mb-5 text-center relative z-10 capitalize">
        {kickoff.toLocaleString('es-CR', {
          timeZone: 'America/Costa_Rica',
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false
        }).replace(',', ' ·')}
        {match.venue && ` · ${match.city}`}
      </p>

      {/* ═══ Equipos y predicción ═══ */}
      <div className="flex items-center justify-between gap-1 relative z-10">
        {/* Equipo local */}
        <div className="flex-1 text-center">
          <div className="relative inline-block mb-2">
            <img
              src={match.home_flag_url || `https://flagcdn.com/w80/${match.home_team_code}.png`}
              alt={match.home_team}
              className="w-14 h-10 mx-auto rounded-lg object-cover shadow-lg shadow-black/30 border border-white/10"
              loading="lazy"
            />
          </div>
          <p className="text-sm font-bold text-slate-900 dark:text-slate-200 truncate leading-tight">{match.home_team}</p>
        </div>

        {/* Input area */}
        <div className="flex flex-col items-center gap-2 px-1">
          {isFinished || isInProgress ? (
            <div className="text-center">
              {prediction && (
                <div className="flex items-center justify-center gap-1 mb-1.5">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider">Tu predicción</p>
                  {prediction.use_powerup_x2 && <Zap size={10} className="text-accent fill-current" />}
                </div>
              )}
              <div className="flex items-center gap-3">
                <span className="text-3xl font-black text-slate-900 dark:text-white tabular-nums">
                  {match.home_goals_actual ?? '-'}
                </span>
                <span className="text-slate-400 dark:text-slate-600 text-xl font-light">:</span>
                <span className="text-3xl font-black text-slate-900 dark:text-white tabular-nums">
                  {match.away_goals_actual ?? '-'}
                </span>
              </div>
              {prediction && (
                <p className="text-[11px] text-slate-600 dark:text-slate-500 mt-1.5 bg-slate-100 dark:bg-white/5 px-3 py-1 rounded-full inline-block">
                  ({prediction.home_goals_pred} - {prediction.away_goals_pred})
                </p>
              )}
              {/* Goalscorers block */}
              {match.events_json && match.events_json.length > 0 && (
                <div className="flex justify-between w-full mt-2 text-[10px] text-slate-600 dark:text-slate-400 max-w-[200px]">
                  <div className="flex-1 text-right pr-2 border-r border-slate-200 dark:border-white/10">
                    {match.events_json.filter(e => e.team === 'home').map((e, idx) => (
                      <div key={idx}>⚽ {e.athlete} {e.time}</div>
                    ))}
                  </div>
                  <div className="flex-1 text-left pl-2">
                    {match.events_json.filter(e => e.team === 'away').map((e, idx) => (
                      <div key={idx}>⚽ {e.athlete} {e.time}</div>
                    ))}
                  </div>
                </div>
              )}

            </div>
          ) : (
            <div className="flex items-center gap-3">
              <GoalCounter value={homeGoals} onChange={setHomeGoals} disabled={isLocked} />
              <span className="text-slate-400 dark:text-slate-600 text-2xl font-light mt-0.5">:</span>
              <GoalCounter value={awayGoals} onChange={setAwayGoals} disabled={isLocked} />
            </div>
          )}
        </div>

        {/* Equipo visitante */}
        <div className="flex-1 text-center">
          <div className="relative inline-block mb-2">
            <img
              src={match.away_flag_url || `https://flagcdn.com/w80/${match.away_team_code}.png`}
              alt={match.away_team}
              className="w-14 h-10 mx-auto rounded-lg object-cover shadow-lg shadow-black/30 border border-white/10"
              loading="lazy"
            />
          </div>
          <p className="text-sm font-bold text-slate-900 dark:text-slate-200 truncate leading-tight">{match.away_team}</p>
        </div>
      </div>

      {/* ═══ Penales Selector ═══ */}
      {!isFinished && !isInProgress && isKnockout && isTiePredicted && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="mt-5 p-3.5 bg-slate-100 dark:glass-strong rounded-2xl"
        >
          <p className="text-[11px] text-center text-slate-600 dark:text-slate-400 mb-2.5 uppercase tracking-wider font-semibold">
            ¿Quién gana en penales?
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPenaltiesWinner(match.home_team)}
              className={`flex-1 py-3 px-4 text-xs font-bold rounded-xl transition-all duration-200 border ${
                penaltiesWinner === match.home_team
                  ? 'gradient-2026 text-white dark:text-slate-900 border-transparent shadow-sm'
                  : 'bg-white dark:bg-white/5 border-slate-200 dark:border-white/5 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/10'
              }`}
            >
              {match.home_team}
            </button>
            <button
              onClick={() => setPenaltiesWinner(match.away_team)}
              className={`flex-1 py-3 px-4 text-xs font-bold rounded-xl transition-all duration-200 border ${
                penaltiesWinner === match.away_team
                  ? 'gradient-2026 text-white dark:text-slate-900 border-transparent shadow-sm'
                  : 'bg-white dark:bg-white/5 border-slate-200 dark:border-white/5 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/10'
              }`}
            >
              {match.away_team}
            </button>
          </div>
        </motion.div>
      )}

      {/* ═══ Info Penales (Finalizado) ═══ */}
      {(isFinished || isInProgress) && match.goes_to_penalties && (
        <div className="mt-4 text-center">
          <p className="text-xs font-bold text-accent">
            Gana {match.penalties_winner_real} en Penales
          </p>
          {prediction && prediction.penalties_winner_pred && (
             <p className="text-[10px] text-slate-400 mt-0.5">
               (Tú predijiste a {prediction.penalties_winner_pred})
             </p>
          )}
        </div>
      )}

      {/* ═══ Separator ═══ */}
      <div className="mt-5 mb-4 h-px w-full bg-gradient-to-r from-transparent via-slate-200 dark:via-white/[0.06] to-transparent relative z-10" />

      {/* ═══ Footer: Powerup y Guardar / Resultados ═══ */}
      <div className="flex items-center justify-between relative z-10">
        {isFinished && prediction ? (
          <div className="w-full text-center">
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-bold border ${getPointsStyle(prediction.points_earned)}`}
            >
              {prediction.points_earned > 0 ? <Check size={14} /> : <X size={14} />}
              {prediction.points_earned} {prediction.points_earned === 1 ? 'punto' : 'puntos'}
            </motion.div>
          </div>
        ) : !isLocked && !isFinished && !isInProgress ? (
          <>
            {/* Toggle Powerup */}
            <motion.button
              type="button"
              whileTap={{ scale: 0.92 }}
              onClick={() => {
                if (!usePowerup && hasUsedPowerupInGroup && !prediction?.use_powerup_x2) {
                  return; // Está bloqueado
                }
                setUsePowerup(!usePowerup)
              }}
              disabled={!usePowerup && hasUsedPowerupInGroup && !prediction?.use_powerup_x2}
              className={`flex items-center gap-1.5 px-4 py-3 rounded-2xl text-xs font-bold transition-all duration-200 border ${
                usePowerup
                  ? 'bg-accent/15 text-accent border-accent/40 shadow-sm shadow-purple-500/10'
                  : (!usePowerup && hasUsedPowerupInGroup && !prediction?.use_powerup_x2)
                  ? 'bg-slate-100 dark:bg-white/5 text-slate-400 dark:text-slate-600 border-slate-200 dark:border-white/5 cursor-not-allowed opacity-50'
                  : 'bg-slate-100 dark:glass-strong text-slate-600 dark:text-slate-400 border-slate-200 dark:border-white/5 hover:text-slate-900 dark:hover:text-white hover:border-slate-300 dark:hover:border-white/10'
              }`}
            >
              <Zap size={14} className={usePowerup ? 'fill-current' : ''} />
              x2
            </motion.button>

            {/* Botón Guardar */}
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={handleSave}
              disabled={isLoading || (isKnockout && isTiePredicted && !penaltiesWinner)}
              className="flex-1 ml-3 py-3 px-5 rounded-2xl gradient-2026 text-white dark:text-slate-900 font-bold text-sm shadow-lg shadow-purple-500/20 hover:shadow-purple-500/30 transition-all duration-200 disabled:opacity-40 disabled:shadow-none disabled:bg-slate-200 dark:disabled:bg-slate-700 disabled:text-slate-500 dark:disabled:text-slate-400 disabled:bg-none"
            >
              {isLoading ? '...' : prediction ? 'Actualizar' : 'Guardar'}
            </motion.button>
          </>
        ) : null}
      </div>
    </motion.div>
  )
}
