// Página de una quiniela (grupo): sus partidos (predecir, scoped al torneo) + tabla.
import { useState, useMemo, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'motion/react'
import { ArrowLeft, CalendarDays, ListOrdered, Copy, Check, Trophy, GitBranch, BarChart3, Shield, ScrollText, Loader2, Pencil, Lock, Trash2, AlertTriangle, Vote, ThumbsUp, ThumbsDown, X, Home, ChevronRight, Target, Gift, MessageCircle, LayoutGrid, Zap } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useToast } from '../components/ui/Toast'
import { friendlySaveError } from '../lib/saveError'
import { powerupKey } from '../lib/powerups'
import { fetchMyGroups, fetchGroupStandings, fetchTeamStandings, acceptGroupRules, setGroupRules, setGroupScoring, deleteGroup, proposeRuleChange, castRuleVote, cancelRuleProposal, fetchLeagueProposals, fetchMyPowerupCredits, setGroupExtras } from '../lib/groups'
import { initialsDataUri, crestOnError } from '../lib/teamLogo'
import { fetchLeagueMedals, recomputeLeagueBadges } from '../lib/medals'
import { MedalStrip } from '../components/medals/BadgeShowcase'
import { resolveKnockoutTeams } from '../lib/bracketResolver'
import MatchList from '../components/matches/MatchList'
import BracketView from '../components/matches/BracketView'
import TournamentGlobalCard from '../components/tournament/TournamentGlobalCard'
import PlayerStatsBoard from '../components/tournament/PlayerStatsBoard'
import AllGlobalPicks from '../components/tournament/AllGlobalPicks'
import HistorialTab from '../components/tournament/HistorialTab'
import CaraACara from '../components/tournament/CaraACara'
import HistorialAjustes from '../components/tournament/HistorialAjustes'
import PozoYPagos from '../components/tournament/PozoYPagos'
import MiembrosYAdmins from '../components/tournament/MiembrosYAdmins'
import JornadasYRachas from '../components/tournament/JornadasYRachas'
import PredecirJornada from '../components/matches/PredecirJornada'
import LoadingSpinner from '../components/ui/LoadingSpinner'

// Clave de jornada/fase de un partido (misma lógica de agrupación que MatchList).
function jornadaKeyOf(m) {
  return m.stage || (m.matchday ? `Jornada ${m.matchday}` : (m.phase ? m.phase.replace(/_/g, ' ') : 'Partidos'))
}

