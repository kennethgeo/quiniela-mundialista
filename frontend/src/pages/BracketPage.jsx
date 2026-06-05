/* Página del Bracket - Fases eliminatorias */
import { GitBranch } from 'lucide-react'
import BracketView from '../components/matches/BracketView'

export default function BracketPage() {
  return (
    <div className="px-4 py-4">
      <div className="flex items-center gap-2 mb-4">
        <GitBranch size={20} className="text-accent" />
        <h1 className="text-lg font-bold text-white">Fases Eliminatorias</h1>
      </div>
      <BracketView />
    </div>
  )
}
