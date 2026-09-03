import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AlarmClock, ArrowRight, CheckCircle2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { buildPendingPredictions } from '../../lib/pendingPredictions'
import { matchRoundLabel, timeUntilDeadline } from '../../lib/matchStatus'
import MatchStatusBadge from '../ui/MatchStatusBadge'
import { EmptyState, ErrorState } from '../ui/StatePanel'

const MATCH_FIELDS = 'id,tournament_id,home_team,away_team,home_team_code,away_team_code,home_flag_url,away_flag_url,kickoff_at,status,stage,matchday,phase'

async function fetchPending(groups, userId) {
  const active = groups.filter((group) => group.tournament_status !== 'finished')
  if (!active.length || !userId) return []

  const tournamentIds = [...new Set(active.map((group) => group.tournament_id))]
  const leagueIds = active.map((group) => group.id)
  const closesAfter = new Date(Date.now() + 15 * 60 * 1000).toISOString()
  const { data: matches, error: matchesError } = await supabase
    .from('matches')
    .select(MATCH_FIELDS)
    .in('tournament_id', tournamentIds)
    .eq('status', 'pending')
    .gt('kickoff_at', closesAfter)
    .order('kickoff_at', { ascending: true })
  if (matchesError) throw matchesError
  if (!matches?.length) return []

  const { data: predictions, error: predictionsError } = await supabase
    .from('predictions')
    .select('league_id,match_id')
    .eq('user_id', userId)
    .in('league_id', leagueIds)
    .in('match_id', matches.map((match) => match.id))
  if (predictionsError) throw predictionsError

  return buildPendingPredictions({ groups: active, matches, predictions })
}

function destination(item) {
  const query = new URLSearchParams({ tab: 'matches', j: matchRoundLabel(item) })
  return `/q/${item.league_id}?${query}`
}

export default function PendingPredictions({ groups = [], userId }) {
  const navigate = useNavigate()
  const activeIds = useMemo(
    () => groups.filter((group) => group.tournament_status !== 'finished').map((group) => group.id).sort().join(','),
    [groups],
  )
  const query = useQuery({
    queryKey: ['pending-predictions', userId, activeIds],
    queryFn: () => fetchPending(groups, userId),
    enabled: !!userId && !!activeIds,
    staleTime: 30_000,
    refetchInterval: 30_000,
  })

  if (!activeIds || !userId) return null
  const pending = query.data || []

  return (
    <section className="mb-6" aria-labelledby="pending-title">
      <div className="mb-2.5 flex items-center justify-between px-0.5">
        <div className="flex items-center gap-2">
          <AlarmClock size={15} className="text-[#FF7A59]" aria-hidden="true" />
          <h2 id="pending-title" className="font-['Archivo'] text-[13px] font-bold text-slate-900 dark:text-[#F3F1EA]">
            Me falta predecir
          </h2>
        </div>
        {!query.isLoading && !query.isError && pending.length > 0 && (
          <span className="rounded-full bg-[#FF7A59]/12 px-2 py-1 font-['JetBrains_Mono'] text-[9px] font-bold text-[#FF7A59]">
            {pending.length} {pending.length === 1 ? 'PENDIENTE' : 'PENDIENTES'}
          </span>
        )}
      </div>

      {query.isLoading ? (
        <div className="h-28 animate-pulse rounded-2xl bg-slate-100 dark:bg-white/[0.04]" aria-label="Cargando predicciones pendientes" />
      ) : query.isError ? (
        <ErrorState compact description="Tus quinielas siguen disponibles. Probá cargar este resumen otra vez." onRetry={() => query.refetch()} />
      ) : pending.length === 0 ? (
        <EmptyState compact icon={CheckCircle2} title="Estás al día" description="No tenés partidos abiertos sin predicción." />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-[#262626] dark:bg-[#161616]">
          {pending.slice(0, 5).map((item) => (
            <button key={`${item.league_id}-${item.id}`} onClick={() => navigate(destination(item))}
              className="flex w-full items-center gap-3 border-b border-slate-100 px-4 py-3 text-left transition-colors last:border-0 hover:bg-slate-50 dark:border-white/5 dark:hover:bg-white/[0.03]">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-['Archivo'] text-[12.5px] font-bold text-slate-900 dark:text-[#F3F1EA]">
                    {item.home_team} <span className="text-[var(--text-muted,#8A8A8A)]">vs</span> {item.away_team}
                  </span>
                  <MatchStatusBadge match={item} className="shrink-0" />
                </div>
                <p className="mt-1 truncate font-['JetBrains_Mono'] text-[9px] text-[var(--text-muted,#8A8A8A)]">
                  {item.league_name} · cierra en {timeUntilDeadline(item.kickoff_at)}
                </p>
              </div>
              <ArrowRight size={15} className="shrink-0 text-[#FF7A59]" aria-hidden="true" />
            </button>
          ))}
          {pending.length > 5 && (
            <button onClick={() => navigate(destination(pending[5]))}
              className="w-full px-4 py-2.5 text-center text-[11px] font-bold text-[#FF7A59]">
              Ver {pending.length - 5} más
            </button>
          )}
        </div>
      )}
    </section>
  )
}
