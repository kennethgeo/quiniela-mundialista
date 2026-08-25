/* Lista de partidos agrupada por jornada */
import { motion } from 'motion/react'
import { ListChecks } from 'lucide-react'
import { powerupKey } from '../../lib/powerups'
import MatchCard from './MatchCard'

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.06 }
  }
}

/* onPredecirJornada es OPCIONAL: solo GroupPage lo pasa. Las otras vistas que
   usan MatchList (TodayMatches, etc.) no tienen el contexto de quiniela que
   hace falta para guardar un lote, así que ahí el botón sencillamente no
   aparece en vez de aparecer roto. */
export default function MatchList({ matches, predictions, onSavePrediction, isLoading, powerupLimit = 0, powerupLimits = null, powerupUsage = {}, powerupCredits = {}, onPredecirJornada = null }) {
  // Agrupar por jornada (matchday)
  const grouped = matches.reduce((acc, match) => {
    // Fase real de ESPN (Jornada N / Octavos / Liguilla…) si existe; si no, jornada o phase.
    const key = match.stage || (match.matchday ? `Jornada ${match.matchday}` : match.phase.replace(/_/g, ' '))
    if (!acc[key]) acc[key] = []
    acc[key].push(match)
    return acc
  }, {})

  // Buscar predicción del usuario para un partido
  const findPrediction = (matchId) => {
    return predictions?.find(p => p.match_id === matchId)
  }

  return (
    <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-8">
      {Object.entries(grouped).map(([label, groupMatches]) => {
        // La llave puede ser 'groups_1', 'round_of_32', etc.
        const matchExample = groupMatches[0]
        const phase = matchExample?.phase || 'groups'
        const matchday = matchExample?.matchday
        const limitKey = powerupKey(phase, matchday)

        // Límite efectivo = cupo base + créditos arrastrados de partidos
        // cancelados (uso extra ganado por votación del grupo). El cupo base
        // puede venir como número flat por liga (powerupLimit, GroupPage) o
        // como mapa por fase/jornada (powerupLimits, vistas multi-torneo
        // como TodayMatches) — se usa el que corresponda.
        const credit = powerupCredits[limitKey] || 0
        const baseLimit = powerupLimits && powerupLimits[limitKey] != null ? powerupLimits[limitKey] : powerupLimit
        const limit = baseLimit + credit;

        // Comodines usados en TODA la fase/jornada (no solo los partidos visibles
        // por el filtro de grupo). Si no llega el conteo global, se cae al local.
        const powerupsUsed = powerupUsage[limitKey] ?? groupMatches.filter(m => findPrediction(m.id)?.use_powerup_x2).length;

        const hasReachedLimit = powerupsUsed >= limit;

        // Editable = todavia se puede predecir (falta mas de 15 min para el saque).
        // Es el mismo corte que aplica MatchCard.
        const ahora = Date.now();
        const editables = groupMatches.filter((m) => {
          if (['finished', 'in_progress', 'cancelled', 'canceled', 'postponed', 'suspended'].includes(m.status)) return false;
          const iso = m.kickoff_at.endsWith('Z') || m.kickoff_at.includes('+') ? m.kickoff_at : `${m.kickoff_at}Z`;
          return new Date(iso).getTime() - ahora > 15 * 60 * 1000;
        });
        
        return (
        <div key={label}>
          {/* Section header + comodines ×2 disponibles en la jornada */}
          <div className="flex items-center justify-between gap-2 mb-2.5 px-0.5">
            <h3 className="font-['JetBrains_Mono'] font-bold text-[9.5px] uppercase tracking-[0.18em] text-[var(--text-muted,#8A8A8A)]">
              {label}
            </h3>
            <div className="flex items-center gap-1.5 shrink-0">
              {limit > 0 && (
                <span className="shrink-0 flex items-center gap-1 font-['JetBrains_Mono'] font-bold text-[9px] px-2 py-0.5 rounded-[20px]"
                  style={{ color: hasReachedLimit ? '#FF7A59' : '#2ED3B7', background: hasReachedLimit ? 'rgba(255,122,89,.12)' : 'rgba(46,211,183,.12)' }}
                  title={credit > 0 ? `Incluye ${credit} comodín arrastrado de un partido cancelado` : 'Comodines ×2 disponibles en esta jornada'}>
                  ×2 · {Math.max(0, limit - powerupsUsed)}/{limit}
                  {credit > 0 && <span className="ml-0.5" title="Comodín arrastrado">🎁</span>}
                </span>
              )}
              {/* Solo con 2+ partidos abiertos: para uno solo, la tarjeta ya alcanza. */}
              {onPredecirJornada && editables.length >= 2 && (
                <button
                  onClick={() => onPredecirJornada({
                    label,
                    matches: editables,
                    limit,
                    // Comodines ya puestos en partidos de la jornada que NO se
                    // pueden editar (cerrados): cuentan para el cupo igual.
                    usadosFuera: powerupsUsed - editables.filter((m) => findPrediction(m.id)?.use_powerup_x2).length,
                  })}
                  className="shrink-0 flex items-center gap-1 font-['JetBrains_Mono'] font-bold text-[9px] px-2 py-0.5 rounded-[20px] text-accent"
                  style={{ background: 'rgba(46,211,183,.12)' }}>
                  <ListChecks size={10} /> LLENAR
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 w-full">
            {groupMatches.map(match => (
              <MatchCard
                key={match.id}
                match={match}
                prediction={findPrediction(match.id)}
                onSavePrediction={onSavePrediction}
                isLoading={isLoading}
                hasReachedLimit={hasReachedLimit}
                powerupsUsed={powerupsUsed}
                powerupLimit={limit}
              />
            ))}
          </div>
        </div>
      );
      })}
      {/* Spacer para que el BottomNav no tape el último partido en móvil */}
      <div className="h-32 w-full shrink-0 md:hidden pointer-events-none" />
    </motion.div>
  )
}

