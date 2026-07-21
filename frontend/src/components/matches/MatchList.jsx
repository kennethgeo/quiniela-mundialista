/* Lista de partidos agrupada por jornada */
import { motion } from 'motion/react'
import { powerupKey } from '../../lib/powerups'
import MatchCard from './MatchCard'

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.06 }
  }
}

export default function MatchList({ matches, predictions, onSavePrediction, isLoading, powerupLimits = {}, powerupUsage = {} }) {
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

        const limit = powerupLimits[limitKey] ?? 0; // Por defecto 0 si no se ha cargado o no existe

        // Comodines usados en TODA la fase/jornada (no solo los partidos visibles
        // por el filtro de grupo). Si no llega el conteo global, se cae al local.
        const powerupsUsed = powerupUsage[limitKey] ?? groupMatches.filter(m => findPrediction(m.id)?.use_powerup_x2).length;

        const hasReachedLimit = powerupsUsed >= limit;
        
        return (
        <div key={label}>
          {/* Section header */}
          <h3 className="font-['JetBrains_Mono'] font-bold text-[9.5px] uppercase tracking-[0.18em] text-[var(--text-muted,#8A8A8A)] mb-2.5 px-0.5">
            {label}
          </h3>

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

