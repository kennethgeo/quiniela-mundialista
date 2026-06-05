/* Página de partidos - Fase de Grupos */
import { Calendar } from 'lucide-react'
import GroupStage from '../components/matches/GroupStage'

export default function MatchesPage() {
  return (
    <div className="px-4 py-4">
      <div className="flex items-center gap-2 mb-4">
        <Calendar size={20} className="text-accent" />
        <h1 className="text-lg font-bold text-white">Fase de Grupos</h1>
      </div>
      <GroupStage />
    </div>
  )
}
