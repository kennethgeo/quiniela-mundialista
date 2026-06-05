/* Tarjeta de partido con predicción y resultado (Motor Avanzado) */
import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Lock, Clock, Check, X, Zap } from 'lucide-react'
import { format, differenceInMinutes, differenceInSeconds } from 'date-fns'
import { es } from 'date-fns/locale'
import GoalCounter from './GoalCounter'

export default function MatchCard({ match, prediction, onSavePrediction, isLoading }) {
  // Estado local basado en props
  const [predictionType, setPredictionType] = useState(prediction?.prediction_type || 'Marcador')
  const [homeGoals, setHomeGoals] = useState(prediction?.home_goals_pred ?? 0)
  const [awayGoals, setAwayGoals] = useState(prediction?.away_goals_pred ?? 0)
  const [winnerSolo, setWinnerSolo] = useState(null) // 'home', 'away', 'tie' para modalidad Solo Ganador
  const [usePowerup, setUsePowerup] = useState(prediction?.use_powerup_x2 || false)
  const [penaltiesWinner, setPenaltiesWinner] = useState(prediction?.penalties_winner_pred || '')
  
  const [countdown, setCountdown] = useState('')

  const kickoff = new Date(match.kickoff_at)
  const now = new Date()
  const minutesUntil = differenceInMinutes(kickoff, now)
  const isLocked = minutesUntil <= 15
  const isFinished = match.status === 'finished'
  const isInProgress = match.status === 'in_progress'
  const isKnockout = match.phase !== 'groups'

  // Determinar si hay empate en la predicción actual para mostrar penales
  const isTiePredicted = predictionType === 'Marcador' 
    ? (homeGoals === awayGoals && homeGoals !== null)
    : winnerSolo === 'tie'

  // Sincronizar ganador solo basado en los goles al cargar
  useEffect(() => {
    if (prediction && prediction.prediction_type === 'Solo_Ganador') {
      if (prediction.home_goals_pred > prediction.away_goals_pred) setWinnerSolo('home')
      else if (prediction.away_goals_pred > prediction.home_goals_pred) setWinnerSolo('away')
      else setWinnerSolo('tie')
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
    
    let hG = homeGoals
    let aG = awayGoals
    
    // Si es solo ganador, convertimos a números de goles falsos para el backend
    if (predictionType === 'Solo_Ganador') {
      if (winnerSolo === 'home') { hG = 1; aG = 0; }
      else if (winnerSolo === 'away') { hG = 0; aG = 1; }
      else if (winnerSolo === 'tie') { hG = 0; aG = 0; }
      else return; // No ha seleccionado nada
    }

    onSavePrediction({
      match_id: match.id,
      prediction_type: predictionType,
      home_goals_pred: hG,
      away_goals_pred: aG,
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
      className={`glass p-4 mb-4 relative overflow-hidden ${usePowerup ? 'ring-1 ring-accent shadow-[0_0_15px_rgba(45,212,191,0.2)]' : ''}`}
    >
      {/* Indicador de Powerup Visual (Background glow) */}
      {usePowerup && (
        <div className="absolute top-0 right-0 w-32 h-32 bg-accent/10 rounded-full blur-3xl pointer-events-none" />
      )}

      {/* Encabezado: fase, fecha, countdown */}
      <div className="flex items-center justify-between mb-3 text-xs text-slate-400 relative z-10">
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

      <p className="text-xs text-slate-500 mb-4 text-center relative z-10">
        {format(kickoff, "d 'de' MMMM · HH:mm", { locale: es })}
        {match.venue && ` · ${match.city}`}
      </p>

      {/* Modalidad Toggle (Si no está finalizado/bloqueado) */}
      {!isLocked && !isFinished && !isInProgress && (
        <div className="flex justify-center mb-6 relative z-10">
          <div className="bg-black/30 p-1 rounded-xl flex gap-1">
            <button
              onClick={() => setPredictionType('Marcador')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                predictionType === 'Marcador' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Marcador Exacto
            </button>
            <button
              onClick={() => setPredictionType('Solo_Ganador')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                predictionType === 'Solo_Ganador' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Solo Ganador
            </button>
          </div>
        </div>
      )}

      {/* Equipos y predicción */}
      <div className="flex items-center justify-between gap-2 relative z-10">
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

        {/* Input area */}
        <div className="flex flex-col items-center gap-2 px-2">
          {isFinished || isInProgress ? (
            <div className="text-center">
              {prediction && (
                <div className="flex items-center justify-center gap-1 mb-1">
                  <p className="text-[10px] text-slate-500">Tu predicción</p>
                  {prediction.use_powerup_x2 && <Zap size={10} className="text-accent" />}
                </div>
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
              {prediction && prediction.prediction_type === 'Marcador' && (
                <p className="text-xs text-slate-400 mt-1">
                  ({prediction.home_goals_pred} - {prediction.away_goals_pred})
                </p>
              )}
              {prediction && prediction.prediction_type === 'Solo_Ganador' && (
                <p className="text-xs text-slate-400 mt-1">
                  ({prediction.home_goals_pred > prediction.away_goals_pred ? match.home_team : 
                    prediction.away_goals_pred > prediction.home_goals_pred ? match.away_team : 'Empate'})
                </p>
              )}
            </div>
          ) : (
            <AnimatePresence mode="wait">
              {predictionType === 'Marcador' ? (
                <motion.div
                  key="marcador"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className="flex items-center gap-3"
                >
                  <GoalCounter value={homeGoals} onChange={setHomeGoals} disabled={isLocked} />
                  <span className="text-slate-500 text-lg font-bold">:</span>
                  <GoalCounter value={awayGoals} onChange={setAwayGoals} disabled={isLocked} />
                </motion.div>
              ) : (
                <motion.div
                  key="solo_ganador"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className="flex flex-col gap-2 w-full min-w-[120px]"
                >
                  <button
                    onClick={() => setWinnerSolo('home')}
                    className={`py-1.5 text-xs font-bold rounded-lg border transition-colors ${
                      winnerSolo === 'home' ? 'bg-accent/20 border-accent/50 text-accent' : 'glass border-white/5 text-slate-400'
                    }`}
                  >
                    Local
                  </button>
                  <button
                    onClick={() => setWinnerSolo('tie')}
                    className={`py-1.5 text-xs font-bold rounded-lg border transition-colors ${
                      winnerSolo === 'tie' ? 'bg-accent/20 border-accent/50 text-accent' : 'glass border-white/5 text-slate-400'
                    }`}
                  >
                    Empate
                  </button>
                  <button
                    onClick={() => setWinnerSolo('away')}
                    className={`py-1.5 text-xs font-bold rounded-lg border transition-colors ${
                      winnerSolo === 'away' ? 'bg-accent/20 border-accent/50 text-accent' : 'glass border-white/5 text-slate-400'
                    }`}
                  >
                    Visitante
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
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

      {/* Penales Selector (Si es eliminatoria y hay empate) */}
      {!isFinished && !isInProgress && isKnockout && isTiePredicted && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="mt-4 p-3 bg-black/20 rounded-xl border border-white/5"
        >
          <p className="text-xs text-center text-slate-400 mb-2">¿Quién gana en penales?</p>
          <div className="flex gap-2">
            <button
              onClick={() => setPenaltiesWinner(match.home_team)}
              className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-colors border ${
                penaltiesWinner === match.home_team ? 'bg-accent/20 border-accent/50 text-accent' : 'bg-white/5 border-transparent text-slate-300 hover:bg-white/10'
              }`}
            >
              {match.home_team}
            </button>
            <button
              onClick={() => setPenaltiesWinner(match.away_team)}
              className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-colors border ${
                penaltiesWinner === match.away_team ? 'bg-accent/20 border-accent/50 text-accent' : 'bg-white/5 border-transparent text-slate-300 hover:bg-white/10'
              }`}
            >
              {match.away_team}
            </button>
          </div>
        </motion.div>
      )}

      {/* Info Penales (Si finalizó en empate) */}
      {(isFinished || isInProgress) && match.goes_to_penalties && (
        <div className="mt-4 text-center">
          <p className="text-xs font-semibold text-accent">
            Gana {match.penalties_winner_real} en Penales
          </p>
          {prediction && prediction.penalties_winner_pred && (
             <p className="text-[10px] text-slate-400 mt-0.5">
               (Tú predijiste a {prediction.penalties_winner_pred})
             </p>
          )}
        </div>
      )}

      {/* Footer: Powerup y Guardar / Resultados */}
      <div className="mt-5 flex items-center justify-between relative z-10">
        {isFinished && prediction ? (
          <div className="w-full text-center">
            <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border ${getPointsStyle(prediction.points_earned)}`}>
              {prediction.points_earned > 0 ? <Check size={14} /> : <X size={14} />}
              {prediction.points_earned} {prediction.points_earned === 1 ? 'punto' : 'puntos'}
            </div>
          </div>
        ) : !isLocked && !isFinished && !isInProgress ? (
          <>
            {/* Toggle Powerup */}
            <button
              type="button"
              onClick={() => setUsePowerup(!usePowerup)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all border ${
                usePowerup ? 'bg-accent/20 text-accent border-accent/50' : 'glass text-slate-400 border-white/5 hover:text-white'
              }`}
            >
              <Zap size={14} className={usePowerup ? 'fill-current' : ''} />
              x2
            </button>

            {/* Botón Guardar */}
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={handleSave}
              disabled={isLoading || (predictionType === 'Solo_Ganador' && !winnerSolo) || (isKnockout && isTiePredicted && !penaltiesWinner)}
              className="flex-1 ml-3 py-2 rounded-xl bg-accent text-primary font-bold text-sm hover:opacity-90 transition-opacity disabled:opacity-50 disabled:bg-slate-700 disabled:text-slate-400"
            >
              {isLoading ? '...' : prediction ? 'Actualizar' : 'Guardar'}
            </motion.button>
          </>
        ) : null}
      </div>
    </motion.div>
  )
}
