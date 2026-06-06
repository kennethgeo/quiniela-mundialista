import { motion } from 'motion/react'
import { Trophy } from 'lucide-react'

export default function GroupStandings({ matches }) {
  // Calcular posiciones
  const teams = {}

  matches.forEach(match => {
    // Inicializar equipos
    if (!teams[match.home_team]) {
      teams[match.home_team] = { name: match.home_team, code: match.home_team_code, pld: 0, pts: 0, gf: 0, ga: 0, gd: 0, w: 0, d: 0, l: 0 }
    }
    if (!teams[match.away_team]) {
      teams[match.away_team] = { name: match.away_team, code: match.away_team_code, pld: 0, pts: 0, gf: 0, ga: 0, gd: 0, w: 0, d: 0, l: 0 }
    }

    // Solo contabilizar partidos finalizados
    if (match.status === 'finished' && match.home_goals_actual !== null && match.away_goals_actual !== null) {
      teams[match.home_team].pld += 1
      teams[match.away_team].pld += 1

      teams[match.home_team].gf += match.home_goals_actual
      teams[match.home_team].ga += match.away_goals_actual
      teams[match.away_team].gf += match.away_goals_actual
      teams[match.away_team].ga += match.home_goals_actual

      teams[match.home_team].gd = teams[match.home_team].gf - teams[match.home_team].ga
      teams[match.away_team].gd = teams[match.away_team].gf - teams[match.away_team].ga

      if (match.home_goals_actual > match.away_goals_actual) {
        teams[match.home_team].pts += 3
        teams[match.home_team].w += 1
        teams[match.away_team].l += 1
      } else if (match.home_goals_actual < match.away_goals_actual) {
        teams[match.away_team].pts += 3
        teams[match.away_team].w += 1
        teams[match.home_team].l += 1
      } else {
        teams[match.home_team].pts += 1
        teams[match.away_team].pts += 1
        teams[match.home_team].d += 1
        teams[match.away_team].d += 1
      }
    }
  })

  // Convertir a array y ordenar (PTS, GD, GF)
  const standings = Object.values(teams).sort((a, b) => {
    if (b.pts !== a.pts) return b.pts - a.pts
    if (b.gd !== a.gd) return b.gd - a.gd
    if (b.gf !== a.gf) return b.gf - a.gf
    return a.name.localeCompare(b.name)
  })

  if (standings.length === 0) return null

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card mb-8 overflow-hidden relative"
    >
      <div className="bg-slate-900/50 p-3 border-b border-white/5 flex items-center gap-2">
        <Trophy size={14} className="text-amber-400" />
        <h3 className="text-[11px] font-bold text-slate-300 uppercase tracking-widest">
          Tabla de Posiciones
        </h3>
      </div>
      
      <div className="overflow-x-auto scrollbar-hide">
        <table className="w-full text-sm text-left whitespace-nowrap">
          <thead className="text-[10px] uppercase text-slate-500 font-bold bg-white/[0.02]">
            <tr>
              <th className="px-4 py-2 w-8">#</th>
              <th className="px-2 py-2">Equipo</th>
              <th className="px-2 py-2 text-center">PJ</th>
              <th className="px-2 py-2 text-center">GF</th>
              <th className="px-2 py-2 text-center">GC</th>
              <th className="px-2 py-2 text-center">DG</th>
              <th className="px-4 py-2 text-center text-white">PTS</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {standings.map((team, index) => {
              // Highlight top 2
              const isQualified = index < 2
              return (
                <tr key={team.name} className="hover:bg-white/[0.02] transition-colors">
                  <td className="px-4 py-2.5">
                    <span className={`flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold ${
                      isQualified ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' : 'text-slate-500'
                    }`}>
                      {index + 1}
                    </span>
                  </td>
                  <td className="px-2 py-2.5 font-bold text-white flex items-center gap-2">
                    <img src={`https://flagcdn.com/w20/${team.code}.png`} className="w-4 h-3 rounded-sm object-cover" alt="" />
                    {team.name}
                  </td>
                  <td className="px-2 py-2.5 text-center text-slate-400">{team.pld}</td>
                  <td className="px-2 py-2.5 text-center text-slate-400">{team.gf}</td>
                  <td className="px-2 py-2.5 text-center text-slate-400">{team.ga}</td>
                  <td className="px-2 py-2.5 text-center text-slate-400 font-medium">
                    {team.gd > 0 ? `+${team.gd}` : team.gd}
                  </td>
                  <td className="px-4 py-2.5 text-center font-black text-white">{team.pts}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </motion.div>
  )
}
