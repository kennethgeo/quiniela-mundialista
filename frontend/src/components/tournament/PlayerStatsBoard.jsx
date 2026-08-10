// Top 5 goleadores y asistencias en vivo del torneo (fuente: UNAFUT para Costa
// Rica — ESPN no expone asistencias ahí). Si el torneo no tiene esa fuente
// configurada, no se renderiza nada.
import { useQuery } from '@tanstack/react-query'
import { Target, Handshake, RefreshCw } from 'lucide-react'
import { fetchPlayerStats } from '../../lib/groups'
import { initialsDataUri, crestOnError } from '../../lib/teamLogo'

export default function PlayerStatsBoard({ tournamentId }) {
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['player_stats', tournamentId],
    queryFn: () => fetchPlayerStats(tournamentId),
    enabled: !!tournamentId,
    staleTime: 1000 * 60 * 5,
  })

  if (isLoading || !data?.source) return null
  if (!data.scorers?.length && !data.assists?.length) return null

  return (
    <div className="glass-card p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-bold font-['Archivo'] text-[13px] text-slate-900 dark:text-[#F3F1EA]">Top del torneo</h3>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          title="Actualizar"
          className="text-slate-400 hover:text-accent transition-colors disabled:opacity-50"
        >
          <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <StatColumn title="Goleadores" icon={Target} rows={data.scorers} unit="G" />
        <StatColumn title="Asistencias" icon={Handshake} rows={data.assists} unit="A" />
      </div>
      <p className="text-[10px] text-slate-400 text-center mt-3">Datos oficiales de UNAFUT</p>
    </div>
  )
}

function StatColumn({ title, icon: Icon, rows, unit }) {
  if (!rows?.length) return null
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        <Icon size={13} className="text-accent" />
        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">{title}</span>
      </div>
      <div className="space-y-1.5">
        {rows.map((r, i) => (
          <div key={`${r.player}-${i}`} className="flex items-center gap-2">
            <span className="w-4 text-[10px] font-bold text-slate-400 tabular-nums shrink-0">{i + 1}</span>
            <img
              src={r.photo || r.team_logo || initialsDataUri(r.player, 32)}
              alt=""
              className="w-6 h-6 rounded-full object-cover shrink-0 bg-slate-100 dark:bg-white/5"
              onError={crestOnError(r.player)}
            />
            <div className="min-w-0 flex-1">
              <p className="text-[11.5px] font-semibold text-slate-800 dark:text-slate-100 truncate leading-tight">{r.player}</p>
              <p className="text-[9.5px] text-slate-400 truncate leading-tight">{r.team}</p>
            </div>
            <span className="text-[12px] font-bold text-slate-900 dark:text-white tabular-nums shrink-0">{r.value}{unit}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
