/* Admin: cargar partidos (fixtures) a un torneo. Los resultados se editan en la
   pestaña 'Partidos / Resultados' como siempre. */
import { useState, useEffect } from 'react'
import { CalendarPlus, Plus, Trash2, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react'
import { supabase } from '../../lib/supabase'

const empty = { home_team: '', away_team: '', home_team_code: '', away_team_code: '', kickoff_at: '', matchday: '' }

export default function TournamentMatchesAdmin() {
  const [tournaments, setTournaments] = useState([])
  const [tid, setTid] = useState(null)
  const [matches, setMatches] = useState([])
  const [form, setForm] = useState(empty)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const flash = (type, text) => { setMsg({ type, text }); setTimeout(() => setMsg(null), 4000) }

  useEffect(() => {
    supabase.from('tournaments').select('id, name, kind').order('id').then(({ data }) => {
      setTournaments(data || [])
      setTid(data?.[0]?.id ?? null)
    })
  }, [])

  const loadMatches = async (t) => {
    if (!t) return
    const { data } = await supabase.from('matches')
      .select('id, home_team, away_team, kickoff_at, matchday, status')
      .eq('tournament_id', t).order('kickoff_at')
    setMatches(data || [])
  }
  useEffect(() => { loadMatches(tid) }, [tid])

  const callAdmin = async (path, body) => {
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`/_backend/api/admin/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify(body),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(json.detail || `Error ${res.status}`)
    return json
  }

  const add = async () => {
    if (!form.home_team.trim() || !form.away_team.trim() || !form.kickoff_at) { flash('error', 'Equipos y fecha son obligatorios'); return }
    try {
      setBusy(true)
      await callAdmin('create-match', {
        tournament_id: tid,
        home_team: form.home_team.trim(),
        away_team: form.away_team.trim(),
        home_team_code: form.home_team_code.trim() || 'xx',
        away_team_code: form.away_team_code.trim() || 'xx',
        kickoff_at: new Date(form.kickoff_at).toISOString(),
        matchday: form.matchday ? parseInt(form.matchday) : null,
        phase: 'groups',
      })
      setForm({ ...empty, matchday: form.matchday }) // conserva la jornada para cargar varios
      await loadMatches(tid)
      flash('ok', 'Partido agregado.')
    } catch (e) { flash('error', e.message) } finally { setBusy(false) }
  }

  const del = async (m) => {
    if (!confirm(`¿Borrar ${m.home_team} vs ${m.away_team}?`)) return
    try { setBusy(true); await callAdmin('delete-match', { match_id: m.id }); setMatches(prev => prev.filter(x => x.id !== m.id)) }
    catch (e) { flash('error', e.message) } finally { setBusy(false) }
  }

  return (
    <div className="glass-card p-5 mt-4">
      <div className="flex items-center gap-2 mb-4 border-b border-white/10 pb-3">
        <CalendarPlus className="text-accent" size={20} />
        <h2 className="text-lg font-bold text-slate-900 dark:text-white font-['Sora']">Cargar partidos a un torneo</h2>
      </div>

      {msg && (
        <div className={`mb-3 flex items-center gap-2 text-xs font-semibold ${msg.type === 'ok' ? 'text-emerald-500' : 'text-rose-500'}`}>
          {msg.type === 'ok' ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}{msg.text}
        </div>
      )}

      <select value={tid ?? ''} onChange={e => setTid(Number(e.target.value))}
        className="w-full bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl px-4 py-2.5 text-sm text-slate-900 dark:text-white mb-4">
        {tournaments.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>

      {/* Form */}
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <input value={form.home_team} onChange={e => setForm({ ...form, home_team: e.target.value })} placeholder="Local"
            className="bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-accent" />
          <input value={form.away_team} onChange={e => setForm({ ...form, away_team: e.target.value })} placeholder="Visitante"
            className="bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-accent" />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <input value={form.home_team_code} onChange={e => setForm({ ...form, home_team_code: e.target.value })} placeholder="cód local (es)"
            className="bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-accent" />
          <input value={form.away_team_code} onChange={e => setForm({ ...form, away_team_code: e.target.value })} placeholder="cód visita (de)"
            className="bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-accent" />
          <input value={form.matchday} onChange={e => setForm({ ...form, matchday: e.target.value })} type="number" placeholder="Jornada"
            className="bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-accent" />
        </div>
        <input value={form.kickoff_at} onChange={e => setForm({ ...form, kickoff_at: e.target.value })} type="datetime-local"
          className="w-full bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-accent" />
        <button onClick={add} disabled={busy || !tid}
          className="w-full flex items-center justify-center gap-2 font-bold text-sm py-2.5 rounded-xl text-slate-950 bg-accent hover:bg-accent-light disabled:opacity-50">
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} Agregar partido
        </button>
      </div>

      {/* Lista */}
      {matches.length > 0 && (
        <div className="mt-4 space-y-1.5 max-h-72 overflow-y-auto">
          <p className="text-[11px] font-semibold text-slate-500 uppercase">{matches.length} partidos</p>
          {matches.map(m => (
            <div key={m.id} className="flex items-center gap-2 text-sm py-1.5 px-2.5 rounded-lg bg-slate-50 dark:bg-white/5">
              <span className="flex-1 truncate text-slate-800 dark:text-slate-100">{m.home_team} vs {m.away_team}{m.matchday ? ` · J${m.matchday}` : ''}</span>
              <span className="text-[10px] text-slate-400">{new Date(m.kickoff_at).toLocaleDateString([], { day: '2-digit', month: '2-digit' })}</span>
              <button onClick={() => del(m)} disabled={busy} className="p-1 text-rose-500 hover:bg-rose-500/10 rounded"><Trash2 size={13} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
