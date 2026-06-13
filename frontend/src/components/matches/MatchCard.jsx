/* Tarjeta de partido — rediseño minimalista */
import { useState, useEffect } from 'react'
import { motion } from 'motion/react'
import { Lock, Check, X, Zap, Timer, Info } from 'lucide-react'
import { differenceInMinutes, differenceInSeconds } from 'date-fns'
import { useNavigate } from 'react-router-dom'
import GoalCounter from './GoalCounter'

export default function MatchCard({ match, prediction, onSavePrediction, isLoading, hasReachedLimit, powerupsUsed, powerupLimit }) {
  const navigate = useNavigate()

  const [homeGoals, setHomeGoals] = useState(prediction?.home_goals_pred ?? 0)
  const [awayGoals, setAwayGoals] = useState(prediction?.away_goals_pred ?? 0)
  const [usePowerup, setUsePowerup] = useState(prediction?.use_powerup_x2 || false)
  const [penaltiesWinner, setPenaltiesWinner] = useState(prediction?.penalties_winner_pred || '')
  const [countdown, setCountdown] = useState('')

  const dateString = match.kickoff_at.endsWith('Z') || match.kickoff_at.includes('+')
    ? match.kickoff_at
    : `${match.kickoff_at}Z`
  const kickoff = new Date(dateString)
  const minutesUntil = differenceInMinutes(kickoff, new Date())
  const isLocked = minutesUntil <= 15
  const isFinished = match.status === 'finished'
  const isInProgress = match.status === 'in_progress'
  const isKnockout = match.phase !== 'groups'
  const isTiePredicted = homeGoals === awayGoals && homeGoals !== null
  const editable = !isLocked && !isFinished && !isInProgress

  // Cuenta regresiva: cada 30s, sin segundos (eficiente con muchas tarjetas)
  useEffect(() => {
    if (isFinished || isInProgress) return
    const tick = () => {
      const diff = differenceInSeconds(kickoff, new Date())
      if (diff <= 0) { setCountdown('En curso'); return }
      const totalMin = Math.floor(diff / 60)
      const d = Math.floor(totalMin / 1440)
      const h = Math.floor((totalMin % 1440) / 60)
      const m = totalMin % 60
      if (d > 0) setCountdown(`${d}d ${h}h`)
      else if (h > 0) setCountdown(`${h}h ${m}m`)
      else setCountdown(`${m}m`)
    }
    tick()
    const timer = setInterval(tick, 30000)
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
      use_powerup_x2: usePowerup,
    })
  }

  const getPointsStyle = (points) => {
    if (points >= 3) return 'text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/20'
    if (points >= 1) return 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
    return 'text-slate-500 dark:text-slate-400 bg-slate-500/10 border-slate-500/20'
  }

  const flagSrc = (url, code) => url || `https://flagcdn.com/w80/${(code || 'xx').toLowerCase()}.png`

  const Team = ({ name, flag, code }) => (
    <div className="min-w-0 flex flex-col items-center gap-2">
      <img
        src={flagSrc(flag, code)}
        alt={name}
        className="w-12 h-8 rounded object-cover ring-1 ring-black/5 dark:ring-white/10"
        loading="lazy"
        onError={(e) => { e.target.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>' }}
      />
      <p className="text-[13px] font-semibold text-slate-800 dark:text-slate-100 truncate max-w-full leading-tight text-center">{name}</p>
    </div>
  )

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card bg-white dark:bg-white/[0.02] border border-slate-200 dark:border-white/10 p-4 md:p-5"
    >
      {/* Cabecera */}
      <div className="flex items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={(e) => { e.stopPropagation(); navigate(`/match/${match.id}`) }}
            className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-full text-slate-400 hover:text-accent hover:bg-accent/5 transition-colors text-[10px] font-semibold uppercase tracking-wide"
            title="Ver detalles y predicciones de la liga"
          >
            <Info size={12} /> Detalle
          </button>
          <span className="text-[11px] font-medium text-slate-400 truncate">
            {match.group_name ? `Grupo ${match.group_name}` : match.phase.replace(/_/g, ' ')}
            {match.matchday && ` · J${match.matchday}`}
          </span>
        </div>

        <div className="shrink-0">
          {isLocked && !isFinished && !isInProgress ? (
            <span className="flex items-center gap-1 text-[10px] font-semibold text-slate-500 dark:text-slate-400"><Lock size={11} /> Bloqueado</span>
          ) : isInProgress ? (
            <span className="flex items-center gap-1 text-[10px] font-bold text-rose-500"><span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" /> EN VIVO</span>
          ) : isFinished ? (
            <span className="flex items-center gap-1 text-[10px] font-medium text-slate-400"><Check size={11} /> Final</span>
          ) : (
            <span className="flex items-center gap-1 text-[10px] font-medium text-slate-400 tabular-nums"><Timer size={11} /> {countdown}</span>
          )}
        </div>
      </div>

      {/* Marcador */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-3 max-w-md mx-auto">
        <Team name={match.home_team} flag={match.home_flag_url} code={match.home_team_code} />

        <div className="flex items-center justify-center pt-1">
          {isFinished || isInProgress ? (
            <div className={`flex items-center gap-2 text-3xl font-bold tabular-nums ${isInProgress ? 'text-rose-500' : 'text-slate-900 dark:text-white'}`}>
              <span>{match.home_goals_actual ?? 0}</span>
              <span className="text-slate-300 dark:text-slate-600 text-lg font-normal">–</span>
              <span>{match.away_goals_actual ?? 0}</span>
            </div>
          ) : (
            <div className="flex items-center justify-center gap-2">
              <GoalCounter value={homeGoals} onChange={setHomeGoals} disabled={isLocked} />
              <span className="text-slate-300 dark:text-slate-600 text-xl">–</span>
              <GoalCounter value={awayGoals} onChange={setAwayGoals} disabled={isLocked} />
            </div>
          )}
        </div>

        <Team name={match.away_team} flag={match.away_flag_url} code={match.away_team_code} />
      </div>

      {/* Penales */}
      {(isFinished || isInProgress) && match.goes_to_penalties && (
        <p className="text-center text-[11px] font-semibold text-accent mt-3">
          Gana {match.penalties_winner_real} en penales
        </p>
      )}

      {/* Predicción + puntos (jugado / en vivo) */}
      {(isFinished || isInProgress) && (
        <div className="mt-4 flex items-center justify-center gap-2 flex-wrap text-[11px]">
          {prediction ? (
            <span className="inline-flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
              {prediction.use_powerup_x2 && <Zap size={11} className="text-accent fill-current" />}
              Tu predicción <span className="font-bold text-slate-700 dark:text-slate-200 tabular-nums">{prediction.home_goals_pred}-{prediction.away_goals_pred}</span>
            </span>
          ) : (
            <span className="text-slate-400 italic">No predijiste</span>
          )}
          {isFinished && prediction && (
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-bold border ${getPointsStyle(prediction.points_earned)}`}>
              {prediction.points_earned > 0 ? <Check size={12} /> : <X size={12} />}
              +{prediction.points_earned} {prediction.points_earned === 1 ? 'pt' : 'pts'}
            </span>
          )}
        </div>
      )}

      {/* Selector de penales (por jugar) */}
      {editable && isKnockout && isTiePredicted && (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="mt-4 p-3 bg-slate-50 dark:bg-white/5 rounded-xl">
          <p className="text-[11px] text-center text-slate-500 mb-2 font-medium">¿Quién gana en penales?</p>
          <div className="flex gap-2">
            {[match.home_team, match.away_team].map((team) => (
              <button
                key={team}
                onClick={() => setPenaltiesWinner(team)}
                className={`flex-1 py-2 px-3 text-xs font-semibold rounded-lg transition-colors truncate ${
                  penaltiesWinner === team ? 'bg-accent text-white' : 'bg-white dark:bg-white/5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10'
                }`}
              >
                {team}
              </button>
            ))}
          </div>
        </motion.div>
      )}

      {/* Footer editable: comodín + guardar */}
      {editable && (
        <div className="mt-4 flex items-center gap-3">
          <div className="flex flex-col items-center shrink-0">
            <motion.button
              type="button"
              whileTap={{ scale: 0.92 }}
              onClick={() => {
                if (!usePowerup && hasReachedLimit && !prediction?.use_powerup_x2) return
                setUsePowerup(!usePowerup)
              }}
              disabled={!usePowerup && hasReachedLimit && !prediction?.use_powerup_x2}
              className={`flex items-center gap-1 px-3 py-2.5 rounded-xl text-[11px] font-bold transition-colors border ${
                usePowerup
                  ? 'bg-accent/10 text-accent border-accent/30'
                  : (hasReachedLimit && !prediction?.use_powerup_x2)
                  ? 'text-slate-400 border-slate-200 dark:border-white/5 cursor-not-allowed opacity-50'
                  : 'text-slate-500 dark:text-slate-300 border-slate-200 dark:border-white/10 hover:border-accent/30'
              }`}
            >
              <Zap size={14} className={usePowerup ? 'fill-current' : ''} /> x2
            </motion.button>
            <span className="text-[9px] mt-1 text-slate-400">{powerupsUsed}/{powerupLimit}</span>
          </div>

          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={handleSave}
            disabled={isLoading || (isKnockout && isTiePredicted && !penaltiesWinner)}
            className="flex-1 py-3 px-4 rounded-xl bg-accent text-white font-bold text-sm hover:bg-accent-dark transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isLoading ? '...' : prediction ? 'Actualizar predicción' : 'Guardar predicción'}
          </motion.button>
        </div>
      )}
    </motion.div>
  )
}
