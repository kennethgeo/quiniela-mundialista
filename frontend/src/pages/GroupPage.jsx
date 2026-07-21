// Página de una quiniela (grupo): sus partidos (predecir, scoped al torneo) + tabla.
import { useState, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion } from 'motion/react'
import { ArrowLeft, CalendarDays, ListOrdered, Users, Copy, Check, Trophy, GitBranch, BarChart3, Shield } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useToast } from '../components/ui/Toast'
import { friendlySaveError } from '../lib/saveError'
import { buildPowerupLimits, powerupKey } from '../lib/powerups'
import { fetchMyGroups, fetchGroupStandings, fetchTeamStandings } from '../lib/groups'
import { resolveKnockoutTeams } from '../lib/bracketResolver'
import MatchList from '../components/matches/MatchList'
import BracketView from '../components/matches/BracketView'
import TournamentGlobalCard from '../components/tournament/TournamentGlobalCard'
import LoadingSpinner from '../components/ui/LoadingSpinner'

export default function GroupPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { showToast } = useToast()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState('matches') // 'matches' | 'table'
  const [copied, setCopied] = useState(false)

  // Grupo (de mis grupos)
  const { data: groups = [], isLoading: lg } = useQuery({ queryKey: ['my_groups'], queryFn: fetchMyGroups })
  const group = groups.find((g) => g.id === id)
  const tid = group?.tournament_id
  const isCup = group?.tournament_kind === 'cup'

  const { data: matches = [], isLoading: lm } = useQuery({
    queryKey: ['tournament_matches', tid],
    enabled: !!tid,
    queryFn: async () => {
      const { data, error } = await supabase.from('matches').select('*').eq('tournament_id', tid).order('kickoff_at', { ascending: true })
      if (error) throw error
      return data || []
    },
  })

  const { data: predictions = [] } = useQuery({
    queryKey: ['predictions', profile?.id],
    enabled: !!profile?.id,
    queryFn: async () => {
      const { data, error } = await supabase.from('predictions').select('*').eq('user_id', profile.id)
      if (error) throw error
      return data || []
    },
  })

  const { data: powerupLimits = {} } = useQuery({
    queryKey: ['powerup_limits'],
    queryFn: async () => buildPowerupLimits((await supabase.from('powerup_limits').select('*')).data),
  })

  const saveMutation = useMutation({
    mutationFn: async (prediction) => {
      const { data, error } = await supabase.from('predictions')
        .upsert({ ...prediction, user_id: profile.id }, { onConflict: 'user_id, match_id' }).select()
      if (error) throw error
      return data?.[0] || prediction
    },
    onSuccess: (newPred) => {
      queryClient.setQueryData(['predictions', profile?.id], (old = []) => {
        const i = old.findIndex((p) => p.match_id === newPred.match_id)
        if (i >= 0) { const u = [...old]; u[i] = { ...u[i], ...newPred }; return u }
        return [...old, newPred]
      })
    },
    onError: (err) => showToast(friendlySaveError(err), 'error', 6000),
  })

  // Resolver nombres de eliminatoria (para copas tipo Mundial con slots).
  const resolved = useMemo(() => {
    if (!matches.length) return []
    const ko = new Map(resolveKnockoutTeams(matches).map((m) => [m.id, m]))
    return matches.map((m) => {
      const r = ko.get(m.id)
      if (!r) return m
      return {
        ...m,
        home_team: r.home_team_resolved || m.home_team,
        away_team: r.away_team_resolved || m.away_team,
        home_team_code: r.home_team_code_resolved || m.home_team_code,
        away_team_code: r.away_team_code_resolved || m.away_team_code,
      }
    })
  }, [matches])

  const teams = useMemo(() => {
    const s = new Set()
    resolved.forEach((m) => { if (m.home_team) s.add(m.home_team); if (m.away_team) s.add(m.away_team) })
    return [...s].sort((a, b) => a.localeCompare(b))
  }, [resolved])

  const powerupUsage = useMemo(() => {
    const o = {}
    resolved.forEach((m) => {
      if (predictions.find((p) => p.match_id === m.id)?.use_powerup_x2) {
        const k = powerupKey(m.phase, m.matchday)
        o[k] = (o[k] || 0) + 1
      }
    })
    return o
  }, [resolved, predictions])

  if (lg) return <LoadingSpinner />
  if (!group) {
    return (
      <div className="max-w-3xl mx-auto text-center py-16">
        <p className="text-slate-500 dark:text-slate-400 text-sm">No encontramos esta quiniela (¿saliste del grupo?).</p>
        <button onClick={() => navigate('/')} className="mt-4 text-accent font-bold text-sm">← Volver</button>
      </div>
    )
  }

  const copyCode = () => { navigator.clipboard?.writeText(group.invitation_code); setCopied(true); setTimeout(() => setCopied(false), 1500) }

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="mb-5">
        <button onClick={() => navigate('/')} className="flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400 mb-3 hover:text-accent">
          <ArrowLeft size={15} /> Mis quinielas
        </button>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-extrabold tracking-tight font-['Sora'] text-slate-900 dark:text-white truncate">{group.name}</h1>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full text-accent bg-accent/10 border border-accent/25">{group.tournament_name}</span>
              <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-white/5">{group.tournament_kind === 'cup' ? '🏆 Copa' : '📊 Liga'}</span>
              <span className="text-[11px] text-slate-400 flex items-center gap-1"><Users size={12} />{group.members}</span>
            </div>
          </div>
          <button onClick={copyCode} className="shrink-0 flex items-center gap-1.5 text-xs font-bold text-slate-500 dark:text-slate-300 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg px-2.5 py-2">
            {copied ? <><Check size={13} className="text-emerald-500" /> Copiado</> : <><Copy size={13} /> {group.invitation_code}</>}
          </button>
        </div>
      </motion.div>

      {/* Tabs — Partidos y Tabla siempre; Bracket y Torneo solo en copas */}
      <div className="flex gap-2 mb-5 overflow-x-auto scrollbar-hide">
        <TabBtn active={tab === 'matches'} onClick={() => setTab('matches')} icon={CalendarDays} label="Partidos" />
        <TabBtn active={tab === 'table'} onClick={() => setTab('table')} icon={ListOrdered} label="Tabla" />
        {!isCup && <TabBtn active={tab === 'teams'} onClick={() => setTab('teams')} icon={Shield} label="Posiciones" />}
        {/* Solo el Mundial tiene bracket dedicado; el resto ve sus fases en Partidos */}
        {tid === 1 && <TabBtn active={tab === 'bracket'} onClick={() => setTab('bracket')} icon={GitBranch} label="Bracket" />}
        <TabBtn active={tab === 'global'} onClick={() => setTab('global')} icon={BarChart3} label="Campeón/Gol" />
      </div>

      {tab === 'matches' && (
        lm ? <LoadingSpinner /> : resolved.length === 0 ? (
          <EmptyMatches kind={group.tournament_kind} />
        ) : (
          <MatchList
            matches={resolved}
            predictions={predictions}
            onSavePrediction={(p) => saveMutation.mutate(p)}
            isLoading={saveMutation.isPending}
            powerupLimits={powerupLimits}
            powerupUsage={powerupUsage}
          />
        )
      )}

      {tab === 'table' && <StandingsTab leagueId={group.id} />}
      {tab === 'teams' && <TeamStandingsTab tournamentId={tid} />}
      {tab === 'bracket' && tid === 1 && <BracketView />}
      {tab === 'global' && <TournamentGlobalCard tournamentId={tid} teams={teams} />}
    </div>
  )
}

