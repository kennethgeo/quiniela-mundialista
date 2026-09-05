import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AlarmClock, ArrowRight, CheckCircle2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { buildPendingPredictions } from '../../lib/pendingPredictions'
import { matchRoundLabel, matchStatus, timeUntilDeadline } from '../../lib/matchStatus'
import Button from '../ui/Button'
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
  const [league, setLeague] = useState('')
  const [visibleCount, setVisibleCount] = useState(5)
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 15000)
    return () => clearInterval(timer)
  }, [])
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
  const activeGroups = groups.filter((group) => group.tournament_status !== 'finished')
  const selectedLeague = activeGroups.some((group) => group.id === league) ? league : ''
  const pending = (query.data || []).filter((item) =>
    (!selectedLeague || item.league_id === selectedLeague) && matchStatus(item, now).canPredict)

  return (
    <section aria-labelledby="pending-title">
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

      {activeGroups.length > 1 && (
        <div className="mb-3">
          <label htmlFor="pending-league" className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Filtrar por quiniela</label>
          <select id="pending-league" value={selectedLeague}
            onChange={(event) => { setLeague(event.target.value); setVisibleCount(5) }}
            className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 focus-visible:outline-accent dark:border-[#303030] dark:bg-[#161616] dark:text-[#F3F1EA]">
            <option value="">Todas mis quinielas</option>
            {activeGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
          </select>
        </div>
      )}

      {query.isLoading ? (
        <div className="h-28 animate-pulse rounded-2xl bg-slate-100 dark:bg-white/[0.04]" aria-label="Cargando predicciones pendientes" />
      ) : query.isError ? (
        <ErrorState compact description="Tus quinielas siguen disponibles. Probá cargar este resumen otra vez." onRetry={() => query.refetch()} />
      ) : pending.length === 0 ? (
        <EmptyState compact icon={CheckCircle2} title="Estás al día" description="No tenés partidos abiertos sin predicción." />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-[#262626] dark:bg-[#161616]">
          {pending.slice(0, visibleCount).map((item) => (
            <button key={`${item.league_id}-${item.id}`} onClick={() => navigate(destination(item))}
              className="flex min-h-16 w-full items-center gap-3 border-b border-slate-100 px-4 py-3 text-left transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent last:border-0 hover:bg-slate-50 dark:border-white/5 dark:hover:bg-white/[0.03]">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="break-words font-['Archivo'] text-sm font-bold text-slate-900 dark:text-[#F3F1EA]">
                    {item.home_team} <span className="text-[var(--text-muted,#8A8A8A)]">vs</span> {item.away_team}
                  </span>
                  <MatchStatusBadge match={item} now={now} className="shrink-0" />
                </div>
                <p className="mt-1 break-words text-xs text-slate-500 dark:text-slate-400">
                  {item.league_name} · cierra en {timeUntilDeadline(item.kickoff_at, now)}
                </p>
              </div>
              <ArrowRight size={15} className="shrink-0 text-[#FF7A59]" aria-hidden="true" />
            </button>
          ))}
          {pending.length > visibleCount && (
            <Button variant="quiet" onClick={() => setVisibleCount((count) => count + 10)} className="w-full rounded-none">
              Ver {Math.min(pending.length - visibleCount, 10)} más
            </Button>
          )}
          {visibleCount > 5 && pending.length > 5 && (
            <Button variant="quiet" onClick={() => setVisibleCount(5)} className="w-full rounded-none">Mostrar menos</Button>
          )}
        </div>
      )}
    </section>
  )
}
