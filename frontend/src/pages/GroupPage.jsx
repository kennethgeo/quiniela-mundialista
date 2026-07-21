// Página de una quiniela (grupo): sus partidos (predecir, scoped al torneo) + tabla.
import { useState, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion } from 'motion/react'
import { ArrowLeft, CalendarDays, ListOrdered, Users, Copy, Check, Trophy, GitBranch, BarChart3, Shield, ScrollText, Loader2, Pencil } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useToast } from '../components/ui/Toast'
import { friendlySaveError } from '../lib/saveError'
import { buildPowerupLimits, powerupKey } from '../lib/powerups'
import { fetchMyGroups, fetchGroupStandings, fetchTeamStandings, acceptGroupRules, setGroupRules } from '../lib/groups'
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
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="mb-4">
        <div className="flex items-center gap-2.5">
          <button onClick={() => navigate('/')}
            className="w-[30px] h-[30px] rounded-[9px] bg-white dark:bg-[#161616] border border-slate-200 dark:border-[#262626] grid place-items-center shrink-0 text-slate-600 dark:text-[#F3F1EA] hover:border-accent transition-colors">
            <ArrowLeft size={15} />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="font-['Archivo'] font-bold text-[15.5px] truncate text-slate-900 dark:text-[#F3F1EA]">{group.name}</h1>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="font-['JetBrains_Mono'] font-bold text-[8.5px] px-[7px] py-0.5 rounded-[20px]"
                style={{ color: isCup ? '#FF7A59' : '#2ED3B7', background: isCup ? 'rgba(255,122,89,.12)' : 'rgba(46,211,183,.12)' }}>
                {isCup ? 'COPA' : 'LIGA'}
              </span>
              <span className="font-['Archivo'] font-semibold text-[10px] text-[var(--text-muted,#8A8A8A)] truncate">{group.tournament_name} · {group.members} miembros</span>
            </div>
          </div>
          <button onClick={copyCode}
            className="shrink-0 flex items-center gap-1.5 font-['JetBrains_Mono'] font-bold text-[10px] text-slate-600 dark:text-[#F3F1EA] bg-white dark:bg-[#161616] border border-slate-200 dark:border-[#262626] rounded-[9px] px-2.5 py-2">
            {copied ? <><Check size={12} className="text-accent" /> COPIADO</> : <>{group.invitation_code} <Copy size={12} /></>}
          </button>
        </div>
      </motion.div>

      {/* Tabs — Partidos y Tabla siempre; Bracket y Torneo solo en copas */}
      <div className="flex gap-1.5 mb-4 overflow-x-auto scrollbar-hide">
        <TabBtn active={tab === 'matches'} onClick={() => setTab('matches')} icon={CalendarDays} label="Partidos" />
        <TabBtn active={tab === 'table'} onClick={() => setTab('table')} icon={ListOrdered} label="Tabla" />
        {!isCup && <TabBtn active={tab === 'teams'} onClick={() => setTab('teams')} icon={Shield} label="Posiciones" />}
        {/* Solo el Mundial tiene bracket dedicado; el resto ve sus fases en Partidos */}
        {tid === 1 && <TabBtn active={tab === 'bracket'} onClick={() => setTab('bracket')} icon={GitBranch} label="Bracket" />}
        <TabBtn active={tab === 'global'} onClick={() => setTab('global')} icon={BarChart3} label="Campeón/Gol" />
        <TabBtn active={tab === 'rules'} onClick={() => setTab('rules')} icon={ScrollText} label="Reglas" />
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
      {tab === 'rules' && (
        <RulesTab group={group} isAdmin={!!group.is_admin}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ['my_groups'] })} showToast={showToast} />
      )}

      {/* Puerta de reglas: hay que aceptarlas para poder usar la quiniela */}
      {group.rules_accepted === false && !!group.rules && (
        <RulesGate group={group}
          onAccepted={() => queryClient.invalidateQueries({ queryKey: ['my_groups'] })}
          onLeave={() => navigate('/')} />
      )}
    </div>
  )
}

/* ---- Reglas ---- */
function RulesGate({ group, onAccepted, onLeave }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const accept = async () => {
    try { setBusy(true); setErr(null); await acceptGroupRules(group.id); onAccepted() }
    catch (e) { setErr(e.message); setBusy(false) }
  }
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      className="fixed inset-0 z-[130] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 320, damping: 28 }}
        className="w-full max-w-[380px] bg-white dark:bg-[#0C0C0C] rounded-[20px] border border-slate-200 dark:border-[#262626] shadow-[0_20px_50px_-20px_rgba(0,0,0,0.6)] overflow-hidden max-h-[88vh] flex flex-col">
        <div className="px-[22px] pt-[22px] pb-2 flex items-center gap-2.5">
          <ScrollText size={18} className="text-accent shrink-0" />
          <h3 className="font-bold font-['Unbounded'] text-[16px] text-slate-900 dark:text-[#F3F1EA]">Reglas de la quiniela</h3>
        </div>
        <p className="px-[22px] text-[11.5px] text-[var(--text-muted,#8A8A8A)] mb-2">Antes de entrar a <b className="text-slate-700 dark:text-[#F3F1EA]">{group.name}</b> tenés que leer y aceptar sus reglas.</p>
        <div className="px-[22px] overflow-y-auto flex-1">
          <div className="whitespace-pre-wrap text-[13px] leading-relaxed text-slate-700 dark:text-[#e5e3dc] bg-slate-50 dark:bg-[#161616] border border-slate-200 dark:border-[#262626] rounded-xl p-3.5">{group.rules}</div>
        </div>
        {err && <p className="px-[22px] text-[12px] text-[#FF7A59] mt-2">{err}</p>}
        <div className="p-[22px] pt-3 flex flex-col gap-2">
          <button onClick={accept} disabled={busy}
            className="w-full flex items-center justify-center gap-2 rounded-xl py-3.5 font-['Archivo'] font-bold text-[13.5px] text-[#06231d] bg-gradient-to-r from-[#2ED3B7] to-[#26bfa5] disabled:opacity-60">
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Acepto las reglas
          </button>
          <button onClick={onLeave} className="w-full text-center text-[12px] font-semibold text-[var(--text-muted,#8A8A8A)] py-1">No acepto · salir</button>
        </div>
      </motion.div>
    </motion.div>
  )
}

