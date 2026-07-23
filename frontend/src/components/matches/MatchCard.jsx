/* Tarjeta de partido — rediseño minimalista */
import { useState, useEffect } from 'react'
import { motion } from 'motion/react'
import { Lock, Check, X, Zap, Timer, Info } from 'lucide-react'
import { differenceInMinutes, differenceInSeconds } from 'date-fns'
import { useNavigate } from 'react-router-dom'
import GoalCounter from './GoalCounter'
import { crestOnError } from '../../lib/teamLogo'

const flagSrc = (url, code) => url || `https://flagcdn.com/w80/${(code || 'xx').toLowerCase()}.png`

// Componente a nivel de módulo (no se recrea en cada render → banderas no se recargan)
// Layout horizontal estilo Tico Games: escudo + nombre (o espejado a la derecha).
function Team({ name, flag, code, align = 'left' }) {
  const isLogo = !!flag
  const img = (
    <img
      src={flagSrc(flag, code)}
      alt={name}
      className={isLogo
        ? 'w-7 h-7 object-contain shrink-0'
        : 'w-7 h-5 rounded object-cover ring-1 ring-black/5 dark:ring-white/10 shrink-0'}
      loading="lazy"
      onError={crestOnError(name)}
    />
  )
  const label = <span className="font-semibold text-[12.5px] text-slate-800 dark:text-[#F3F1EA] truncate leading-tight">{name}</span>
  return align === 'right'
    ? <div className="flex-1 flex items-center gap-2 justify-end min-w-0 text-right">{label}{img}</div>
    : <div className="flex-1 flex items-center gap-2 min-w-0">{img}{label}</div>
}

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

  // Comodines ×2 restantes en la jornada (en vivo: cuenta el toggle local aún sin guardar).
  const savedThis = prediction?.use_powerup_x2 ? 1 : 0
  const usedLive = (powerupsUsed || 0) - savedThis + (usePowerup ? 1 : 0)
  const remaining = Math.max(0, (powerupLimit || 0) - usedLive)
  // Neón del comodín: la tarjeta brilla en el color del ×2 cuando está activo.
  const powerupOn = editable ? usePowerup : !!prediction?.use_powerup_x2

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

  // Etiqueta y color del badge de puntos (finalizado)
  const pointsChip = (points) => {
    if (points >= 3) return { color: '#2ED3B7', bg: 'rgba(46,211,183,.12)', label: `+${points} · EXACTO` }
    if (points >= 1) return { color: '#E8B75A', bg: 'rgba(232,183,90,.14)', label: `+${points} · ACIERTO` }
    return { color: '#8A8A8A', bg: 'rgba(138,138,138,.14)', label: '+0' }
  }

  // Meta (fecha/contexto) en mono minúsculo
  const contextLabel = match.stage || (match.group_name ? `Grupo ${match.group_name}` : match.phase.replace(/_/g, ' '))
  const dateLabel = kickoff.toLocaleDateString('es', { weekday: 'short' }).replace('.', '').toUpperCase()
    + ' ' + kickoff.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', hour12: false })

  // Color del borde de la tarjeta según estado
  const borderStyle = isInProgress
    ? { borderColor: '#FF4D6D' }
    : (isLocked && !isFinished)
    ? { borderColor: '#3a3020' }
    : undefined

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{
        opacity: 1, y: 0,
        boxShadow: powerupOn
          ? ['0 0 0px rgba(46,211,183,0)', '0 0 16px 1px rgba(46,211,183,0.55)', '0 0 0px rgba(46,211,183,0)']
          : '0 0 0px rgba(46,211,183,0)',
      }}
      transition={{
        opacity: { duration: 0.3 }, y: { duration: 0.3 },
        boxShadow: powerupOn ? { duration: 1.8, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.4 },
      }}
      style={{ ...(borderStyle || {}), ...(powerupOn ? { borderColor: '#2ED3B7' } : {}) }}
      className="relative overflow-hidden rounded-[14px] bg-white dark:bg-[#161616] border border-slate-200 dark:border-[#262626] px-3.5 pt-3.5 pb-3"
    >
      {isInProgress && <div className="absolute top-0 left-0 right-0 h-0.5" style={{ background: 'linear-gradient(90deg,#FF4D6D,transparent)' }} />}

      {/* Cabecera: estado / contexto + badge */}
      <div className="flex items-center justify-between gap-2 mb-3">
        {isInProgress ? (
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[#FF4D6D] animate-pulse" />
            <span className="font-['JetBrains_Mono'] font-bold text-[8.5px] tracking-[0.1em] text-[#FF4D6D]">EN VIVO</span>
          </span>
        ) : (
          <span className="font-['JetBrains_Mono'] font-medium text-[9px] tracking-[0.06em] text-[var(--text-muted,#8A8A8A)] truncate">
            {isFinished ? `${contextLabel} · FINAL` : dateLabel}
          </span>
        )}

        <div className="shrink-0 flex items-center gap-1.5">
          {isLocked && !isFinished && !isInProgress && (
            <span className="font-['Archivo'] font-bold text-[8.5px] px-2 py-[3px] rounded-[20px]" style={{ color: '#E8B75A', background: 'rgba(232,183,90,.14)' }}>⏳ Cierra pronto</span>
          )}
          {(isFinished || isInProgress) && match.goes_to_penalties && (
            <span className="font-['Archivo'] font-bold text-[8.5px] px-2 py-[3px] rounded-[20px]" style={{ color: '#E8B75A', background: 'rgba(232,183,90,.14)' }}>PENALES</span>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); navigate(`/match/${match.id}`) }}
            className="text-slate-400 hover:text-accent transition-colors"
            title="Ver detalles y predicciones de la liga"
          >
            <Info size={13} />
          </button>
        </div>
      </div>

      {/* Equipos + marcador/predicción */}
      <div className="flex items-center gap-2.5">
        <Team name={match.home_team} flag={match.home_flag_url} code={match.home_team_code} align="left" />

        <div className="shrink-0 flex items-center justify-center">
          {isFinished || isInProgress ? (
            <div className="flex items-center gap-1.5">
              <div className={`w-8 h-9 rounded-lg grid place-items-center font-['JetBrains_Mono'] font-bold text-[17px] tabular-nums bg-slate-100 dark:bg-[#0C0C0C] border border-slate-200 dark:border-[#262626] ${isInProgress ? 'text-[#FF4D6D]' : 'text-slate-900 dark:text-[#F3F1EA]'}`}>{match.home_goals_actual ?? 0}</div>
              <span className="text-[var(--text-muted,#8A8A8A)] font-bold">-</span>
              <div className={`w-8 h-9 rounded-lg grid place-items-center font-['JetBrains_Mono'] font-bold text-[17px] tabular-nums bg-slate-100 dark:bg-[#0C0C0C] border border-slate-200 dark:border-[#262626] ${isInProgress ? 'text-[#FF4D6D]' : 'text-slate-900 dark:text-[#F3F1EA]'}`}>{match.away_goals_actual ?? 0}</div>
            </div>
          ) : isLocked ? (
            <span className="font-['JetBrains_Mono'] font-bold text-[13px] text-[var(--text-muted,#8A8A8A)]">vs</span>
          ) : (
            <div className="flex items-center justify-center gap-1.5">
              <GoalCounter value={homeGoals} onChange={setHomeGoals} disabled={isLocked} />
              <span className="text-[var(--text-muted,#8A8A8A)] font-bold">:</span>
              <GoalCounter value={awayGoals} onChange={setAwayGoals} disabled={isLocked} />
            </div>
          )}
        </div>

        <Team name={match.away_team} flag={match.away_flag_url} code={match.away_team_code} align="right" />
      </div>

      {/* Goleadores (resumen) */}
      {(isFinished || isInProgress) && Array.isArray(match.events_json) && match.events_json.some((e) => (e.type || 'goal') === 'goal') && (
        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 mt-3 text-[11px] text-slate-500 dark:text-slate-400">
          {['home', 'away'].map((side) => (
            <div key={side} className={`space-y-0.5 ${side === 'away' ? 'text-right' : ''}`}>
              {match.events_json
                .filter((e) => e.side === side && (e.type || 'goal') === 'goal')
                .map((e, i) => (
                  <div key={i} className={`flex items-center gap-1 min-w-0 ${side === 'away' ? 'flex-row-reverse' : ''}`}>
                    <span className="shrink-0 text-[10px]">⚽</span>
                    <span className="truncate">{e.player || 'Gol'}</span>
                    <span className="text-slate-400 tabular-nums shrink-0">{e.minute}</span>
                  </div>
                ))}
            </div>
          ))}
        </div>
      )}

      {/* Penales — texto de resultado */}
      {(isFinished || isInProgress) && match.goes_to_penalties && (
        <p className="text-center font-['JetBrains_Mono'] font-bold text-[9px] text-[#E8B75A] mt-2">
          {match.penalties_winner_real} avanza por penales
        </p>
      )}

      {/* Selector de penales (por jugar) */}
      {editable && isKnockout && isTiePredicted && (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="mt-3 p-3 bg-slate-50 dark:bg-[#0C0C0C] rounded-xl">
          <p className="text-[11px] text-center text-[var(--text-muted,#8A8A8A)] mb-2 font-medium">¿Quién gana en penales?</p>
          <div className="flex gap-2">
            {[match.home_team, match.away_team].map((team) => (
              <button
                key={team}
                onClick={() => setPenaltiesWinner(team)}
                className={`flex-1 py-2 px-3 text-xs font-semibold rounded-lg transition-colors truncate ${
                  penaltiesWinner === team ? 'bg-accent text-[#06231d]' : 'bg-white dark:bg-[#161616] text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-[#262626] hover:border-accent/40'
                }`}
              >
                {team}
              </button>
            ))}
          </div>
        </motion.div>
      )}

      {/* Footer editable: comodín + guardar + cuenta regresiva */}
      {editable && (
        <div className="mt-3 flex items-center gap-2">
          <motion.button
            type="button"
            whileTap={{ scale: 0.92 }}
            onClick={() => {
              if (!usePowerup && hasReachedLimit && !prediction?.use_powerup_x2) return
              setUsePowerup(!usePowerup)
            }}
            disabled={!usePowerup && hasReachedLimit && !prediction?.use_powerup_x2}
            title={`Comodín ×2 · quedan ${remaining} de ${powerupLimit} en esta jornada`}
            className={`shrink-0 flex items-center gap-1.5 px-2.5 py-2 rounded-[9px] border transition-colors ${
              (hasReachedLimit && !usePowerup && !prediction?.use_powerup_x2) ? 'opacity-50 cursor-not-allowed' : ''
            } bg-slate-50 dark:bg-[#0C0C0C] border-slate-200 dark:border-[#262626]`}
          >
            <span className="relative w-6 h-3.5 rounded-[8px] transition-colors" style={{ background: usePowerup ? '#2ED3B7' : 'var(--toggle-off,#262626)' }}>
              <span className="absolute top-0.5 w-2.5 h-2.5 rounded-full transition-all" style={{ [usePowerup ? 'right' : 'left']: '2px', background: usePowerup ? '#06231d' : '#8A8A8A' }} />
            </span>
            <span className="font-['Archivo'] font-bold text-[9.5px] text-slate-700 dark:text-[#F3F1EA]">×2</span>
            {powerupLimit > 0 && (
              <span className="font-['JetBrains_Mono'] font-bold text-[8.5px] tabular-nums leading-none px-1 py-0.5 rounded-md"
                style={{ color: remaining > 0 ? '#2ED3B7' : '#FF7A59', background: remaining > 0 ? 'rgba(46,211,183,.12)' : 'rgba(255,122,89,.14)' }}
                title={`${remaining} comodines ×2 disponibles en la jornada`}>
                {remaining}
              </span>
            )}
          </motion.button>

          <button
            onClick={handleSave}
            disabled={isLoading || (isKnockout && isTiePredicted && !penaltiesWinner)}
            className="flex-1 rounded-[9px] py-2.5 text-center font-['Archivo'] font-bold text-[11.5px] text-[#06231d] bg-gradient-to-r from-[#2ED3B7] to-[#26bfa5] active:scale-[0.98] transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isLoading ? '…' : prediction ? 'Actualizar predicción' : 'Guardar predicción'}
          </button>

          {countdown && <span className="shrink-0 font-['JetBrains_Mono'] font-bold text-[8px] text-[var(--text-muted,#8A8A8A)]">{countdown}</span>}
        </div>
      )}

      {/* Footer bloqueado */}
      {isLocked && !isFinished && !isInProgress && (
        <div className="mt-3 pt-2.5 border-t border-slate-200 dark:border-[#262626] flex items-center justify-between">
          <span className="font-['Archivo'] font-semibold text-[9.5px] text-[var(--text-muted,#8A8A8A)]">🔒 Cierra en {countdown}</span>
          {prediction && (
            <span className="font-['Archivo'] font-semibold text-[9.5px] text-slate-700 dark:text-[#F3F1EA] flex items-center gap-1">
              {prediction.use_powerup_x2 && <Zap size={10} className="text-accent fill-current" />}
              Tu pick: {prediction.home_goals_pred}–{prediction.away_goals_pred}
            </span>
          )}
        </div>
      )}

      {/* Footer finalizado / en vivo: predicción + puntos */}
      {(isFinished || isInProgress) && (
        <div className="mt-3 pt-2.5 border-t border-slate-200 dark:border-[#262626] flex items-center justify-between gap-2">
          <span className="font-['Archivo'] font-semibold text-[9.5px] text-[var(--text-muted,#8A8A8A)] flex items-center gap-1 min-w-0">
            {prediction?.use_powerup_x2 && <Zap size={10} className="text-accent fill-current shrink-0" />}
            {prediction
              ? <>Tu predicción · <span className="text-slate-700 dark:text-[#F3F1EA] font-bold">{prediction.home_goals_pred}–{prediction.away_goals_pred}</span></>
              : <span className="italic">No predijiste</span>}
          </span>
          {isFinished && prediction && (() => {
            const c = pointsChip(prediction.points_earned)
            return <span className="shrink-0 font-['JetBrains_Mono'] font-bold text-[9.5px] px-2.5 py-1 rounded-[20px]" style={{ color: c.color, background: c.bg }}>{c.label}</span>
          })()}
        </div>
      )}
    </motion.div>
  )
}
