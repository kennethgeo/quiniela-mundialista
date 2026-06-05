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
    <motion.div variants={containerVariants} initial="hidden" animate="visible">
      {Object.entries(grouped).map(([label, groupMatches]) => (
        <div key={label} className="mb-6">
          <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3 px-1">
            {label}
          </h3>
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
      ))}
    </motion.div>
  )
}
