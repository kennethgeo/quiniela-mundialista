/* Lista de partidos agrupada por jornada */
import { motion } from 'motion/react'
import MatchCard from './MatchCard'

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.06 }
  }
}

export default function MatchList({ matches, predictions, onSavePrediction, isLoading }) {
  // Agrupar por jornada (matchday)
  const grouped = matches.reduce((acc, match) => {
    const key = match.matchday ? `Jornada ${match.matchday}` : match.phase.replace(/_/g, ' ')
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
      {Object.entries(grouped).map(([label, groupMatches]) => (
        <div key={label}>
          {/* Section header */}
          <div className="flex items-center gap-3 mb-4 px-1">
            <div className="w-1.5 h-1.5 rounded-full bg-accent shadow-sm shadow-amber-500/50" />
            <h3 className="text-sm font-bold text-slate-300 uppercase tracking-widest">
              {label}
            </h3>
            <div className="flex-1 h-px bg-gradient-to-r from-white/10 to-transparent" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-4 md:gap-6 w-full">
            {groupMatches.map(match => (
              <MatchCard
                key={match.id}
                match={match}
                prediction={findPrediction(match.id)}
                onSavePrediction={onSavePrediction}
                isLoading={isLoading}
              />
            ))}
          </div>
        </div>
      ))}
    </motion.div>
  )
}
