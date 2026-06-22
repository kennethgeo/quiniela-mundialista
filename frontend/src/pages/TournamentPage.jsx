/* Página de Torneo: posiciones por grupo, goleadores y tarjetas */
import { useState, useEffect } from 'react'
import { motion } from 'motion/react'
import { BarChart3, Goal, RectangleVertical, Zap } from 'lucide-react'
import { supabase } from '../lib/supabase'
import GroupStandings from '../components/matches/GroupStandings'
import PowerupUsage from '../components/tournament/PowerupUsage'
import LoadingSpinner from '../components/ui/LoadingSpinner'

const GROUPS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L']

export default function TournamentPage() {
  const [matches, setMatches] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('posiciones')
  const [group, setGroup] = useState('A')

  useEffect(() => {
    const load = async () => {
      try {
        const { data, error } = await supabase
          .from('matches')
          .select('id,phase,group_name,home_team,away_team,home_team_code,away_team_code,home_goals_actual,away_goals_actual,status,events_json')
          .order('kickoff_at', { ascending: true })
        if (error) throw error
        setMatches(data || [])
      } catch (err) {
        console.error('Error cargando torneo:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  // Agregar goleadores y tarjetas desde events_json
  const scorersMap = {}
  const cardsMap = {}
  matches.forEach((m) => {
    ;(m.events_json || []).forEach((e) => {
      const isAway = e.side === 'away'
      const team = isAway ? m.away_team : m.home_team
      const code = isAway ? m.away_team_code : m.home_team_code
      const player = (e.player || '—').trim()
      const type = e.type || 'goal' // los goles antiguos no tienen 'type'
      const key = `${player}|${team}`
      if (type === 'goal' && !e.own_goal) {
        scorersMap[key] = scorersMap[key] || { player, team, code, goals: 0 }
        scorersMap[key].goals += 1
      } else if (type === 'yellow' || type === 'red') {
        cardsMap[key] = cardsMap[key] || { player, team, code, yellow: 0, red: 0 }
        cardsMap[key][type] += 1
      }
    })
  })
  const topScorers = Object.values(scorersMap).sort((a, b) => b.goals - a.goals || a.player.localeCompare(b.player))
  const cardList = Object.values(cardsMap).sort((a, b) => b.red - a.red || b.yellow - a.yellow || a.player.localeCompare(b.player))

  const groupsWithData = GROUPS.filter((g) => matches.some((m) => m.phase === 'groups' && m.group_name === g))
  const groupMatches = matches.filter((m) => m.phase === 'groups' && m.group_name === group)

  const TABS = [
    { id: 'posiciones', label: 'Posiciones', icon: BarChart3 },
    { id: 'goleadores', label: 'Goleadores', icon: Goal },
    { id: 'tarjetas', label: 'Tarjetas', icon: RectangleVertical },
    { id: 'comodines', label: 'Comodines', icon: Zap },
  ]

  return (
    <div className="px-4 py-5 relative">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-3 mb-5">
        <div className="w-10 h-10 rounded-2xl gradient-2026 flex items-center justify-center shadow-lg shadow-accent/20">
          <BarChart3 size={20} className="text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">Torneo</h1>
          <p className="text-xs text-slate-500">Posiciones · goleadores · tarjetas</p>
        </div>
      </motion.div>

      {/* Tabs */}
      <div className="flex gap-2 mb-5 overflow-x-auto scrollbar-hide">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`shrink-0 flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-bold transition-all ${
              tab === id ? 'gradient-2026 text-white shadow-lg shadow-accent/20' : 'glass-strong text-slate-600 dark:text-slate-400 bg-white dark:bg-transparent'
            }`}
          >
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      {loading ? (
        <LoadingSpinner />
      ) : tab === 'posiciones' ? (
        <>
          {/* Selector de grupo */}
          <div className="flex gap-2 overflow-x-auto pb-3 scrollbar-hide mb-3">
            {(groupsWithData.length ? groupsWithData : GROUPS).map((g) => (
              <button
                key={g}
                onClick={() => setGroup(g)}
                className={`shrink-0 w-10 h-10 rounded-xl font-bold text-sm transition-all ${
                  group === g ? 'gradient-2026 text-white shadow-md' : 'glass-strong text-slate-500 bg-white dark:bg-transparent'
                }`}
              >
                {g}
              </button>
            ))}
          </div>
          {groupMatches.length ? (
            <GroupStandings matches={groupMatches} />
          ) : (
            <div className="glass-card p-8 text-center text-slate-500 text-sm">No hay datos para el Grupo {group}</div>
          )}
        </>
      ) : tab === 'goleadores' ? (
        <StatList
          empty="Aún no hay goles registrados"
          rows={topScorers}
          render={(s, i) => (
            <Row key={`${s.player}-${s.team}`} index={i} code={s.code} player={s.player} team={s.team}>
              <span className="flex items-center gap-1.5 text-base font-black text-slate-900 dark:text-white tabular-nums">
                {s.goals} <Goal size={15} className="text-accent" />
              </span>
            </Row>
          )}
        />
      ) : tab === 'comodines' ? (
        <PowerupUsage />
      ) : (
        <StatList
          empty="Aún no hay tarjetas registradas"
          rows={cardList}
          render={(c, i) => (
            <Row key={`${c.player}-${c.team}`} index={i} code={c.code} player={c.player} team={c.team}>
              <span className="flex items-center gap-2 text-sm font-bold tabular-nums">
                {c.yellow > 0 && <span className="flex items-center gap-0.5 text-amber-500"><span className="w-3 h-4 rounded-[2px] bg-amber-400 inline-block" /> {c.yellow}</span>}
                {c.red > 0 && <span className="flex items-center gap-0.5 text-rose-500"><span className="w-3 h-4 rounded-[2px] bg-rose-500 inline-block" /> {c.red}</span>}
              </span>
            </Row>
          )}
        />
      )}
    </div>
  )
}

function StatList({ rows, render, empty }) {
  if (!rows.length) return <div className="glass-card p-8 text-center text-slate-500 text-sm">{empty}</div>
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-card divide-y divide-slate-100 dark:divide-white/5 overflow-hidden">
      {rows.map(render)}
    </motion.div>
  )
}

function Row({ index, code, player, team, children }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className="w-5 text-center text-xs font-bold text-slate-400 tabular-nums shrink-0">{index + 1}</span>
      <img src={`https://flagcdn.com/w40/${(code || 'xx').toLowerCase()}.png`} alt="" className="w-6 h-4 rounded-sm object-cover shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">{player}</p>
        <p className="text-[11px] text-slate-500 truncate">{team}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}
