/* Tarjeta de partido con predicción y resultado (Motor Avanzado) */
import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Lock, Check, X, Zap, Timer, Info } from 'lucide-react'
import { format, differenceInMinutes, differenceInSeconds } from 'date-fns'
import { es } from 'date-fns/locale'
import { useNavigate } from 'react-router-dom'
import GoalCounter from './GoalCounter'

export default function MatchCard({ match, prediction, onSavePrediction, isLoading, hasReachedLimit, powerupsUsed, powerupLimit }) {
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
      className={`glass-card bg-white dark:bg-transparent border border-slate-200 dark:border-white/10 shadow-sm dark:shadow-none p-4 md:p-5 relative overflow-hidden ${
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

      {/* ═══ Cabecera: detalle + grupo/jornada + estado (en flujo, sin solaparse) ═══ */}
      <div className="flex items-center justify-between gap-2 mb-3 relative z-20">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={(e) => { e.stopPropagation(); navigate(`/match/${match.id}`) }}
            className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-full bg-slate-100 dark:bg-white/5 hover:bg-accent/10 text-slate-500 hover:text-accent transition-colors text-[10px] font-bold uppercase tracking-wider"
            title="Ver detalles y predicciones de la liga"
          >
            <Info size={12} /> Detalle
          </button>
          <span className="text-[11px] uppercase tracking-wider font-semibold text-slate-500 truncate">
            {match.group_name ? `Grupo ${match.group_name}` : match.phase.replace(/_/g, ' ')}
            {match.matchday && ` · J${match.matchday}`}
          </span>
        </div>

        <div className="shrink-0">
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

      {/* Wrapper para el contenido principal */}
      <div className="relative z-10 max-w-lg mx-auto">
        {/* Fecha y Fase en flujo normal arriba */}
        <div className="text-center mb-4">
          <p className="text-[11px] text-slate-600 dark:text-slate-400 capitalize font-medium flex items-center justify-center gap-1.5 flex-wrap">
            <span>
              {kickoff.toLocaleString('es-CR', {
                timeZone: 'America/Costa_Rica',
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                hour12: false
              }).replace(',', ' ·')}
            </span>
            {match.venue && <span className="opacity-75">· {match.city}</span>}
          </p>
        </div>

        {/* ═══ Equipos y predicción ═══ */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1 relative z-10 max-w-md mx-auto">
        {/* Equipo local */}
        <div className="flex-1 min-w-0 text-center">
          <div className="relative inline-block mb-2">
            <img
              src={match.home_flag_url || `https://flagcdn.com/w80/${match.home_team_code}.png`}
              alt={match.home_team}
              className="w-12 h-8 mx-auto rounded-md object-cover shadow-md shadow-black/30 border border-white/10"
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
              <div className="flex items-center justify-center gap-3">
                <span className="text-2xl font-black text-slate-900 dark:text-white tabular-nums">
                  {match.home_goals_actual ?? '-'}
                </span>
                <span className="text-slate-400 dark:text-slate-600 text-lg font-light">:</span>
                <span className="text-2xl font-black text-slate-900 dark:text-white tabular-nums">
                  {match.away_goals_actual ?? '-'}
                </span>
              </div>
              {prediction && (
                <p className="text-[11px] text-slate-600 dark:text-slate-500 mt-1.5 bg-slate-100 dark:bg-white/5 px-3 py-1 rounded-full inline-block">
                  ({prediction.home_goals_pred} - {prediction.away_goals_pred})
                </p>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center gap-3">
              <GoalCounter value={homeGoals} onChange={setHomeGoals} disabled={isLocked} />
              <span className="text-slate-400 dark:text-slate-600 text-2xl font-light mt-0.5">:</span>
              <GoalCounter value={awayGoals} onChange={setAwayGoals} disabled={isLocked} />
            </div>
          )}
        </div>

        {/* Equipo visitante */}
        <div className="flex-1 min-w-0 text-center">
          <div className="relative inline-block mb-2">
            <img
              src={match.away_flag_url || `https://flagcdn.com/w80/${match.away_team_code}.png`}
              alt={match.away_team}
              className="w-12 h-8 mx-auto rounded-md object-cover shadow-md shadow-black/30 border border-white/10"
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
            {/* Toggle Powerup Absoluto */}
            <div className="absolute bottom-3 left-3 flex flex-col items-center z-20">
              <motion.button
                type="button"
                whileTap={{ scale: 0.92 }}
                onClick={() => {
                  if (!usePowerup && hasReachedLimit && !prediction?.use_powerup_x2) {
                    return; // Está bloqueado
                  }
                  setUsePowerup(!usePowerup)
                }}
                disabled={!usePowerup && hasReachedLimit && !prediction?.use_powerup_x2}
                className={`flex items-center gap-1 px-3 py-2.5 rounded-xl text-[11px] font-bold transition-all duration-200 border ${
                  usePowerup
                    ? 'bg-accent/15 text-accent border-accent/40 shadow-sm shadow-purple-500/10'
                    : (!usePowerup && hasReachedLimit && !prediction?.use_powerup_x2)
                    ? 'bg-slate-100 dark:bg-white/5 text-slate-400 dark:text-slate-600 border-slate-200 dark:border-white/5 cursor-not-allowed opacity-50'
                    : 'bg-slate-100 dark:glass-strong text-slate-600 dark:text-slate-400 border-slate-200 dark:border-white/5 hover:text-slate-900 dark:hover:text-white hover:border-slate-300 dark:hover:border-white/10'
                }`}
              >
                <motion.div
                  initial={false}
                  animate={usePowerup ? "active" : "inactive"}
                  variants={{
                    active: { 
                      scale: [1, 1.6, 1], 
                      rotate: [0, -15, 15, -10, 0],
                      filter: [
                        'drop-shadow(0px 0px 0px rgba(245,158,11,0))',
                        'drop-shadow(0px 0px 12px rgba(245,158,11,0.9))',
                        'drop-shadow(0px 0px 6px rgba(245,158,11,0.5))'
                      ]
                    },
                    inactive: { 
                      scale: [1, 0.7, 1],
                      opacity: [1, 0.4, 1],
                      rotate: [0, 5, 0],
                      filter: 'drop-shadow(0px 0px 0px rgba(245,158,11,0))'
                    }
                  }}
                  transition={{ duration: 0.5, type: "spring", bounce: 0.4 }}
                >
                  <Zap size={14} className={usePowerup ? 'fill-current' : ''} />
                </motion.div>
                x2
              </motion.button>
              <span className="text-[9px] mt-1 text-slate-400 font-medium tracking-wide">
                {powerupsUsed}/{powerupLimit} usados
              </span>
            </div>

            {/* Botón Guardar (con margen para no pisar el absolute izquierdo) */}
            <div className="w-full flex justify-end">
              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={handleSave}
                disabled={isLoading || (isKnockout && isTiePredicted && !penaltiesWinner)}
                className="w-[calc(100%-84px)] py-2.5 px-4 rounded-xl gradient-2026 text-white dark:text-slate-900 font-bold text-[13px] shadow-lg shadow-purple-500/20 hover:shadow-purple-500/30 transition-all duration-200 disabled:opacity-40 disabled:shadow-none disabled:bg-slate-200 dark:disabled:bg-slate-700 disabled:text-slate-500 dark:disabled:text-slate-400 disabled:bg-none"
              >
                {isLoading ? '...' : prediction ? 'Actualizar' : 'Guardar'}
              </motion.button>
            </div>
          </>
        ) : null}
      </div>
      
      </div> {/* Fin del wrapper pt-8 */}
    </motion.div>
  )
}
