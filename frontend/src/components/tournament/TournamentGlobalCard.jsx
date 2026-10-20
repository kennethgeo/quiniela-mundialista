// Predicción de campeón + goleador PARA UN TORNEO (con goleador autocompletado
// desde la tabla players). Reemplaza al viejo card global del Mundial.
import { useState, useEffect, useMemo } from 'react'
import { Crown, Target, Save, Lock, Loader2, CheckCircle2, Handshake } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { fetchTeamStandings } from '../../lib/groups'
import { ErrorState } from '../ui/StatePanel'

// normaliza para comparar sin acentos ni mayúsculas
const norm = (s) => (s || '').toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()

export default function TournamentGlobalCard({ tournamentId, teams = [], leagueId, championPoints = 12, scorerPoints = 12, assistPoints = 12 }) {
  const { profile } = useAuth()
  const [locked, setLocked] = useState(false)
  const [players, setPlayers] = useState([])
  const [standingsTeams, setStandingsTeams] = useState([])
  const [champion, setChampion] = useState('')
  const [scorer, setScorer] = useState('')
  const [assist, setAssist] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)
  const [showSug, setShowSug] = useState(false)
  const [showSugA, setShowSugA] = useState(false)
  const [errorLectura, setErrorLectura] = useState(null)
  const [campeonGuardado, setCampeonGuardado] = useState('')
  const [intento, setIntento] = useState(0)

  // Lista de equipos: une los de los partidos cargados con los de la tabla oficial
  // (ESPN), así el selector de campeón funciona aunque aún no haya partidos.
  useEffect(() => {
    if (!tournamentId) return
    let alive = true
    fetchTeamStandings(tournamentId)
      .then((d) => {
        if (!alive) return
        const names = (d?.groups || []).flatMap((g) => (g.rows || []).map((r) => r.team)).filter(Boolean)
        setStandingsTeams([...new Set(names)])
      })
      .catch(() => {})
    return () => { alive = false }
  }, [tournamentId])

  /* El campeón GUARDADO va siempre entre las opciones, aunque ESPN o los
     partidos todavía no lo traigan (revisión de Codex del 20 oct): si no, el
     select se veía vacío teniendo un campeón puesto, y parecía que se había
     perdido. */
  const teamOptions = useMemo(() => {
    const s = new Set([...(teams || []), ...standingsTeams, ...(campeonGuardado ? [campeonGuardado] : [])])
    return [...s].sort((a, b) => a.localeCompare(b))
  }, [teams, standingsTeams, campeonGuardado])

  // Sugerencias de goleador: jugadores cuyo nombre EMPIEZA por lo escrito.
  const scorerSuggestions = useMemo(() => {
    const q = norm(scorer)
    if (!q) return []
    return players.filter((p) => norm(p.name).startsWith(q)).slice(0, 8)
  }, [scorer, players])

  const assistSuggestions = useMemo(() => {
    const q = norm(assist)
    if (!q) return []
    return players.filter((p) => norm(p.name).startsWith(q)).slice(0, 8)
  }, [assist, players])

  useEffect(() => {
    if (!tournamentId || !profile?.id || !leagueId) return
    let alive = true
    ;(async () => {
      setLoading(true); setErrorLectura(null)
      /* El cierre lo decide la MISMA regla que usa la base para dejar escribir
         y para destapar (tournament_predictions_open: sin candado y, o forzado,
         o antes del primer saque). Mirar solo `predictions_locked` dejaba el
         formulario abierto en un torneo ya empezado (LaLiga y Premier, 19 oct
         2026) y la RLS rechazaba el guardado. */
      const [abiertas, pl, pred] = await Promise.all([
        supabase.rpc('tournament_predictions_open', { p_tid: tournamentId }),
        supabase.from('players').select('name, team').eq('tournament_id', tournamentId).order('name'),
        supabase.from('tournament_predictions').select('champion_team, top_scorer_name, top_assist_name')
          .eq('user_id', profile.id).eq('tournament_id', tournamentId).eq('league_id', leagueId).maybeSingle(),
      ])
      if (!alive) return
      /* Si no se sabe qué hay guardado (o si se puede guardar), NO se ofrece el
         formulario: antes salía vacío y «Guardar» pisaba campeón, goleador y
         asistidor con null. Los jugadores son solo sugerencias: su fallo no
         bloquea. */
      if (abiertas.error || typeof abiertas.data !== 'boolean' || pred.error) {
        setErrorLectura('No pudimos leer tus predicciones globales ni si siguen abiertas.')
        setLoading(false)
        return
      }
      setLocked(!abiertas.data)
      setPlayers(pl.data || [])
      setChampion(pred.data?.champion_team || '')
      setCampeonGuardado(pred.data?.champion_team || '')
      setScorer(pred.data?.top_scorer_name || '')
      setAssist(pred.data?.top_assist_name || '')
      setLoading(false)
    })()
    return () => { alive = false }
  }, [tournamentId, profile?.id, leagueId, intento])

  const save = async () => {
    if (errorLectura || locked || loading || saving) return
    try {
      setSaving(true); setMsg(null)
      const { error } = await supabase.from('tournament_predictions').upsert(
        { user_id: profile.id, tournament_id: tournamentId, league_id: leagueId, champion_team: champion || null, top_scorer_name: scorer || null, top_assist_name: assist || null },
        { onConflict: 'user_id, league_id' })
      if (error) throw error
      setMsg({ type: 'ok', text: 'Guardado.' })
      setTimeout(() => setMsg(null), 3000)
    } catch (e) { setMsg({ type: 'error', text: e.message }) } finally { setSaving(false) }
  }

  if (loading) return <div className="glass-card p-6 text-center text-slate-400 text-sm">Cargando…</div>
  if (errorLectura) {
    return <ErrorState title="Predicciones globales" description={`${errorLectura} No se puede guardar hasta leerlas.`}
      onRetry={() => setIntento((i) => i + 1)} />
  }

  return (
    <div className="glass-card p-5">
      <div className="flex items-center gap-2 mb-4">
        <Crown size={18} className="text-accent" />
        <h3 className="font-bold font-['Unbounded'] text-slate-900 dark:text-white">Predicciones globales</h3>
        <span className="text-[11px] text-slate-400 ml-auto">{championPoints + scorerPoints + assistPoints} pts</span>
      </div>

      {locked && (
        <div className="flex items-center gap-2 text-xs font-semibold text-[#E8B75A] bg-[#E8B75A]/10 border border-[#E8B75A]/25 rounded-lg p-2.5 mb-4">
          <Lock size={14} /> Predicciones bloqueadas.
        </div>
      )}

      {/* Campeón */}
      <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1.5 flex items-center gap-1.5"><Crown size={12} className="text-gold" /> Equipo campeón</label>
      <select value={champion} onChange={e => setChampion(e.target.value)} disabled={locked}
        className="w-full bg-slate-100 dark:bg-[#0C0C0C] border border-slate-200 dark:border-[#262626] rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-accent disabled:opacity-60 mb-1">
        <option value="">— elegir campeón —</option>
        {teamOptions.map(t => <option key={t} value={t}>{t}</option>)}
      </select>
      <p className="text-[11px] text-slate-400 mb-4">{teamOptions.length ? `${teamOptions.length} equipos` : 'Los equipos aparecen cuando ESPN publica la tabla o los partidos del torneo.'}</p>

      {/* Goleador (autocompletar desde players) */}
      <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1.5 flex items-center gap-1.5"><Target size={12} className="text-accent" /> Goleador (Bota de Oro)</label>
      <div className="relative mb-1">
        <input value={scorer} onChange={e => { setScorer(e.target.value); setShowSug(true) }}
          onFocus={() => setShowSug(true)} onBlur={() => setTimeout(() => setShowSug(false), 150)}
          disabled={locked} autoComplete="off"
          placeholder={players.length ? 'Escribí el nombre…' : 'Sincronizá jugadores en el admin'}
          className="w-full bg-slate-100 dark:bg-[#0C0C0C] border border-slate-200 dark:border-[#262626] rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-accent disabled:opacity-60" />
        {showSug && scorerSuggestions.length > 0 && !(scorerSuggestions.length === 1 && norm(scorerSuggestions[0].name) === norm(scorer)) && (
          <div className="absolute z-30 left-0 right-0 mt-1 max-h-60 overflow-y-auto rounded-xl bg-white dark:bg-[#161616] border border-slate-200 dark:border-[#262626] shadow-2xl">
            {scorerSuggestions.map((p, i) => (
              <button key={i} type="button"
                onMouseDown={(e) => { e.preventDefault(); setScorer(p.name); setShowSug(false) }}
                className="w-full text-left px-4 py-2.5 hover:bg-slate-100 dark:hover:bg-white/5 flex items-center justify-between gap-2 border-b border-slate-100 dark:border-white/5 last:border-0">
                <span className="text-sm text-slate-900 dark:text-[#F3F1EA] truncate">{p.name}</span>
                <span className="text-[11px] text-slate-400 shrink-0">{p.team}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <p className="text-[11px] text-slate-400 mb-4">{players.length ? `${players.length} jugadores disponibles` : 'Sin lista de jugadores para este torneo aún.'}</p>

      {/* Asistidor (autocompletar desde players) */}
      <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1.5 flex items-center gap-1.5"><Handshake size={12} className="text-accent" /> Asistidor (máx. asistencias)</label>
      <div className="relative mb-1">
        <input value={assist} onChange={e => { setAssist(e.target.value); setShowSugA(true) }}
          onFocus={() => setShowSugA(true)} onBlur={() => setTimeout(() => setShowSugA(false), 150)}
          disabled={locked} autoComplete="off"
          placeholder={players.length ? 'Escribí el nombre…' : 'Sincronizá jugadores en el admin'}
          className="w-full bg-slate-100 dark:bg-[#0C0C0C] border border-slate-200 dark:border-[#262626] rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-accent disabled:opacity-60" />
        {showSugA && assistSuggestions.length > 0 && !(assistSuggestions.length === 1 && norm(assistSuggestions[0].name) === norm(assist)) && (
          <div className="absolute z-30 left-0 right-0 mt-1 max-h-60 overflow-y-auto rounded-xl bg-white dark:bg-[#161616] border border-slate-200 dark:border-[#262626] shadow-2xl">
            {assistSuggestions.map((p, i) => (
              <button key={i} type="button"
                onMouseDown={(e) => { e.preventDefault(); setAssist(p.name); setShowSugA(false) }}
                className="w-full text-left px-4 py-2.5 hover:bg-slate-100 dark:hover:bg-white/5 flex items-center justify-between gap-2 border-b border-slate-100 dark:border-white/5 last:border-0">
                <span className="text-sm text-slate-900 dark:text-[#F3F1EA] truncate">{p.name}</span>
                <span className="text-[11px] text-slate-400 shrink-0">{p.team}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <p className="text-[11px] text-slate-400 mb-4">Quien reparta más asistencias en el torneo.</p>

      {msg && (
        <div className={`mb-3 flex items-center gap-2 text-xs font-semibold ${msg.type === 'ok' ? 'text-emerald-500' : 'text-rose-500'}`}>
          <CheckCircle2 size={14} />{msg.text}
        </div>
      )}

      {!locked && (
        <button onClick={save} disabled={saving}
          className="w-full flex items-center justify-center gap-2 font-bold font-['Archivo'] text-sm py-3 rounded-xl text-[#06231d] bg-gradient-to-r from-[#2ED3B7] to-[#26bfa5] disabled:opacity-50">
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Guardar predicción
        </button>
      )}
    </div>
  )
}
