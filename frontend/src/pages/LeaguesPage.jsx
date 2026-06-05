/* Página de Ligas Privadas */
import { Users } from 'lucide-react'
import LeagueList from '../components/leagues/LeagueList'

export default function LeaguesPage() {
  return (
    <div className="px-4 py-4">
      <div className="flex items-center gap-2 mb-4">
        <Users size={20} className="text-accent" />
        <h1 className="text-lg font-bold text-white">Mis Ligas</h1>
      </div>
      <LeagueList />
    </div>
  )
}
