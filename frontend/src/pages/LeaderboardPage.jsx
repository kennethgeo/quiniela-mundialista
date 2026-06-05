/* Página de Ranking */
import { Trophy } from 'lucide-react'
import Leaderboard from '../components/leaderboard/Leaderboard'

export default function LeaderboardPage() {
  return (
    <div className="px-4 py-4">
      <div className="flex items-center gap-2 mb-4">
        <Trophy size={20} className="text-accent" />
        <h1 className="text-lg font-bold text-white">Ranking</h1>
      </div>
      <Leaderboard />
    </div>
  )
}