function TabBtn({ active, onClick, icon: Icon, label }) {
  return (
    <button onClick={onClick}
      className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold transition-all ${
        active ? 'bg-accent text-slate-950 shadow-lg shadow-accent/20' : 'glass-strong text-slate-600 dark:text-slate-400 bg-white dark:bg-transparent'}`}>
      <Icon size={15} /> {label}
    </button>
  )
}

function EmptyMatches({ kind }) {
  return (
    <div className="glass-card p-8 text-center">
      <Trophy size={26} className="text-slate-400 mx-auto mb-3" />
      <p className="text-slate-500 text-sm">
        Esta quiniela aún no tiene partidos.{' '}
        {kind === 'cup' ? 'Se cargarán cuando arranque el torneo.' : 'El admin los sincroniza desde ESPN o los carga a mano.'}
      </p>
    </div>
  )
}

function TeamStandingsTab({ tournamentId }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['team_standings', tournamentId],
    queryFn: () => fetchTeamStandings(tournamentId),
    staleTime: 1000 * 60 * 10,
  })
  if (isLoading) return <LoadingSpinner />
  if (isError || !data?.groups?.length) {
    return <p className="text-sm text-slate-400 italic text-center py-8">ESPN aún no tiene la tabla de este torneo.</p>
  }
  return (
    <div className="space-y-5">
      {data.groups.map((g, gi) => (
        <div key={gi} className="glass-card overflow-hidden">
          {g.name && data.groups.length > 1 && (
            <div className="px-4 py-2.5 text-xs font-bold text-slate-500 uppercase tracking-wide border-b border-slate-100 dark:border-white/5">{g.name}</div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wide text-slate-400 border-b border-slate-100 dark:border-white/5">
                  <th className="text-left font-semibold py-2 pl-3">#</th>
                  <th className="text-left font-semibold py-2">Equipo</th>
                  <th className="font-semibold py-2 px-1.5">PJ</th>
                  <th className="font-semibold py-2 px-1.5 hidden xs:table-cell">G</th>
                  <th className="font-semibold py-2 px-1.5 hidden xs:table-cell">E</th>
                  <th className="font-semibold py-2 px-1.5 hidden xs:table-cell">P</th>
                  <th className="font-semibold py-2 px-1.5">DG</th>
                  <th className="font-extrabold py-2 px-2.5 text-right">Pts</th>
                </tr>
              </thead>
              <tbody>
                {g.rows.map((r) => (
                  <tr key={r.team} className="border-b border-slate-50 dark:border-white/[0.03] last:border-0">
                    <td className="py-2 pl-3 text-slate-400 tabular-nums w-6">{r.rank}</td>
                    <td className="py-2">
                      <div className="flex items-center gap-2 min-w-0">
                        {r.logo && <img src={r.logo} alt="" className="w-5 h-5 object-contain shrink-0" />}
                        <span className="font-semibold text-slate-800 dark:text-slate-100 truncate">{r.team}</span>
                      </div>
                    </td>
                    <td className="text-center tabular-nums text-slate-500 px-1.5">{r.played}</td>
                    <td className="text-center tabular-nums text-slate-500 px-1.5 hidden xs:table-cell">{r.wins}</td>
                    <td className="text-center tabular-nums text-slate-500 px-1.5 hidden xs:table-cell">{r.draws}</td>
                    <td className="text-center tabular-nums text-slate-500 px-1.5 hidden xs:table-cell">{r.losses}</td>
                    <td className="text-center tabular-nums text-slate-500 px-1.5">{r.gd > 0 ? `+${r.gd}` : r.gd}</td>
                    <td className="text-right font-extrabold font-['Sora'] text-slate-900 dark:text-white px-2.5 tabular-nums">{r.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      <p className="text-[11px] text-slate-400 text-center">Tabla oficial vía ESPN{data.season ? ` · temporada ${data.season}` : ''}</p>
    </div>
  )
}

function StandingsTab({ leagueId }) {
  const { data: rows, isLoading } = useQuery({
    queryKey: ['group_standings', leagueId],
    queryFn: () => fetchGroupStandings(leagueId),
  })
  if (isLoading) return <LoadingSpinner />
  if (!rows?.length) return <p className="text-sm text-slate-400 italic text-center py-8">Sin miembros todavía.</p>
  return (
    <div className="glass-card overflow-hidden">
      {rows.map((r, i) => (
        <div key={r.user_id} className={`flex items-center gap-3 px-4 py-3 border-b border-slate-100 dark:border-white/5 last:border-0 ${r.is_me ? 'bg-accent/[0.07]' : ''}`}>
          <span className={`w-7 h-7 rounded-lg grid place-items-center font-bold font-['Sora'] text-[13px] ${i === 0 ? 'bg-amber-300 text-amber-900' : i === 1 ? 'bg-slate-300 text-slate-700' : i === 2 ? 'bg-orange-300 text-orange-900' : 'bg-slate-100 dark:bg-white/5 text-slate-500'}`}>{i + 1}</span>
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-accent/30 to-violet-500/30 grid place-items-center text-xs font-bold overflow-hidden shrink-0">
            {r.avatar_url ? <img src={r.avatar_url} alt="" className="w-full h-full object-cover" /> : (r.display_name?.[0] || '?').toUpperCase()}
          </div>
          <span className="flex-1 text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{r.display_name}{r.is_me && <span className="text-accent text-xs font-bold"> · vos</span>}</span>
          <span className="font-extrabold font-['Sora'] text-slate-900 dark:text-white">{r.points}</span>
        </div>
      ))}
    </div>
  )
}
