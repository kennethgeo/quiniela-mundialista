/* Tarjeta de partido — rediseño tipo "marcador" (Mundial 2026) */
import { useState, useEffect } from 'react'
import { motion } from 'motion/react'
import { Lock, Check, X, Zap, Timer, Info } from 'lucide-react'
import { differenceInMinutes, differenceInSeconds } from 'date-fns'
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

  // Parsear la fecha como UTC si Supabase omite la zona horaria
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

  // Cuenta regresiva (cada 30s, sin segundos → eficiente con muchas tarjetas)
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
    if (points >= 6) return 'text-amber-600 dark:text-gold bg-amber-500/10 dark:bg-gold/15 border-amber-500/30 dark:border-gold/30'
    if (points >= 3) return 'text-accent bg-accent/10 border-accent/30'
    if (points >= 1) return 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/30'
    return 'text-rose-600 dark:text-rose-400 bg-rose-500/10 border-rose-500/30'
  }

  // Acento por estado (código de colores: oro=jugado, rosa=en vivo, morado=por jugar)
  const accentBar = isFinished
    ? 'from-amber-400/70 via-amber-400/30 to-transparent'
    : isInProgress
    ? 'from-rose-500/70 via-rose-400/30 to-transparent'
    : 'from-accent/70 via-accent/30 to-transparent'

  const editable = !isLocked && !isFinished && !isInProgress
  const flagSrc = (url, code) => url || `https://flagcdn.com/w80/${(code || 'xx').toLowerCase()}.png`

  const TeamCol = ({ name, flag, code }) => (
    <div className="min-w-0 flex flex-col items-center gap-2">
      <img
        src={flagSrc(flag, code)}
        alt={name}
        className="w-14 h-9 rounded-md object-cover ring-1 ring-black/10 dark:ring-white/15 shadow-sm"
        loading="lazy"
        onError={(e) => { e.target.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>' }}
      />
      <p className="text-sm font-bold text-slate-900 dark:text-white truncate max-w-full leading-tight text-center">{name}</p>
    </div>
  )

  const PredictionChip = ({ small }) => (
    prediction ? (
      <span className={`inline-flex items-center gap-1.5 rounded-full font-semibold bg-slate-100 dark:bg-white/[0.07] text-slate-600 dark:text-slate-300 ${small ? 'px-2.5 py-1 text-[11px]' : 'px-3 py-1.5 text-xs'}`}>
        {prediction.use_powerup_x2 && <Zap size={11} className="text-accent fill-current" />}
        Tu predicción <span className="font-black text-slate-900 dark:text-white tabular-nums">{prediction.home_goals_pred}-{prediction.away_goals_pred}</span>
      </span>
    ) : (
      <span className="text-[11px] text-slate-400 italic">No predijiste</span>
    )
  )

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className={`glass-card bg-white dark:bg-white/[0.02] border border-slate-200 dark:border-white/10 shadow-sm dark:shadow-none p-4 md:p-5 relative overflow-hidden ${
        usePowerup ? 'ring-1 ring-accent/50' : isInProgress ? 'ring-1 ring-rose-500/40' : ''
      }`}
    >
      {/* Barra de acento superior (color por estado) */}
      <div className={`absolute top-0 inset-x-0 h-1 bg-gradient-to-r ${accentBar}`} />

      {/* Glow del comodín */}
      {usePowerup && <div className="absolute -top-6 -right-6 w-40 h-40 bg-accent/10 rounded-full blur-3xl pointer-events-none" />}
      {/* Pulso en vivo */}
      {isInProgress && <div className="absolute inset-0 animate-pulse bg-rose-500/[0.02] pointer-events-none" />}

      {/* ═══ Cabecera ═══ */}
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
          {isLocked && !isFinished && !isInProgress ? (
            <span className="flex items-center gap-1 text-[11px] font-semibold text-rose-600 dark:text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded-full">
              <Lock size={11} /> Bloqueado
            </span>
          ) : isInProgress ? (
            <span className="flex items-center gap-1 text-[11px] font-bold text-rose-600 dark:text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" /> EN VIVO
            </span>
          ) : isFinished ? (
            <span className="flex items-center gap-1 text-[11px] font-semibold text-amber-600 dark:text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full">
              <Check size={11} /> Finalizado
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[11px] text-slate-600 dark:text-slate-300 font-medium bg-slate-100 dark:bg-white/5 px-2 py-0.5 rounded-full tabular-nums">
              <Timer size={11} /> {countdown}
            </span>
          )}
        </div>
      </div>

      {/* Contenido */}
      <div className="relative z-10 max-w-lg mx-auto">
        {/* Fecha */}
        <p className="text-center text-[11px] text-slate-500 dark:text-slate-400 font-medium capitalize mb-4">
          {kickoff.toLocaleString('es-CR', { timeZone: 'America/Costa_Rica', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).replace(',', ' ·')}
          {match.city && <span className="opacity-70"> · {match.city}</span>}
        </p>

        {/* ═══ Marcador ═══ */}
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-2 max-w-md mx-auto">
          <TeamCol name={match.home_team} flag={match.home_flag_url} code={match.home_team_code} />

          {/* Centro: marcador o contadores */}
          <div className="flex items-center justify-center pt-1.5">
            {isFinished || isInProgress ? (
              <div className={`flex items-center gap-2.5 font-black font-['Russo_One'] tabular-nums ${isInProgress ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-white'}`}>
                <span className="text-3xl">{match.home_goals_actual ?? 0}</span>
                <span className="text-xl text-slate-300 dark:text-slate-600">:</span>
                <span className="text-3xl">{match.away_goals_actual ?? 0}</span>
              </div>
            ) : (
              <div className="flex items-center justify-center gap-2.5">
                <GoalCounter value={homeGoals} onChange={setHomeGoals} disabled={isLocked} />
                <span className="text-slate-300 dark:text-slate-600 text-2xl font-light">:</span>
                <GoalCounter value={awayGoals} onChange={setAwayGoals} disabled={isLocked} />
              </div>
            )}
          </div>

          <TeamCol name={match.away_team} flag={match.away_flag_url} code={match.away_team_code} />
        </div>

        {/* Penales (en vivo / finalizado) */}
        {(isFinished || isInProgress) && match.goes_to_penalties && (
          <p className="text-center text-xs font-bold text-accent mt-3">
            Gana {match.penalties_winner_real} en penales
            {prediction?.penalties_winner_pred && (
              <span className="block text-[10px] font-normal text-slate-400 mt-0.5">(Predijiste a {prediction.penalties_winner_pred})</span>
            )}
          </p>
        )}

        {/* Fila de contexto: predicción + puntos (jugado / en vivo) */}
        {(isFinished || isInProgress) && (
          <div className="mt-4 flex items-center justify-center gap-2 flex-wrap">
            <PredictionChip small />
            {isFinished && prediction && (
              <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold border ${getPointsStyle(prediction.points_earned)}`}>
                {prediction.points_earned > 0 ? <Check size={13} /> : <X size={13} />}
                +{prediction.points_earned} {prediction.points_earned === 1 ? 'pt' : 'pts'}
              </span>
            )}
          </div>
        )}

        {/* Selector de penales (por jugar, eliminatoria, empate) */}
        {editable && isKnockout && isTiePredicted && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="mt-4 p-3.5 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl"
          >
            <p className="text-[11px] text-center text-slate-500 dark:text-slate-400 mb-2.5 uppercase tracking-wider font-semibold">¿Quién gana en penales?</p>
            <div className="flex gap-2">
              {[match.home_team, match.away_team].map((team) => (
                <button
                  key={team}
                  onClick={() => setPenaltiesWinner(team)}
                  className={`flex-1 py-2.5 px-3 text-xs font-bold rounded-xl transition-all border truncate ${
                    penaltiesWinner === team
                      ? 'gradient-2026 text-white dark:text-slate-900 border-transparent shadow-sm'
                      : 'bg-white dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-300 hover:border-accent/40'
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
                className={`flex items-center gap-1 px-3 py-2.5 rounded-xl text-[11px] font-bold transition-all border ${
                  usePowerup
                    ? 'bg-accent/15 text-accent border-accent/40 shadow-sm shadow-accent/10'
                    : (hasReachedLimit && !prediction?.use_powerup_x2)
                    ? 'bg-slate-100 dark:bg-white/5 text-slate-400 dark:text-slate-600 border-slate-200 dark:border-white/5 cursor-not-allowed opacity-50'
                    : 'bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-white/10 hover:border-accent/30'
                }`}
              >
                <Zap size={14} className={usePowerup ? 'fill-current' : ''} /> x2
              </motion.button>
              <span className="text-[9px] mt-1 text-slate-400 font-medium tracking-wide">{powerupsUsed}/{powerupLimit} usados</span>
            </div>

            <motion.button
              whileTap={{ scale: 0.96 }}
              onClick={handleSave}
              disabled={isLoading || (isKnockout && isTiePredicted && !penaltiesWinner)}
              className="flex-1 py-3 px-4 rounded-xl gradient-2026 text-white dark:text-slate-900 font-bold text-sm shadow-lg shadow-accent/20 hover:shadow-accent/30 transition-all disabled:opacity-40 disabled:shadow-none disabled:bg-slate-200 dark:disabled:bg-slate-700 disabled:text-slate-400 disabled:bg-none"
            >
              {isLoading ? '...' : prediction ? 'Actualizar predicción' : 'Guardar predicción'}
            </motion.button>
          </div>
        )}
      </div>
    </motion.div>
  )
}
