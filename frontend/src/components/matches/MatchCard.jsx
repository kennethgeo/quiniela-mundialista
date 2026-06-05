/* Tarjeta de partido con predicción y resultado */
import { useState, useEffect } from 'react'
import { motion } from 'motion/react'
import { Lock, Clock, Check, X } from 'lucide-react'
import { format, differenceInMinutes, differenceInHours, differenceInSeconds } from 'date-fns'
import { es } from 'date-fns/locale'
import GoalCounter from './GoalCounter'

export default function MatchCard({ match, prediction, onSavePrediction, isLoading }) {
  const [homeGoals, setHomeGoals] = useState(prediction?.home_goals_pred ?? 0)
  const [awayGoals, setAwayGoals] = useState(prediction?.away_goals_pred ?? 0)
  const [countdown, setCountdown] = useState('')

  const kickoff = new Date(match.kickoff_at)
  const now = new Date()
  const minutesUntil = differenceInMinutes(kickoff, now)
  const isLocked = minutesUntil <= 15
  const isFinished = match.status === 'finished'
  const isInProgress = match.status === 'in_progress'

  // Actualizar predicción cuando cambie desde props
  useEffect(() => {
    if (prediction) {
      setHomeGoals(prediction.home_goals_pred)
      setAwayGoals(prediction.away_goals_pred)
    }
  }, [prediction])

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
      home_goals_pred: homeGoals,
      away_goals_pred: awayGoals
    })
  }

  // Determinar colores según puntos obtenidos
  const getPointsStyle = (points) => {
    if (points === 3) return 'text-accent bg-accent/20 border-accent/30'
    if (points === 1) return 'text-success bg-success/20 border-success/30'
    return 'text-error bg-error/20 border-error/30'
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass p-4 mb-3"
    >
      {/* Encabezado: fase, fecha, countdown */}
      <div className="flex items-center justify-between mb-3 text-xs text-slate-400">
        <span className="uppercase tracking-wider font-medium">
          {match.group_name ? `Grupo ${match.group_name}` : match.phase.replace(/_/g, ' ')}
          {match.matchday && ` · J${match.matchday}`}
        </span>
        <div className="flex items-center gap-1.5">
          {isLocked && !isFinished ? (
            <span className="flex items-center gap-1 text-error-light">
              <Lock size={12} /> Bloqueado
            </span>
          ) : isInProgress ? (
            <span className="flex items-center gap-1 text-accent animate-pulse">
              <Clock size={12} /> En vivo
            </span>
          ) : isFinished ? (
            <span className="flex items-center gap-1 text-slate-500">
              <Check size={12} /> Finalizado
            </span>
          ) : (
            <span className="flex items-center gap-1">
              <Clock size={12} /> {countdown}
            </span>
          )}
        </div>
      </div>

      {/* Fecha y hora */}
      <p className="text-xs text-slate-500 mb-3 text-center">
        {format(kickoff, "d 'de' MMMM · HH:mm", { locale: es })}
        {match.venue && ` · ${match.city}`}
      </p>

      {/* Equipos y predicción */}
      <div className="flex items-center justify-between gap-2">
        {/* Equipo local */}
        <div className="flex-1 text-center">
          <img
            src={match.home_flag_url || `https://flagcdn.com/w80/${match.home_team_code}.png`}
            alt={match.home_team}
            className="w-12 h-8 mx-auto rounded object-cover mb-1.5 shadow-lg"
            loading="lazy"
          />
          <p className="text-sm font-semibold text-slate-200 truncate">{match.home_team}</p>
        </div>

        {/* Marcador / Predicción */}
        <div className="flex items-center gap-2">
          {isFinished || isInProgress ? (
            <>
              {/* Resultado real */}
              <div className="text-center">
                {prediction && (
                  <p className="text-[10px] text-slate-500 mb-1">Tu predicción</p>
                )}
                <div className="flex items-center gap-2">
                  <span className="text-2xl font-bold text-white">
                    {match.home_goals_actual ?? '-'}
                  </span>
                  <span className="text-slate-500 text-lg">:</span>
                  <span className="text-2xl font-bold text-white">
                    {match.away_goals_actual ?? '-'}
                  </span>
                </div>
                {prediction && (
                  <p className="text-xs text-slate-400 mt-1">
                    ({prediction.home_goals_pred} - {prediction.away_goals_pred})
                  </p>
                )}
              </div>
            </>
          ) : (
            <>
              {/* Inputs de predicción */}
              <GoalCounter
                value={homeGoals}
                onChange={setHomeGoals}
                disabled={isLocked}
              />
              <span className="text-slate-500 text-lg font-bold">:</span>
              <GoalCounter
                value={awayGoals}
                onChange={setAwayGoals}
                disabled={isLocked}
              />
            </>
          )}
        </div>

        {/* Equipo visitante */}
        <div className="flex-1 text-center">
          <img
            src={match.away_flag_url || `https://flagcdn.com/w80/${match.away_team_code}.png`}
            alt={match.away_team}
            className="w-12 h-8 mx-auto rounded object-cover mb-1.5 shadow-lg"
            loading="lazy"
          />
          <p className="text-sm font-semibold text-slate-200 truncate">{match.away_team}</p>
        </div>
      </div>

      {/* Botón guardar o puntos */}
      <div className="mt-3 flex justify-center">
        {isFinished && prediction ? (
          <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border ${getPointsStyle(prediction.points_earned)}`}>
            {prediction.points_earned === 3 && <Check size={14} />}
            {prediction.points_earned === 0 && <X size={14} />}
            {prediction.points_earned} {prediction.points_earned === 1 ? 'punto' : 'puntos'}
          </div>
        ) : !isLocked && !isFinished && !isInProgress ? (
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={handleSave}
            disabled={isLoading}
            className="w-full py-2 rounded-xl bg-accent/20 text-accent font-semibold text-sm border border-accent/30 hover:bg-accent/30 transition-colors disabled:opacity-50"
          >
            {isLoading ? 'Guardando...' : prediction ? 'Actualizar predicción' : 'Guardar predicción'}
          </motion.button>
        ) : null}
      </div>
    </motion.div>
  )
}
