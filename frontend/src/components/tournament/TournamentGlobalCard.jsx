// Predicción de campeón + goleador PARA UN TORNEO (con goleador autocompletado
// desde la tabla players). Reemplaza al viejo card global del Mundial.
import { useState, useEffect } from 'react'
import { Crown, Target, Save, Lock, Loader2, CheckCircle2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'

export default function TournamentGlobalCard({ tournamentId, teams = [] }) {
  const { profile } = useAuth()
  const [locked, setLocked] = useState(false)
  const [players, setPlayers] = useState([])
  const [champion, setChampion] = useState('')
  const [scorer, setScorer] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)

  useEffect(() => {
    if (!tournamentId || !profile?.id) return
    let alive = true
    ;(async () => {
      setLoading(true)
      const [{ data: t }, { data: pl }, { data: pred }] = await Promise.all([
        supabase.from('tournaments').select('predictions_locked').eq('id', tournamentId).single(),
        supabase.from('players').select('name, team').eq('tournament_id', tournamentId).order('name'),
        supabase.from('tournament_predictions').select('*').eq('user_id', profile.id).eq('tournament_id', tournamentId).maybeSingle(),
      ])
      if (!alive) return
      setLocked(!!t?.predictions_locked)
      setPlayers(pl || [])
      if (pred) { setChampion(pred.champion_team || ''); setScorer(pred.top_scorer_name || '') }
      setLoading(false)
    })()
    return () => { alive = false }
  }, [tournamentId, profile?.id])

  const save = async () => {
    try {
      setSaving(true); setMsg(null)
      const { error } = await supabase.from('tournament_predictions').upsert(
        { user_id: profile.id, tournament_id: tournamentId, champion_team: champion || null, top_scorer_name: scorer || null },
        { onConflict: 'user_id, tournament_id' })
      if (error) throw error
      setMsg({ type: 'ok', text: 'Guardado.' })
      setTimeout(() => setMsg(null), 3000)
    } catch (e) { setMsg({ type: 'error', text: e.message }) } finally { setSaving(false) }
  }

  if (loading) return <div className="glass-card p-6 text-center text-slate-400 text-sm">Cargando…</div>

  return (
    <div className="glass-card p-5">
      <div className="flex items-center gap-2 mb-4">
        <Crown size={18} className="text-accent" />
        <h3 className="font-bold font-['Unbounded'] text-slate-900 dark:text-white">Campeón y Goleador</h3>
        <span className="text-[11px] text-slate-400 ml-auto">12 pts c/u</span>
      </div>

      {locked && (
        <div className="flex items-center gap-2 text-xs font-semibold text-[#E8B75A] bg-[#E8B75A]/10 border border-[#E8B75A]/25 rounded-lg p-2.5 mb-4">
          <Lock size={14} /> Predicciones bloqueadas.
        </div>
      )}

      {/* Campeón */}
      <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1.5 flex items-center gap-1.5"><Crown size={12} className="text-gold" /> Equipo campeón</label>
      <select value={champion} onChange={e => setChampion(e.target.value)} disabled={locked}
        className="w-full bg-slate-100 dark:bg-[#0C0C0C] border border-slate-200 dark:border-[#262626] rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-accent disabled:opacity-60 mb-4">
        <option value="">— elegir campeón —</option>
        {teams.map(t => <option key={t} value={t}>{t}</option>)}
      </select>

      {/* Goleador (autocompletar desde players) */}
      <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1.5 flex items-center gap-1.5"><Target size={12} className="text-accent" /> Goleador (Bota de Oro)</label>
      <input list="tg-players" value={scorer} onChange={e => setScorer(e.target.value)} disabled={locked}
        placeholder={players.length ? 'Escribí para buscar…' : 'Sincronizá jugadores en el admin'}
        className="w-full bg-slate-100 dark:bg-[#0C0C0C] border border-slate-200 dark:border-[#262626] rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-accent disabled:opacity-60 mb-1" />
      <datalist id="tg-players">
        {players.map((p, i) => <option key={i} value={p.name}>{p.team}</option>)}
      </datalist>
      <p className="text-[11px] text-slate-400 mb-4">{players.length ? `${players.length} jugadores disponibles` : 'Sin lista de jugadores para este torneo aún.'}</p>

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