function RulesTab({ group, isAdmin, onSaved, showToast }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(group.rules || '')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    try {
      setBusy(true)
      await setGroupRules(group.id, text)
      showToast('Reglas actualizadas. Los demás miembros deberán aceptarlas de nuevo.', 'success', 5000)
      setEditing(false)
      onSaved()
    } catch (e) { showToast(e.message, 'error', 6000) } finally { setBusy(false) }
  }

  return (
    <div className="rounded-2xl bg-white dark:bg-[#161616] border border-slate-200 dark:border-[#262626] p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <ScrollText size={18} className="text-accent" />
          <h3 className="font-bold font-['Unbounded'] text-slate-900 dark:text-[#F3F1EA] text-[15px]">Reglas</h3>
        </div>
        {isAdmin && !editing && (
          <button onClick={() => { setText(group.rules || ''); setEditing(true) }}
            className="flex items-center gap-1.5 text-[12px] font-bold text-accent bg-accent/10 border border-accent/25 rounded-lg px-2.5 py-1.5">
            <Pencil size={13} /> Editar
          </button>
        )}
      </div>

      {editing ? (
        <>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={12}
            className="w-full bg-slate-50 dark:bg-[#0C0C0C] border border-slate-200 dark:border-[#262626] rounded-xl p-3.5 text-[13px] leading-relaxed text-slate-800 dark:text-[#F3F1EA] focus:outline-none focus:border-accent resize-none" />
          <div className="flex gap-2 mt-3">
            <button onClick={() => setEditing(false)} className="flex-1 py-2.5 rounded-xl font-bold text-sm text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-[#262626]">Cancelar</button>
            <button onClick={save} disabled={busy}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl font-bold text-sm text-[#06231d] bg-gradient-to-r from-[#2ED3B7] to-[#26bfa5] disabled:opacity-60">
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} Guardar
            </button>
          </div>
          <p className="text-[11px] text-[var(--text-muted,#8A8A8A)] mt-2">Al guardar, los demás miembros deberán volver a aceptar las reglas.</p>
        </>
      ) : (
        <div className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-slate-700 dark:text-[#e5e3dc]">{group.rules || 'Esta quiniela no tiene reglas definidas.'}</div>
      )}
    </div>
  )
}

function TabBtn({ active, onClick, icon: Icon, label }) {
  return (
    <button onClick={onClick}
      className={`shrink-0 flex items-center gap-1.5 px-3.5 py-2 rounded-[10px] font-['Archivo'] font-bold text-[11.5px] whitespace-nowrap transition-all ${
        active
          ? 'bg-accent text-[#06231d]'
          : 'bg-white dark:bg-[#161616] text-[var(--text-muted,#8A8A8A)] border border-slate-200 dark:border-[#262626]'}`}>
      <Icon size={14} /> {label}
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
                    <td className="text-right font-extrabold font-['Unbounded'] text-slate-900 dark:text-white px-2.5 tabular-nums">{r.points}</td>
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
  const rankColor = (i) => i === 0 ? '#E8B75A' : i === 1 ? '#C7CDD6' : i === 2 ? '#FF7A59' : 'var(--text-muted,#8A8A8A)'
  return (
    <div className="space-y-1.5">
      {rows.map((r, i) => (
        <div key={r.user_id}
          className="flex items-center gap-3 px-3 py-2.5 rounded-xl border"
          style={r.is_me
            ? { background: 'rgba(46,211,183,.08)', borderColor: '#2ED3B7' }
            : { background: 'transparent', borderColor: 'transparent' }}>
          <span className="w-[22px] text-center font-['JetBrains_Mono'] font-bold text-[12px]" style={{ color: rankColor(i) }}>{i + 1}</span>
          <div className="w-8 h-8 rounded-full grid place-items-center text-[11px] font-bold font-['Archivo'] text-white overflow-hidden shrink-0"
            style={{ background: r.is_me ? 'linear-gradient(135deg,#2ED3B7,#1a8f7c)' : 'linear-gradient(135deg,#5a2d8a,#3a1c5c)' }}>
            {r.avatar_url ? <img src={r.avatar_url} alt="" className="w-full h-full object-cover" /> : (r.display_name?.[0] || '?').toUpperCase()}
          </div>
          <span className="flex-1 font-['Archivo'] font-semibold text-[13px] text-slate-800 dark:text-[#F3F1EA] truncate">{r.display_name}{r.is_me && <span className="text-accent font-bold"> (vos)</span>}</span>
          <span className="font-['JetBrains_Mono'] font-bold text-[14px] text-slate-900 dark:text-[#F3F1EA]">{r.points}</span>
        </div>
      ))}
    </div>
  )
}
