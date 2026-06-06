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
      <div className="bg-gradient-to-r from-accent/20 via-slate-200/80 dark:via-slate-900/50 to-transparent p-3.5 border-b border-accent/10 flex items-center gap-2">
        <div className="w-6 h-6 rounded-lg bg-accent/20 flex items-center justify-center border border-accent/30 shadow-[0_0_10px_rgba(168,85,247,0.2)]">
          <Trophy size={12} className="text-accent-light" />
        </div>
        <h3 className="text-[12px] font-black text-slate-900 dark:text-white uppercase tracking-widest drop-shadow-md">
          Tabla de Posiciones
        </h3>
      </div>
      
      <div className="overflow-x-auto scrollbar-hide">
        <table className="w-full text-sm text-left whitespace-nowrap">
          <thead className="text-[10px] uppercase text-slate-500 dark:text-slate-400 font-bold bg-slate-100 dark:bg-black/40">
            <tr>
              <th className="px-4 py-3 w-8 text-center">Pos</th>
              <th className="px-3 py-3">Selección</th>
              <th className="px-2 py-3 text-center" title="Partidos Jugados">PJ</th>
              <th className="px-2 py-3 text-center" title="Victorias">G</th>
              <th className="px-2 py-3 text-center" title="Empates">E</th>
              <th className="px-2 py-3 text-center" title="Derrotas">P</th>
              <th className="px-2 py-3 text-center" title="Goles a Favor">GF</th>
              <th className="px-2 py-3 text-center" title="Goles en Contra">GC</th>
              <th className="px-2 py-3 text-center" title="Diferencia de Goles">DG</th>
              <th className="px-4 py-3 text-center text-accent-light bg-accent/5">PTS</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-white/5 bg-white dark:bg-transparent">
            {standings.map((team, index) => {
              // Highlight top 2 (Clasifican)
              const isQualified = index < 2
              return (
                <tr key={team.name} className={`transition-colors relative group ${isQualified ? 'bg-accent/[0.03] hover:bg-accent/[0.08]' : 'hover:bg-slate-50 dark:hover:bg-white/[0.04]'}`}>
                  {isQualified && (
                    <td className="absolute left-0 top-0 bottom-0 w-0.5 bg-accent shadow-[0_0_8px_rgba(168,85,247,0.8)]"></td>
                  )}
                  <td className="px-4 py-3">
                    <span className={`flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-black mx-auto ${
                      isQualified ? 'bg-gradient-to-br from-accent to-purple-600 text-white shadow-lg shadow-purple-500/30' : 'text-slate-500 bg-slate-100 dark:bg-slate-800/50'
                    }`}>
                      {index + 1}
                    </span>
                  </td>
                  <td className="px-3 py-3 font-bold text-slate-900 dark:text-white flex items-center gap-3">
                    <div className="relative">
                      <img src={`https://flagcdn.com/w40/${team.code}.png`} className="w-6 h-4.5 rounded-sm object-cover shadow-md shadow-black/50" alt="" />
                      {isQualified && <div className="absolute inset-0 rounded-sm ring-1 ring-accent/50 pointer-events-none"></div>}
                    </div>
                    <span className="drop-shadow-sm">{team.name}</span>
                  </td>
                  <td className="px-2 py-3 text-center text-slate-700 dark:text-slate-300 font-semibold">{team.pld}</td>
                  <td className="px-2 py-3 text-center text-success/90">{team.w}</td>
                  <td className="px-2 py-3 text-center text-slate-600 dark:text-slate-400">{team.d}</td>
                  <td className="px-2 py-3 text-center text-error/90">{team.l}</td>
                  <td className="px-2 py-3 text-center text-slate-700 dark:text-slate-300">{team.gf}</td>
                  <td className="px-2 py-3 text-center text-slate-700 dark:text-slate-300">{team.ga}</td>
                  <td className={`px-2 py-3 text-center font-bold ${team.gd > 0 ? 'text-success' : team.gd < 0 ? 'text-error' : 'text-slate-500 dark:text-slate-400'}`}>
                    {team.gd > 0 ? `+${team.gd}` : team.gd}
                  </td>
                  <td className={`px-4 py-3 text-center font-black text-lg bg-accent/5 ${isQualified ? 'text-accent-light' : 'text-slate-900 dark:text-white'}`}>
                    {team.pts}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </motion.div>
  )
}