export default function GroupPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { showToast } = useToast()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState('home') // 'home' | 'matches' | 'table' | ...
  const [copied, setCopied] = useState(false)

  // Grupo (de mis grupos). refetchOnMount 'always' para que una quiniela recién
  // creada/unida aparezca aunque la caché tenga una lista vieja.
  const { data: groups = [], isLoading: lg, isFetching: fg } = useQuery({
    queryKey: ['my_groups'], queryFn: fetchMyGroups, refetchOnMount: 'always',
  })
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

  // Predicciones de ESTA quiniela (por league_id, ya no compartidas por torneo).
  const { data: predictions = [] } = useQuery({
    queryKey: ['predictions', profile?.id, id],
    enabled: !!profile?.id && !!group,
    queryFn: async () => {
      const { data, error } = await supabase.from('predictions').select('*').eq('user_id', profile.id).eq('league_id', id)
      if (error) throw error
      return data || []
    },
  })

  // Límite de comodines ×2 por jornada/fase: viene de la config de la quiniela.
  const powerupLimit = group?.powerup_limit ?? 2

  // Créditos de ×2 arrastrados de partidos cancelados (uso extra en la próxima
  // jornada/fase), otorgados por void_cancelled_match. { [powerupKey]: cantidad }
  const { data: powerupCredits = {} } = useQuery({
    queryKey: ['powerup_credits', id],
    queryFn: () => fetchMyPowerupCredits(id),
    enabled: !!id,
    staleTime: 1000 * 30,
  })

  // Jornada abierta en el modo "llenar toda la jornada" (null = cerrado).
  const [jornadaRapida, setJornadaRapida] = useState(null)

  const saveMutation = useMutation({
    mutationFn: async (prediction) => {
      const { data, error } = await supabase.from('predictions')
        .upsert({ ...prediction, user_id: profile.id, league_id: id }, { onConflict: 'user_id, league_id, match_id' }).select()
      if (error) throw error
      return data?.[0] || prediction
    },
    onSuccess: (newPred) => {
      queryClient.setQueryData(['predictions', profile?.id, id], (old = []) => {
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

  // ¿El torneo ya arrancó? (algún partido con kickoff <= ahora). Con eso bloqueamos
  // la edición de reglas/puntaje en el front (el backend también lo rechaza).
  const tournamentStarted = useMemo(
    () => matches.some((m) => m.kickoff_at && new Date(m.kickoff_at) <= new Date()),
    [matches],
  )

  // Jornadas/fases para dividir la pestaña Partidos (útil en ligas largas).
  const jornadas = useMemo(() => {
    const first = new Map()
    resolved.forEach((m) => {
      const k = jornadaKeyOf(m)
      const t = m.kickoff_at ? new Date(m.kickoff_at).getTime() : Infinity
      if (!first.has(k) || t < first.get(k)) first.set(k, t)
    })
    return [...first.entries()].sort((a, b) => a[1] - b[1]).map(([k]) => k)
  }, [resolved])
  const [jornadaSel, setJornadaSel] = useState(null) // null hasta elegir default; '__all__' = todas

  // Default: la primera jornada con partidos por jugar (si no, la última).
  useEffect(() => {
    if (jornadaSel !== null || jornadas.length <= 1) return
    const upcoming = jornadas.find((k) =>
      resolved.some((m) => jornadaKeyOf(m) === k && m.status !== 'finished' && m.status !== 'cancelled'))
    setJornadaSel(upcoming || jornadas[jornadas.length - 1])
  }, [jornadas, resolved, jornadaSel])

  const shownMatches = useMemo(
    () => (jornadaSel && jornadaSel !== '__all__' ? resolved.filter((m) => jornadaKeyOf(m) === jornadaSel) : resolved),
    [resolved, jornadaSel],
  )

  if (lg) return <LoadingSpinner />
  // Si todavía no está en la lista pero seguimos trayendo datos, esperá (evita el
  // falso "No encontramos" cuando la quiniela recién se creó).
  if (!group && fg) return <LoadingSpinner />
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
        <TabBtn active={tab === 'home'} onClick={() => setTab('home')} icon={Home} label="Resumen" />
        <TabBtn active={tab === 'matches'} onClick={() => setTab('matches')} icon={CalendarDays} label="Partidos" />
        <TabBtn active={tab === 'table'} onClick={() => setTab('table')} icon={ListOrdered} label="Tabla" />
        <TabBtn active={tab === 'historico'} onClick={() => setTab('historico')} icon={LayoutGrid} label="Histórico" />
        {!isCup && <TabBtn active={tab === 'teams'} onClick={() => setTab('teams')} icon={Shield} label="Posiciones" />}
        {/* Solo el Mundial tiene bracket dedicado; el resto ve sus fases en Partidos */}
        {tid === 1 && <TabBtn active={tab === 'bracket'} onClick={() => setTab('bracket')} icon={GitBranch} label="Bracket" />}
        <TabBtn active={tab === 'global'} onClick={() => setTab('global')} icon={BarChart3} label="Campeón/Gol" />
        <TabBtn active={tab === 'rules'} onClick={() => setTab('rules')} icon={ScrollText} label="Reglas" dot={!!group.open_proposal} />
      </div>

      {/* Aviso de votación abierta (visible desde cualquier pestaña) */}
      {group.open_proposal && tab !== 'rules' && (
        <button onClick={() => setTab('rules')}
          className="w-full mb-4 flex items-center gap-2.5 rounded-xl px-4 py-3 bg-accent/10 border border-accent/30 text-left">
          <Vote size={17} className="text-accent shrink-0" />
          <span className="flex-1 text-[12.5px] font-semibold text-slate-700 dark:text-[#F3F1EA]">
            {group.my_pending_vote ? 'Hay una propuesta de cambio de reglas — falta tu voto.' : 'Hay una propuesta de cambio de reglas en votación.'}
          </span>
          <span className="text-[11px] font-bold text-accent shrink-0">Ver →</span>
        </button>
      )}

      {tab === 'home' && (
        <SummaryTab group={group} matches={resolved} predictions={predictions} leagueId={group.id}
          profileId={profile?.id} loading={lm} onTab={setTab} onOpenMatch={(mid) => navigate(`/match/${mid}`)} />
      )}

      {tab === 'matches' && (
        lm ? <LoadingSpinner /> : resolved.length === 0 ? (
          <EmptyMatches kind={group.tournament_kind} />
        ) : (
          <>
            {jornadas.length > 1 && (
              <div className="flex gap-1.5 mb-4 overflow-x-auto scrollbar-hide">
                <JornadaChip active={jornadaSel === '__all__'} onClick={() => setJornadaSel('__all__')} label="Todas" />
                {jornadas.map((j) => (
                  <JornadaChip key={j} active={jornadaSel === j} onClick={() => setJornadaSel(j)} label={j} />
                ))}
              </div>
            )}
            <MatchList
              matches={shownMatches}
              predictions={predictions}
              onSavePrediction={(p) => saveMutation.mutate(p)}
              isLoading={saveMutation.isPending}
              powerupLimit={powerupLimit}
              powerupUsage={powerupUsage}
              powerupCredits={powerupCredits}
              onPredecirJornada={setJornadaRapida}
            />
          </>
        )
      )}

      {tab === 'table' && <StandingsTab leagueId={group.id} matches={resolved} />}
      {tab === 'historico' && (
        <>
          {/* Arriba de la matriz: el resumen de quién se lleva las jornadas. */}
          <JornadasYRachas leagueId={group.id} />
          <HistorialTab leagueId={group.id} matches={resolved} nombreQuiniela={group.name} />
        </>
      )}
      {tab === 'teams' && <TeamStandingsTab tournamentId={tid} />}
      {tab === 'bracket' && tid === 1 && <BracketView />}
      {tab === 'global' && (
        <>
          <TournamentGlobalCard tournamentId={tid} teams={teams} leagueId={group.id} championPoints={group.champion_points ?? 12} scorerPoints={group.scorer_points ?? 12} assistPoints={group.assist_points ?? 12} />
          <AllGlobalPicks tournamentId={tid} leagueId={group.id} />
        </>
      )}
      {tab === 'rules' && (
        <>
          <RulesPanel group={group} tournamentStarted={tournamentStarted} showToast={showToast}
            onDeleted={() => { queryClient.invalidateQueries({ queryKey: ['my_groups'] }); navigate('/') }} />
          {/* Van en Reglas porque es material de confianza, como las votaciones. */}
          <PozoYPagos leagueId={group.id} />
          {/* Quién administra va junto al pozo: es quién puede confirmar pagos. */}
          <MiembrosYAdmins leagueId={group.id} />
          <HistorialAjustes tournamentId={tid} />
        </>
      )}

      {jornadaRapida && (
        <PredecirJornada
          label={jornadaRapida.label}
          matches={jornadaRapida.matches}
          predictions={predictions}
          leagueId={group.id}
          profileId={profile?.id}
          powerupLimit={jornadaRapida.limit}
          powerupsUsedFuera={jornadaRapida.usadosFuera}
          onClose={() => setJornadaRapida(null)}
          onGuardado={() => {
            queryClient.invalidateQueries({ queryKey: ['predictions', profile?.id, id] })
            showToast(`${jornadaRapida.label} guardada.`, 'success', 3000)
          }}
        />
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

// "Expira en 12 h" / "Expira en 45 min" / "Cerrando…" para una propuesta.
function timeLeft(iso) {
  const ms = new Date(iso).getTime() - Date.now()
  if (ms <= 0) return 'Cerrando…'
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  return h >= 1 ? `Expira en ${h} h` : `Expira en ${m} min`
}

// Etiquetas de las reglas de puntaje (para propuestas y diffs).
const SCORING_LABELS = {
  points_exact: 'Marcador exacto',
  points_correct: 'Resultado correcto',
  powerup_limit: 'Comodines ×2 por jornada',
  champion_points: 'Acertar campeón',
  scorer_points: 'Acertar goleador',
}

// Panel completo de la pestaña Reglas: votación (si hay propuesta abierta),
// puntaje, reglas de texto, historial de propuestas y zona de peligro.
function RulesPanel({ group, tournamentStarted, showToast, onDeleted }) {
  const isAdmin = !!group.is_admin
  // Borrar la quiniela sigue siendo solo de quien la creó, no de los co-admins:
  // delete_group lo rechaza igual, así que mostrarles el botón sería un engaño.
  // (?? is_admin para no esconderlo antes de que corra la migración 59.)
  const soyCreador = group.soy_creador ?? !!group.is_admin
  const qc = useQueryClient()
  const { data: proposals = [], refetch } = useQuery({
    queryKey: ['league_proposals', group.id],
    queryFn: () => fetchLeagueProposals(group.id),
    enabled: !!group.id,
    // Fallback si el realtime no está habilitado: mientras haya votación abierta,
    // refrescamos el conteo cada 8 s.
    refetchInterval: (query) => (query.state.data?.some((p) => p.status === 'open') ? 8000 : false),
  })
  const openProposal = proposals.find((p) => p.status === 'open') || null
  const history = proposals.filter((p) => p.status !== 'open')
  const afterChange = () => { refetch(); qc.invalidateQueries({ queryKey: ['my_groups'] }) }

  // Realtime: el conteo de votos se actualiza solo para todos los miembros.
  useEffect(() => {
    if (!group.id) return
    const ch = supabase.channel(`rules-${group.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rule_proposals', filter: `league_id=eq.${group.id}` }, () => { refetch(); qc.invalidateQueries({ queryKey: ['my_groups'] }) })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rule_votes' }, () => refetch())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [group.id, refetch, qc])

  return (
    <div className="space-y-4">
      {openProposal && (
        <RuleVoting proposal={openProposal} group={group} isAdmin={isAdmin} onChanged={afterChange} showToast={showToast} />
      )}
      <ScoringConfig group={group} isAdmin={isAdmin} tournamentStarted={tournamentStarted}
        hasOpenProposal={!!openProposal} onSaved={afterChange} onProposed={afterChange} showToast={showToast} />
      <RulesTab group={group} isAdmin={isAdmin} tournamentStarted={tournamentStarted}
        hasOpenProposal={!!openProposal} onSaved={afterChange} onProposed={afterChange} showToast={showToast} />
      <ExtrasConfig group={group} isAdmin={isAdmin} onSaved={afterChange} showToast={showToast} />
      {history.length > 0 && <ProposalHistory items={history} />}
      {isAdmin && <AdminTools group={group} showToast={showToast} onDone={() => qc.invalidateQueries({ queryKey: ['league_medals', group.id] })} />}
      {soyCreador && <DangerZone group={group} onDeleted={onDeleted} showToast={showToast} />}
    </div>
  )
}

// Tarjeta de la propuesta abierta: muestra el cambio, los votos y permite votar.
function RuleVoting({ proposal, group, isAdmin, onChanged, showToast }) {
  const [busy, setBusy] = useState(null) // 'yes' | 'no' | 'cancel'
  const vote = async (v) => {
    try { setBusy(v ? 'yes' : 'no'); await castRuleVote(proposal.id, v); onChanged() }
    catch (e) { showToast(e.message, 'error', 6000); setBusy(null) }
  }
  const cancel = async () => {
    try { setBusy('cancel'); await cancelRuleProposal(proposal.id); showToast('Propuesta cancelada.', 'success', 3000); onChanged() }
    catch (e) { showToast(e.message, 'error', 6000); setBusy(null) }
  }
  const needed = Math.floor((proposal.members || 0) / 2) + 1

  return (
    <div className="rounded-2xl bg-white dark:bg-[#161616] border-2 border-accent/50 p-5">
      <div className="flex items-center gap-2 mb-1">
        <Vote size={18} className="text-accent" />
        <h3 className="font-bold font-['Unbounded'] text-slate-900 dark:text-[#F3F1EA] text-[15px] flex-1">Propuesta en votación</h3>
        {proposal.expires_at && <span className="shrink-0 font-['JetBrains_Mono'] font-bold text-[10px] text-[var(--text-muted,#8A8A8A)]">{timeLeft(proposal.expires_at)}</span>}
      </div>
      <p className="text-[11.5px] text-[var(--text-muted,#8A8A8A)] mb-3">
        Propuesta de <b className="text-slate-700 dark:text-[#F3F1EA]">{proposal.proposer_name || 'el admin'}</b>. Se aprueba con la mayoría del grupo ({needed} de {proposal.members} votos a favor). Al vencer el plazo se decide por mayoría de lo votado.
      </p>

      <ProposalDiff proposal={proposal} group={group} />
      {proposal.note && <p className="text-[12.5px] italic text-slate-600 dark:text-[#c9c7c0] mt-3 border-l-2 border-accent/40 pl-3">“{proposal.note}”</p>}

      {/* Contador de votos */}
      <div className="flex items-center gap-4 mt-4 mb-3 text-[13px]">
        <span className="flex items-center gap-1.5 font-bold text-[#2ED3B7]"><ThumbsUp size={15} /> {proposal.yes_count} a favor</span>
        <span className="flex items-center gap-1.5 font-bold text-[#FF7A59]"><ThumbsDown size={15} /> {proposal.no_count} en contra</span>
      </div>

      {/* Botones de voto */}
      <div className="flex gap-2">
        <button onClick={() => vote(true)} disabled={!!busy}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl font-bold text-sm transition-colors disabled:opacity-60 ${
            proposal.my_vote === true ? 'bg-[#2ED3B7] text-[#06231d]' : 'bg-[#2ED3B7]/12 text-[#2ED3B7] border border-[#2ED3B7]/30'}`}>
          {busy === 'yes' ? <Loader2 size={15} className="animate-spin" /> : <ThumbsUp size={15} />} A favor
        </button>
        <button onClick={() => vote(false)} disabled={!!busy}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl font-bold text-sm transition-colors disabled:opacity-60 ${
            proposal.my_vote === false ? 'bg-[#FF7A59] text-white' : 'bg-[#FF7A59]/12 text-[#FF7A59] border border-[#FF7A59]/30'}`}>
          {busy === 'no' ? <Loader2 size={15} className="animate-spin" /> : <ThumbsDown size={15} />} En contra
        </button>
      </div>
      {proposal.my_vote != null && <p className="text-[11px] text-[var(--text-muted,#8A8A8A)] mt-2 text-center">Ya votaste. Podés cambiar tu voto mientras la propuesta siga abierta.</p>}

      {isAdmin && (
        <button onClick={cancel} disabled={!!busy}
          className="w-full mt-3 flex items-center justify-center gap-1.5 text-[12px] font-bold text-[var(--text-muted,#8A8A8A)] py-1.5 disabled:opacity-60">
          {busy === 'cancel' ? <Loader2 size={13} className="animate-spin" /> : <X size={13} />} Cancelar propuesta
        </button>
      )}
    </div>
  )
}

// Resumen visual de lo que cambiaría una propuesta (puntaje: solo lo distinto).
function ProposalDiff({ proposal, group }) {
  if (proposal.kind === 'scoring') {
    const rows = Object.keys(SCORING_LABELS)
      .map((k) => ({ k, from: group?.[k], to: proposal.payload?.[k] }))
      .filter((r) => r.to != null && Number(r.to) !== Number(r.from))
    if (!rows.length) return <p className="text-[12.5px] text-[var(--text-muted,#8A8A8A)]">Sin cambios respecto al puntaje actual.</p>
    return (
      <div className="space-y-1.5">
        {rows.map((r) => (
          <div key={r.k} className="flex items-center justify-between gap-3 text-[13px]">
            <span className="text-slate-600 dark:text-[#c9c7c0]">{SCORING_LABELS[r.k]}</span>
            <span className="font-['JetBrains_Mono'] font-bold">
              <span className="text-slate-400 line-through">{r.from ?? '—'}</span>
              <span className="text-slate-400 mx-1">→</span>
              <span className="text-accent">{r.to}</span>
            </span>
          </div>
        ))}
      </div>
    )
  }
  // kind === 'rules'
  return (
    <div>
      <p className="text-[11.5px] font-bold text-[var(--text-muted,#8A8A8A)] mb-1.5 uppercase tracking-wide">Nuevo texto de reglas</p>
      <div className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-slate-700 dark:text-[#e5e3dc] bg-slate-50 dark:bg-[#0C0C0C] border border-slate-200 dark:border-[#262626] rounded-xl p-3 max-h-52 overflow-y-auto">
        {proposal.payload?.rules || '(vacío)'}
      </div>
    </div>
  )
}

// Historial de propuestas cerradas.
function ProposalHistory({ items }) {
  const badge = (s) => s === 'approved'
    ? { t: 'Aprobada', c: '#2ED3B7', b: 'rgba(46,211,183,.12)' }
    : s === 'rejected' ? { t: 'Rechazada', c: '#FF7A59', b: 'rgba(255,122,89,.12)' }
    : { t: 'Cancelada', c: '#8A8A8A', b: 'rgba(138,138,138,.12)' }
  return (
    <div className="rounded-2xl bg-white dark:bg-[#161616] border border-slate-200 dark:border-[#262626] p-5">
      <h3 className="font-bold font-['Unbounded'] text-slate-900 dark:text-[#F3F1EA] text-[15px] mb-3">Historial de propuestas</h3>
      <div className="space-y-2.5">
        {items.map((p) => {
          const bg = badge(p.status)
          return (
            <div key={p.id} className="flex items-center justify-between gap-3 text-[12.5px]">
              <span className="text-slate-600 dark:text-[#c9c7c0] truncate">
                {p.kind === 'scoring' ? 'Cambio de puntaje' : 'Cambio de reglas'} · {p.proposer_name}
                <span className="text-slate-400"> · {p.yes_count}–{p.no_count}</span>
              </span>
              <span className="shrink-0 font-['JetBrains_Mono'] font-bold text-[9px] px-[7px] py-0.5 rounded-[20px]" style={{ color: bg.c, background: bg.b }}>{bg.t}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ScoringConfig({ group, isAdmin, tournamentStarted, hasOpenProposal, onSaved, onProposed, showToast }) {
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [cfg, setCfg] = useState({
    points_exact: group.points_exact ?? 3,
    points_correct: group.points_correct ?? 1,
    powerup_limit: group.powerup_limit ?? 2,
    champion_points: group.champion_points ?? 12,
    scorer_points: group.scorer_points ?? 12,
    assist_points: group.assist_points ?? 12,
  })
  // Con el torneo iniciado, editar = proponer a votación (no guardar directo).
  const propose = tournamentStarted
  const rows = [
    ['points_exact', 'Marcador exacto', 'pts'],
    ['points_correct', 'Resultado correcto', 'pts'],
    ['powerup_limit', 'Comodines ×2 por jornada', ''],
    ['champion_points', 'Acertar campeón', 'pts'],
    ['scorer_points', 'Acertar goleador', 'pts'],
    ['assist_points', 'Acertar asistidor', 'pts'],
  ]
  const save = async () => {
    const parsed = {
      points_exact: parseInt(cfg.points_exact) || 0,
      points_correct: parseInt(cfg.points_correct) || 0,
      powerup_limit: parseInt(cfg.powerup_limit) || 0,
      champion_points: parseInt(cfg.champion_points) || 0,
      scorer_points: parseInt(cfg.scorer_points) || 0,
      assist_points: parseInt(cfg.assist_points) || 0,
    }
    try {
      setBusy(true)
      if (propose) {
        await proposeRuleChange(group.id, 'scoring', parsed, note)
        showToast('Propuesta de puntaje enviada a votación del grupo.', 'success', 5000)
        setNote('')
        onProposed?.()
      } else {
        await setGroupScoring(group.id, parsed)
        showToast('Reglas de puntaje actualizadas.', 'success', 4000)
        onSaved()
      }
      setEditing(false)
    } catch (e) { showToast(e.message, 'error', 6000) } finally { setBusy(false) }
  }
  return (
    <div className="rounded-2xl bg-white dark:bg-[#161616] border border-slate-200 dark:border-[#262626] p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <BarChart3 size={18} className="text-accent" />
          <h3 className="font-bold font-['Unbounded'] text-slate-900 dark:text-[#F3F1EA] text-[15px]">Puntaje</h3>
        </div>
        {isAdmin && !editing && !propose && (
          <button onClick={() => setEditing(true)} className="flex items-center gap-1.5 text-[12px] font-bold text-accent bg-accent/10 border border-accent/25 rounded-lg px-2.5 py-1.5">
            <Pencil size={13} /> Editar
          </button>
        )}
        {isAdmin && !editing && propose && !hasOpenProposal && (
          <button onClick={() => setEditing(true)} className="flex items-center gap-1.5 text-[12px] font-bold text-accent bg-accent/10 border border-accent/25 rounded-lg px-2.5 py-1.5">
            <Vote size={13} /> Proponer cambio
          </button>
        )}
        {isAdmin && propose && hasOpenProposal && (
          <span className="flex items-center gap-1.5 text-[11px] font-bold text-[var(--text-muted,#8A8A8A)] bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-[#262626] rounded-lg px-2.5 py-1.5">
            <Vote size={12} /> En votación
          </span>
        )}
      </div>
      <div className="space-y-2.5">
        {rows.map(([k, label, unit]) => (
          <div key={k} className="flex items-center justify-between gap-3">
            <span className="text-[13px] text-slate-600 dark:text-[#c9c7c0]">{label}</span>
            {editing ? (
              <input type="number" min="0" value={cfg[k]}
                onChange={(e) => setCfg({ ...cfg, [k]: e.target.value })}
                className="w-20 text-center bg-slate-50 dark:bg-[#0C0C0C] border border-slate-200 dark:border-[#262626] rounded-lg px-2 py-1.5 text-sm font-bold text-slate-900 dark:text-[#F3F1EA] focus:outline-none focus:border-accent" />
            ) : (
              <span className="font-['JetBrains_Mono'] font-bold text-[14px] text-slate-900 dark:text-[#F3F1EA]">{group[k] ?? '—'}{unit ? <span className="text-[10px] text-slate-400 ml-1">{unit}</span> : null}</span>
            )}
          </div>
        ))}
      </div>
      {editing && (
        <>
          {propose && (
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Motivo del cambio (opcional) — se muestra al grupo al votar"
              className="w-full mt-4 bg-slate-50 dark:bg-[#0C0C0C] border border-slate-200 dark:border-[#262626] rounded-xl p-3 text-[12.5px] text-slate-800 dark:text-[#F3F1EA] focus:outline-none focus:border-accent resize-none" />
          )}
          <div className="flex gap-2 mt-4">
            <button onClick={() => setEditing(false)} className="flex-1 py-2.5 rounded-xl font-bold text-sm text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-[#262626]">Cancelar</button>
            <button onClick={save} disabled={busy} className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl font-bold text-sm text-[#06231d] bg-gradient-to-r from-[#2ED3B7] to-[#26bfa5] disabled:opacity-60">
              {busy ? <Loader2 size={15} className="animate-spin" /> : propose ? <Vote size={15} /> : <Check size={15} />} {propose ? 'Enviar a votación' : 'Guardar'}
            </button>
          </div>
        </>
      )}
      {isAdmin && propose && !editing && (
        <p className="text-[11px] text-[var(--text-muted,#8A8A8A)] mt-3 flex items-start gap-1.5">
          <Lock size={12} className="mt-0.5 shrink-0" /> El torneo ya inició: el puntaje queda bloqueado. Para cambiarlo, proponé el cambio y el grupo lo vota.
        </p>
      )}
      {isAdmin && !propose && <p className="text-[11px] text-[var(--text-muted,#8A8A8A)] mt-3">Si cambiás el puntaje con partidos ya jugados, corré “Recalcular puntajes” en el Panel Admin para re-puntuar con las nuevas reglas.</p>}
    </div>
  )
}

function RulesTab({ group, isAdmin, tournamentStarted, hasOpenProposal, onSaved, onProposed, showToast }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(group.rules || '')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const propose = tournamentStarted

  const save = async () => {
    try {
      setBusy(true)
      if (propose) {
        await proposeRuleChange(group.id, 'rules', { rules: text }, note)
        showToast('Propuesta de reglas enviada a votación del grupo.', 'success', 5000)
        setNote('')
        onProposed?.()
      } else {
        await setGroupRules(group.id, text)
        showToast('Reglas actualizadas. Los demás miembros deberán aceptarlas de nuevo.', 'success', 5000)
        onSaved()
      }
      setEditing(false)
    } catch (e) { showToast(e.message, 'error', 6000) } finally { setBusy(false) }
  }

  return (
    <div className="rounded-2xl bg-white dark:bg-[#161616] border border-slate-200 dark:border-[#262626] p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <ScrollText size={18} className="text-accent" />
          <h3 className="font-bold font-['Unbounded'] text-slate-900 dark:text-[#F3F1EA] text-[15px]">Reglas</h3>
        </div>
        {isAdmin && !editing && !propose && (
          <button onClick={() => { setText(group.rules || ''); setEditing(true) }}
            className="flex items-center gap-1.5 text-[12px] font-bold text-accent bg-accent/10 border border-accent/25 rounded-lg px-2.5 py-1.5">
            <Pencil size={13} /> Editar
          </button>
        )}
        {isAdmin && !editing && propose && !hasOpenProposal && (
          <button onClick={() => { setText(group.rules || ''); setEditing(true) }}
            className="flex items-center gap-1.5 text-[12px] font-bold text-accent bg-accent/10 border border-accent/25 rounded-lg px-2.5 py-1.5">
            <Vote size={13} /> Proponer cambio
          </button>
        )}
        {isAdmin && propose && hasOpenProposal && (
          <span className="flex items-center gap-1.5 text-[11px] font-bold text-[var(--text-muted,#8A8A8A)] bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-[#262626] rounded-lg px-2.5 py-1.5">
            <Vote size={12} /> En votación
          </span>
        )}
      </div>

      {editing ? (
        <>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={12}
            className="w-full bg-slate-50 dark:bg-[#0C0C0C] border border-slate-200 dark:border-[#262626] rounded-xl p-3.5 text-[13px] leading-relaxed text-slate-800 dark:text-[#F3F1EA] focus:outline-none focus:border-accent resize-none" />
          {propose && (
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Motivo del cambio (opcional) — se muestra al grupo al votar"
              className="w-full mt-3 bg-slate-50 dark:bg-[#0C0C0C] border border-slate-200 dark:border-[#262626] rounded-xl p-3 text-[12.5px] text-slate-800 dark:text-[#F3F1EA] focus:outline-none focus:border-accent resize-none" />
          )}
          <div className="flex gap-2 mt-3">
            <button onClick={() => setEditing(false)} className="flex-1 py-2.5 rounded-xl font-bold text-sm text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-[#262626]">Cancelar</button>
            <button onClick={save} disabled={busy}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl font-bold text-sm text-[#06231d] bg-gradient-to-r from-[#2ED3B7] to-[#26bfa5] disabled:opacity-60">
              {busy ? <Loader2 size={15} className="animate-spin" /> : propose ? <Vote size={15} /> : <Check size={15} />} {propose ? 'Enviar a votación' : 'Guardar'}
            </button>
          </div>
          <p className="text-[11px] text-[var(--text-muted,#8A8A8A)] mt-2">
            {propose ? 'Se abrirá una votación en el grupo. Si se aprueba, los demás deberán volver a aceptar las reglas.' : 'Al guardar, los demás miembros deberán volver a aceptar las reglas.'}
          </p>
        </>
      ) : (
        <>
          <div className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-slate-700 dark:text-[#e5e3dc]">{group.rules || 'Esta quiniela no tiene reglas definidas.'}</div>
          {isAdmin && propose && (
            <p className="text-[11px] text-[var(--text-muted,#8A8A8A)] mt-3 flex items-start gap-1.5">
              <Lock size={12} className="mt-0.5 shrink-0" /> El torneo ya inició: para cambiar las reglas, proponé el cambio y el grupo lo vota.
            </p>
          )}
        </>
      )}
    </div>
  )
}

/* ---- Premios y contacto (WhatsApp) ---- */
// Cosmético, no afecta el puntaje: editable siempre, sin bloqueo por inicio
// de torneo ni votación. Antes vivía en "Ajustes Globales de la App" (un
// panel único para todo el sitio que ningún miembro llegaba a ver); ahora es
// por quiniela y se muestra en el Resumen.
function ExtrasConfig({ group, isAdmin, onSaved, showToast }) {
  const [editing, setEditing] = useState(false)
  const [prizesText, setPrizesText] = useState(group.prizes_text || '')
  const [whatsappLink, setWhatsappLink] = useState(group.whatsapp_link || '')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    try {
      setBusy(true)
      await setGroupExtras(group.id, { prizesText, whatsappLink })
      showToast('Premios y contacto actualizados.', 'success', 3500)
      setEditing(false)
      onSaved()
    } catch (e) { showToast(e.message, 'error', 6000) } finally { setBusy(false) }
  }

  if (!isAdmin && !group.prizes_text && !group.whatsapp_link) return null

  return (
    <div className="rounded-2xl bg-white dark:bg-[#161616] border border-slate-200 dark:border-[#262626] p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Gift size={18} className="text-accent" />
          <h3 className="font-bold font-['Unbounded'] text-slate-900 dark:text-[#F3F1EA] text-[15px]">Premios y contacto</h3>
        </div>
        {isAdmin && !editing && (
          <button onClick={() => { setPrizesText(group.prizes_text || ''); setWhatsappLink(group.whatsapp_link || ''); setEditing(true) }}
            className="flex items-center gap-1.5 text-[12px] font-bold text-accent bg-accent/10 border border-accent/25 rounded-lg px-2.5 py-1.5">
            <Pencil size={13} /> Editar
          </button>
        )}
      </div>

      {editing ? (
        <>
          <label className="block text-[11px] font-bold text-[var(--text-muted,#8A8A8A)] uppercase tracking-wide mb-1.5">Premios</label>
          <textarea value={prizesText} onChange={(e) => setPrizesText(e.target.value)} rows={3} placeholder="Ej. El primer lugar se lleva la olla"
            className="w-full bg-slate-50 dark:bg-[#0C0C0C] border border-slate-200 dark:border-[#262626] rounded-xl p-3 text-[13px] text-slate-800 dark:text-[#F3F1EA] focus:outline-none focus:border-accent resize-none" />
          <label className="block text-[11px] font-bold text-[var(--text-muted,#8A8A8A)] uppercase tracking-wide mb-1.5 mt-3">Link del grupo de WhatsApp</label>
          <input value={whatsappLink} onChange={(e) => setWhatsappLink(e.target.value)} placeholder="https://chat.whatsapp.com/…"
            className="w-full bg-slate-50 dark:bg-[#0C0C0C] border border-slate-200 dark:border-[#262626] rounded-xl p-3 text-[13px] text-slate-800 dark:text-[#F3F1EA] focus:outline-none focus:border-accent" />
          <div className="flex gap-2 mt-3">
            <button onClick={() => setEditing(false)} className="flex-1 py-2.5 rounded-xl font-bold text-sm text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-[#262626]">Cancelar</button>
            <button onClick={save} disabled={busy}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl font-bold text-sm text-[#06231d] bg-gradient-to-r from-[#2ED3B7] to-[#26bfa5] disabled:opacity-60">
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} Guardar
            </button>
          </div>
        </>
      ) : (
        <div className="space-y-2">
          {group.prizes_text
            ? <p className="text-[13px] leading-relaxed text-slate-700 dark:text-[#e5e3dc] whitespace-pre-wrap">{group.prizes_text}</p>
            : isAdmin && <p className="text-[12px] text-[var(--text-muted,#8A8A8A)] italic">Sin premios definidos.</p>}
          {group.whatsapp_link && (
            <a href={group.whatsapp_link} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-[12.5px] font-bold text-accent">
              <MessageCircle size={14} /> Grupo de WhatsApp
            </a>
          )}
        </div>
      )}
    </div>
  )
}

/* ---- Herramientas de admin ---- */
function AdminTools({ group, showToast, onDone }) {
  const [busy, setBusy] = useState(false)
  const recalc = async () => {
    try {
      setBusy(true)
      await recomputeLeagueBadges(group.id)
      showToast('Medallas recalculadas.', 'success', 3500)
      onDone?.()
    } catch (e) { showToast(e.message, 'error', 6000) } finally { setBusy(false) }
  }
  return (
    <div className="rounded-2xl bg-white dark:bg-[#161616] border border-slate-200 dark:border-[#262626] p-5">
      <div className="flex items-center gap-2 mb-2">
        <Trophy size={18} className="text-accent" />
        <h3 className="font-bold font-['Unbounded'] text-slate-900 dark:text-[#F3F1EA] text-[15px]">Herramientas</h3>
      </div>
      <p className="text-[12.5px] leading-relaxed text-[var(--text-muted,#8A8A8A)] mb-3">
        Las medallas se recalculan solas tras cada sincronización. Si querés forzarlo (por ejemplo, tras un cambio manual), usá el botón.
      </p>
      <button onClick={recalc} disabled={busy}
        className="flex items-center gap-2 rounded-xl px-4 py-2.5 font-['Archivo'] font-bold text-[13px] text-[#06231d] bg-gradient-to-r from-[#2ED3B7] to-[#26bfa5] disabled:opacity-60">
        {busy ? <Loader2 size={15} className="animate-spin" /> : <Trophy size={15} />} Recalcular medallas
      </button>
    </div>
  )
}

/* ---- Zona de peligro: eliminar quiniela (solo admin) ---- */
function DangerZone({ group, onDeleted, showToast }) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const del = async () => {
    try {
      setBusy(true)
      await deleteGroup(group.id)
      showToast('Quiniela eliminada.', 'success', 4000)
      onDeleted()
    } catch (e) { showToast(e.message, 'error', 6000); setBusy(false) }
  }
  return (
    <>
      <div className="rounded-2xl bg-white dark:bg-[#161616] border border-[#FF7A59]/40 p-5">
        <div className="flex items-center gap-2 mb-2">
          <AlertTriangle size={18} className="text-[#FF7A59]" />
          <h3 className="font-bold font-['Unbounded'] text-slate-900 dark:text-[#F3F1EA] text-[15px]">Zona de peligro</h3>
        </div>
        <p className="text-[12.5px] leading-relaxed text-[var(--text-muted,#8A8A8A)] mb-4">
          Al eliminar la quiniela se borran <b className="text-slate-700 dark:text-[#F3F1EA]">todas</b> sus predicciones, miembros y la tabla de posiciones. Esta acción no se puede deshacer.
        </p>
        <button onClick={() => setConfirming(true)}
          className="flex items-center gap-2 rounded-xl px-4 py-2.5 font-['Archivo'] font-bold text-[13px] text-white bg-[#e5533b] hover:bg-[#d64a34] transition-colors">
          <Trash2 size={15} /> Eliminar quiniela
        </button>
      </div>

      {confirming && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className="fixed inset-0 z-[130] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          onClick={() => !busy && setConfirming(false)}>
          <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }} onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[360px] bg-white dark:bg-[#0C0C0C] rounded-[20px] border border-slate-200 dark:border-[#262626] shadow-[0_20px_50px_-20px_rgba(0,0,0,0.6)] p-[22px]">
            <div className="flex items-center gap-2.5 mb-2">
              <div className="w-9 h-9 rounded-xl grid place-items-center bg-[#FF7A59]/12 shrink-0">
                <AlertTriangle size={18} className="text-[#FF7A59]" />
              </div>
              <h3 className="font-bold font-['Unbounded'] text-[16px] text-slate-900 dark:text-[#F3F1EA]">¿Eliminar quiniela?</h3>
            </div>
            <p className="text-[12.5px] leading-relaxed text-[var(--text-muted,#8A8A8A)] mb-5">
              Vas a eliminar <b className="text-slate-700 dark:text-[#F3F1EA]">{group.name}</b> para todos sus miembros. Esta acción es permanente.
            </p>
            <div className="flex gap-2">
              <button onClick={() => setConfirming(false)} disabled={busy}
                className="flex-1 py-2.5 rounded-xl font-bold text-sm text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-[#262626] disabled:opacity-60">Cancelar</button>
              <button onClick={del} disabled={busy}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl font-bold text-sm text-white bg-[#e5533b] hover:bg-[#d64a34] disabled:opacity-60">
                {busy ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />} Eliminar
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </>
  )
}

function JornadaChip({ active, onClick, label }) {
  return (
    <button onClick={onClick}
      className={`shrink-0 px-3 py-1.5 rounded-[10px] font-['JetBrains_Mono'] font-bold text-[10px] uppercase tracking-[0.08em] whitespace-nowrap transition-all ${
        active
          ? 'bg-accent text-[#06231d]'
          : 'bg-white dark:bg-[#161616] text-[var(--text-muted,#8A8A8A)] border border-slate-200 dark:border-[#262626]'}`}>
      {label}
    </button>
  )
}

function TabBtn({ active, onClick, icon: Icon, label, dot }) {
  return (
    <button onClick={onClick}
      className={`relative shrink-0 flex items-center gap-1.5 px-3.5 py-2 rounded-[10px] font-['Archivo'] font-bold text-[11.5px] whitespace-nowrap transition-all ${
        active
          ? 'bg-accent text-[#06231d]'
          : 'bg-white dark:bg-[#161616] text-[var(--text-muted,#8A8A8A)] border border-slate-200 dark:border-[#262626]'}`}>
      <Icon size={14} /> {label}
      {dot && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-[#FF7A59] ring-2 ring-white dark:ring-[#0C0C0C] animate-pulse" />}
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
    staleTime: 1000 * 30,
    refetchInterval: 1000 * 60,
  })
  if (isLoading) return <LoadingSpinner />
  if (isError || !data?.groups?.length) {
    return <p className="text-sm text-slate-400 italic text-center py-8">Todavía no hay partidos jugados en este torneo.</p>
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
                        <img src={r.logo || initialsDataUri(r.team, 40)} alt="" className="w-5 h-5 object-contain shrink-0" onError={crestOnError(r.team)} />
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
      <p className="text-[11px] text-slate-400 text-center">Tabla en vivo, calculada de los marcadores de la app</p>
    </div>
  )
}

// Pantalla de aterrizaje de la quiniela: resumen, próximos, últimos, torneo.
function SummaryTab({ group, matches, predictions, leagueId, profileId, loading, onTab, onOpenMatch }) {
  const predByMatch = useMemo(() => {
    const m = {}; predictions.forEach((p) => { m[p.match_id] = p }); return m
  }, [predictions])

  const upcoming = useMemo(() => matches
    .filter((m) => m.status === 'pending' || m.status === 'in_progress')
    .sort((a, b) => new Date(a.kickoff_at) - new Date(b.kickoff_at))
    .slice(0, 4), [matches])

  const recent = useMemo(() => matches
    .filter((m) => m.status === 'finished')
    .sort((a, b) => new Date(b.kickoff_at) - new Date(a.kickoff_at))
    .slice(0, 4), [matches])

  const stats = useMemo(() => {
    let made = 0, hits = 0, exact = 0, x2 = 0
    predictions.forEach((p) => { made++; if (p.use_powerup_x2) x2++ })
    matches.forEach((m) => {
      if (m.status !== 'finished') return
      const p = predByMatch[m.id]; if (!p) return
      if ((p.points_earned || 0) > 0) hits++
      if (p.home_goals_pred === m.home_goals_actual && p.away_goals_pred === m.away_goals_actual) exact++
    })
    return { made, hits, exact, x2 }
  }, [predictions, matches, predByMatch])

  const played = matches.filter((m) => m.status === 'finished').length
  const totalM = matches.filter((m) => m.status !== 'cancelled' && m.status !== 'postponed').length

  const { data: medalRows = [] } = useQuery({
    queryKey: ['league_medals', leagueId], queryFn: () => fetchLeagueMedals(leagueId), staleTime: 1000 * 60 * 5,
  })
  const myMedals = useMemo(() => medalRows
    .filter((r) => r.user_id === profileId)
    .map((r) => ({ badge_key: r.badge_key, tier: r.tier }))
    .sort((a, b) => b.tier - a.tier), [medalRows, profileId])

  if (loading) return <LoadingSpinner />

  const eff = stats.made ? Math.round((stats.hits / stats.made) * 100) : 0

  return (
    <div className="space-y-4">
      {/* Stat tiles */}
      <div className="grid grid-cols-3 gap-2.5">
        <StatTile label="Posición" value={`#${group.my_rank}`} sub={`de ${group.members}`} color="#E8B75A" />
        <StatTile label="Puntos" value={group.my_points ?? 0} color="#2ED3B7" />
        <StatTile label="Efectividad" value={`${eff}%`} sub={`${stats.hits}/${stats.made}`} color="#FF7A59" />
      </div>

      {/* Próximos partidos */}
      <Section title="Próximos partidos" icon={CalendarDays} actionLabel="Ver todos" onAction={() => onTab('matches')}>
        {upcoming.length === 0 ? (
          <p className="text-[12px] text-[var(--text-muted,#8A8A8A)] py-1">No hay partidos próximos.</p>
        ) : upcoming.map((m) => {
          const p = predByMatch[m.id]
          return (
            <button key={m.id} onClick={() => onOpenMatch(m.id)} className="w-full flex items-center gap-2 py-2 border-b border-slate-100 dark:border-white/5 last:border-0 text-left">
              <TeamMini name={m.home_team} flag={m.home_flag_url} code={m.home_team_code} />
              <span className="shrink-0 text-[10px] font-['JetBrains_Mono'] text-[var(--text-muted,#8A8A8A)]">vs</span>
              <TeamMini name={m.away_team} flag={m.away_flag_url} code={m.away_team_code} right />
              <div className="shrink-0 text-right ml-1">
                <div className="text-[9px] font-['JetBrains_Mono'] text-[var(--text-muted,#8A8A8A)] whitespace-nowrap">{kickoffLabel(m.kickoff_at)}</div>
                {p ? <span className="text-[8.5px] font-bold text-accent">✓ {p.home_goals_pred}-{p.away_goals_pred}</span>
                   : <span className="text-[8.5px] font-bold text-[#FF7A59]">falta tu pick</span>}
              </div>
            </button>
          )
        })}
      </Section>

      {/* Últimos resultados */}
      {recent.length > 0 && (
        <Section title="Últimos resultados" icon={ListOrdered}>
          {recent.map((m) => {
            const p = predByMatch[m.id]
            const pts = p?.points_earned || 0
            return (
              <button key={m.id} onClick={() => onOpenMatch(m.id)} className="w-full flex items-center gap-2 py-2 border-b border-slate-100 dark:border-white/5 last:border-0 text-left">
                <TeamMini name={m.home_team} flag={m.home_flag_url} code={m.home_team_code} />
                <span className="shrink-0 font-['JetBrains_Mono'] font-bold text-[13px] text-slate-900 dark:text-[#F3F1EA]">{m.home_goals_actual}-{m.away_goals_actual}</span>
                <TeamMini name={m.away_team} flag={m.away_flag_url} code={m.away_team_code} right />
                <span className="shrink-0 w-12 text-right font-['JetBrains_Mono'] font-bold text-[10px]"
                  style={{ color: pts >= 3 ? '#2ED3B7' : pts >= 1 ? '#E8B75A' : '#8A8A8A' }}>
                  {p ? `+${pts}` : '—'}
                </span>
              </button>
            )
          })}
        </Section>
      )}

      {/* Datos del torneo */}
      <Section title="Torneo" icon={Trophy}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[13px] font-semibold text-slate-800 dark:text-[#F3F1EA] truncate">{group.tournament_name}</span>
          <span className="shrink-0 font-['JetBrains_Mono'] font-bold text-[8.5px] px-[7px] py-0.5 rounded-[20px]"
            style={{ color: group.tournament_kind === 'cup' ? '#FF7A59' : '#2ED3B7', background: group.tournament_kind === 'cup' ? 'rgba(255,122,89,.12)' : 'rgba(46,211,183,.12)' }}>
            {group.tournament_kind === 'cup' ? 'COPA' : 'LIGA'}
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-slate-200 dark:bg-[#262626] overflow-hidden">
          <div className="h-full rounded-full bg-accent" style={{ width: `${totalM ? (played / totalM) * 100 : 0}%` }} />
        </div>
        <div className="font-['JetBrains_Mono'] text-[9px] text-[var(--text-muted,#8A8A8A)] mt-1">{played}/{totalM} partidos jugados</div>
      </Section>

      {/* Goleadores y asistencias en vivo (si el torneo tiene la fuente configurada) */}
      <PlayerStatsBoard tournamentId={group.tournament_id} />

      {/* Premios y WhatsApp (si el admin los cargó) */}
      {(group.prizes_text || group.whatsapp_link) && (
        <Section title="Premios" icon={Gift}>
          {group.prizes_text && <p className="text-[13px] leading-relaxed text-slate-700 dark:text-[#e5e3dc] whitespace-pre-wrap mb-2">{group.prizes_text}</p>}
          {group.whatsapp_link && (
            <a href={group.whatsapp_link} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-[12.5px] font-bold text-accent">
              <MessageCircle size={14} /> Grupo de WhatsApp
            </a>
          )}
        </Section>
      )}

      {/* Tu resumen */}
      <Section title="Tu resumen" icon={Target}>
        <div className="grid grid-cols-3 gap-2 mb-2">
          <MiniStat label="Predicciones" value={stats.made} />
          <MiniStat label="Exactos" value={stats.exact} />
          <MiniStat label="Comodines" value={stats.x2} />
        </div>
        {myMedals.length > 0 ? (
          <div className="flex items-center gap-2 pt-2 border-t border-slate-100 dark:border-white/5">
            <span className="text-[10px] font-bold text-[var(--text-muted,#8A8A8A)] uppercase tracking-wide">Medallas</span>
            <MedalStrip keys={myMedals} max={8} />
          </div>
        ) : (
          <p className="text-[11px] text-[var(--text-muted,#8A8A8A)] pt-2 border-t border-slate-100 dark:border-white/5">Todavía no ganaste medallas en esta quiniela.</p>
        )}
      </Section>
    </div>
  )
}

function StatTile({ label, value, sub, color }) {
  return (
    <div className="rounded-2xl bg-white dark:bg-[#161616] border border-slate-200 dark:border-[#262626] p-3 text-center">
      <div className="font-['Unbounded'] font-bold text-[20px] leading-none" style={{ color }}>{value}</div>
      {sub && <div className="font-['Archivo'] text-[9px] text-[var(--text-muted,#8A8A8A)] mt-0.5">{sub}</div>}
      <div className="font-['Archivo'] font-semibold text-[8.5px] text-[var(--text-muted,#8A8A8A)] mt-1 uppercase tracking-wide">{label}</div>
    </div>
  )
}

function MiniStat({ label, value }) {
  return (
    <div className="text-center">
      <div className="font-['JetBrains_Mono'] font-bold text-[16px] text-slate-900 dark:text-[#F3F1EA]">{value}</div>
      <div className="font-['Archivo'] font-semibold text-[8.5px] text-[var(--text-muted,#8A8A8A)] uppercase tracking-wide">{label}</div>
    </div>
  )
}

function Section({ title, icon: Icon, actionLabel, onAction, children }) {
  return (
    <div className="rounded-2xl bg-white dark:bg-[#161616] border border-slate-200 dark:border-[#262626] p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Icon size={15} className="text-accent" />
          <h3 className="font-bold font-['Archivo'] text-[13px] text-slate-900 dark:text-[#F3F1EA]">{title}</h3>
        </div>
        {actionLabel && (
          <button onClick={onAction} className="flex items-center gap-0.5 text-[11px] font-bold text-accent">{actionLabel} <ChevronRight size={13} /></button>
        )}
      </div>
      {children}
    </div>
  )
}

function TeamMini({ name, flag, code, right }) {
  const src = flag || `https://flagcdn.com/w40/${(code || 'xx').toLowerCase()}.png`
  return (
    <div className={`flex-1 min-w-0 flex items-center gap-1.5 ${right ? 'flex-row-reverse text-right' : ''}`}>
      <img src={src} alt="" className="w-4 h-4 object-contain shrink-0" onError={crestOnError(name)} />
      <span className="font-['Archivo'] font-semibold text-[11.5px] text-slate-800 dark:text-[#F3F1EA] truncate">{name}</span>
    </div>
  )
}

function kickoffLabel(iso) {
  const d = new Date((iso && (iso.endsWith('Z') || iso.includes('+'))) ? iso : `${iso}Z`)
  return d.toLocaleDateString('es', { weekday: 'short', day: '2-digit', month: 'short' }).replace(/\./g, '')
    + ' ' + d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', hour12: false })
}

function StandingsTab({ leagueId, matches = [] }) {
  // Jugador elegido para el cara a cara (se abre tocando su fila).
  const [rival, setRival] = useState(null)
  const { data: rows, isLoading } = useQuery({
    queryKey: ['group_standings', leagueId],
    queryFn: () => fetchGroupStandings(leagueId),
  })
  const { data: medalRows = [] } = useQuery({
    queryKey: ['league_medals', leagueId],
    queryFn: () => fetchLeagueMedals(leagueId),
    staleTime: 1000 * 60 * 5,
  })
  // user_id -> lista de {badge_key, tier} (mejor tier primero)
  const medalsByUser = useMemo(() => {
    const m = {}
    for (const r of medalRows) (m[r.user_id] ||= []).push({ badge_key: r.badge_key, tier: r.tier })
    for (const k in m) m[k].sort((a, b) => b.tier - a.tier)
    return m
  }, [medalRows])

  if (isLoading) return <LoadingSpinner />
  if (!rows?.length) return <p className="text-sm text-slate-400 italic text-center py-8">Sin miembros todavía.</p>
  const rankColor = (i) => i === 0 ? '#E8B75A' : i === 1 ? '#C7CDD6' : i === 2 ? '#FF7A59' : 'var(--text-muted,#8A8A8A)'
  // Puntajes que comparten dos o más jugadores: solo ahí tiene sentido mostrar
  // el desempate, para no llenar la tabla de números que nadie necesita.
  const empatados = new Set(
    rows.map((r) => Number(r.points))
      .filter((p, i, arr) => arr.indexOf(p) !== i),
  )
  return (
    <div className="space-y-1.5">
      {rows.map((r, i) => (
        <button key={r.user_id}
          onClick={() => { if (!r.is_me) setRival(r) }}
          disabled={r.is_me}
          title={r.is_me ? undefined : `Comparar tu historial contra ${r.display_name}`}
          className="w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-xl border disabled:cursor-default"
          style={r.is_me
            ? { background: 'rgba(46,211,183,.08)', borderColor: '#2ED3B7' }
            : { background: 'transparent', borderColor: 'transparent' }}>
          <span className="w-[22px] text-center font-['JetBrains_Mono'] font-bold text-[12px]" style={{ color: rankColor(i) }}>{r.pos ?? i + 1}</span>
          <div className="w-8 h-8 rounded-full grid place-items-center text-[11px] font-bold font-['Archivo'] text-white overflow-hidden shrink-0"
            style={{ background: r.is_me ? 'linear-gradient(135deg,#2ED3B7,#1a8f7c)' : 'linear-gradient(135deg,#5a2d8a,#3a1c5c)' }}>
            {r.avatar_url ? <img src={r.avatar_url} alt="" className="w-full h-full object-cover" /> : (r.display_name?.[0] || '?').toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <span className="font-['Archivo'] font-semibold text-[13px] text-slate-800 dark:text-[#F3F1EA] truncate block">{r.display_name}{r.is_me && <span className="text-accent font-bold"> (vos)</span>}</span>
            {empatados.has(Number(r.points)) && (
              <span className="font-['JetBrains_Mono'] text-[9px] text-[var(--text-muted,#8A8A8A)] flex items-center gap-1 mt-0.5"
                title="Desempate: exactos con ×2, luego exactos, aciertos, partidos jugados y menor error de gol">
                <Zap size={8} className="text-accent fill-current shrink-0" />{r.exactos_x2 ?? 0}
                <span className="opacity-50">·</span>{r.exactos ?? 0} exactos
                <span className="opacity-50">·</span>{r.aciertos ?? 0} aciertos
              </span>
            )}
            {medalsByUser[r.user_id]?.length > 0 && (
              <div className="mt-0.5"><MedalStrip keys={medalsByUser[r.user_id]} max={5} /></div>
            )}
          </div>
          <span className="font-['JetBrains_Mono'] font-bold text-[14px] text-slate-900 dark:text-[#F3F1EA]">{r.points}</span>
          {!r.is_me && <ChevronRight size={13} className="shrink-0 text-[var(--text-muted,#8A8A8A)] opacity-50" />}
        </button>
      ))}

      <p className="text-center font-['JetBrains_Mono'] text-[9px] text-[var(--text-muted,#8A8A8A)] pt-1">
        Tocá a alguien para verlo cara a cara contra vos
      </p>

      <AnimatePresence>
        {rival && (
          <CaraACara key="cara-a-cara" leagueId={leagueId} matches={matches}
            yo={rows.find((x) => x.is_me)} rival={rival} onClose={() => setRival(null)} />
        )}
      </AnimatePresence>
    </div>
  )
}
