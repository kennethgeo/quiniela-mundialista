/* Admin: campeón/goleador real + bloqueo, POR TORNEO, y repartir sus 12 pts. */
import { useState, useEffect } from 'react'
import { Crown, Save, Calculator, Lock, Unlock, Loader2, CheckCircle2, AlertTriangle, LockOpen } from 'lucide-react'
import { supabase } from '../../lib/supabase'

export default function TournamentGlobalsAdmin() {
  const [tournaments, setTournaments] = useState([])
  const [tid, setTid] = useState(null)
  const [champion, setChampion] = useState('')
  const [scorer, setScorer] = useState('')
  const [assist, setAssist] = useState('')
  const [locked, setLocked] = useState(false)
  const [forceOpen, setForceOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const flash = (type, text) => { setMsg({ type, text }); setTimeout(() => setMsg(null), 5000) }

  useEffect(() => {
    supabase.from('tournaments').select('id, name, actual_champion, actual_top_scorer, actual_top_assist, predictions_locked, predictions_force_open').order('id')
      .then(({ data }) => { setTournaments(data || []); if (data?.[0]) selectT(data[0]) })
  }, [])

  const selectT = (t) => {
    setTid(t.id); setChampion(t.actual_champion || ''); setScorer(t.actual_top_scorer || ''); setAssist(t.actual_top_assist || ''); setLocked(!!t.predictions_locked); setForceOpen(!!t.predictions_force_open)
  }
  const onSelect = (id) => { const t = tournaments.find(x => x.id === id); if (t) selectT(t) }

  const callAdmin = async (path, body) => {
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`/_backend/api/admin/${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify(body),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(json.detail || `Error ${res.status}`)
    return json
  }

  const save = async () => {
    try {
      setBusy(true)
      await callAdmin('set-tournament-globals', { tournament_id: tid, actual_champion: champion, actual_top_scorer: scorer, actual_top_assist: assist, predictions_locked: locked, predictions_force_open: forceOpen })
      setTournaments(prev => prev.map(t => t.id === tid ? { ...t, actual_champion: champion, actual_top_scorer: scorer, actual_top_assist: assist, predictions_locked: locked, predictions_force_open: forceOpen } : t))
      flash('ok', 'Guardado.')
    } catch (e) { flash('error', e.message) } finally { setBusy(false) }
  }

  const calc = async () => {
    if (!confirm('¿Repartir los puntos de campeón/goleador/asistidor de este torneo?')) return
    try {
      setBusy(true)
      await save()
      const r = await callAdmin('calc-tournament-globals', { tournament_id: tid })
      flash('ok', `Puntos repartidos: ${r.updated} predicciones (${r.users} jugadores).`)
    } catch (e) { flash('error', e.message) } finally { setBusy(false) }
  }

  return (
    <div className="glass-card p-5 mt-4">
      <div className="flex items-center gap-2 mb-4 border-b border-white/10 pb-3">
        <Crown className="text-accent" size={20} />
        <h2 className="text-lg font-bold text-slate-900 dark:text-white font-['Unbounded']">Campeón / Goleador / Asistidor por torneo</h2>
      </div>

      {msg && (
        <div className={`mb-3 flex items-center gap-2 text-xs font-semibold ${msg.type === 'ok' ? 'text-emerald-500' : 'text-rose-500'}`}>
          {msg.type === 'ok' ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}{msg.text}
        </div>
      )}

      <select value={tid ?? ''} onChange={e => onSelect(Number(e.target.value))}
        className="w-full bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl px-4 py-2.5 text-sm text-slate-900 dark:text-white mb-4">
        {tournaments.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>

      <label className="block text-xs font-semibold text-slate-500 uppercase mb-1.5">Campeón real</label>
      <input value={champion} onChange={e => setChampion(e.target.value)} placeholder="Ej. Real Madrid"
        className="w-full bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl px-4 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-accent mb-3" />

      <label className="block text-xs font-semibold text-slate-500 uppercase mb-1.5">Goleador real</label>
      <input value={scorer} onChange={e => setScorer(e.target.value)} placeholder="Ej. Mbappé, Lewandowski (coma si empate)"
        className="w-full bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl px-4 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-accent mb-1" />
      <p className="text-[11px] text-slate-400 mb-3">Si hay empate de goleador, separá con coma; gana quien acertó a cualquiera.</p>

      <label className="block text-xs font-semibold text-slate-500 uppercase mb-1.5">Asistidor real</label>
      <input value={assist} onChange={e => setAssist(e.target.value)} placeholder="Ej. De Bruyne (coma si empate)"
        className="w-full bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl px-4 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-accent mb-1" />
      <p className="text-[11px] text-slate-400 mb-3">Quien repartió más asistencias. Si hay empate, separá con coma.</p>

      <label className="flex items-center gap-2 cursor-pointer mb-3">
        <input type="checkbox" checked={locked} onChange={e => setLocked(e.target.checked)} className="accent-accent w-4 h-4" />
        <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
          {locked ? <Lock size={13} className="text-rose-500" /> : <Unlock size={13} className="text-emerald-500" />}
          Predicciones bloqueadas (campeón/goleador/asistidor)
        </span>
      </label>

      <label className="flex items-start gap-2 cursor-pointer mb-4">
        <input type="checkbox" checked={forceOpen} onChange={e => setForceOpen(e.target.checked)} className="accent-accent w-4 h-4 mt-0.5" />
        <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
          <span className="flex items-center gap-1.5"><LockOpen size={13} className="text-amber-500" /> Forzar apertura aunque ya haya arrancado</span>
          <span className="block text-[10.5px] font-normal text-slate-400 mt-0.5">
            Reabre las predicciones globales pese a que el torneo ya inició (p. ej. para que alguien que faltó pueda predecir). Sin esto, "Predicciones bloqueadas" en falso no alcanza una vez arrancado el primer partido.
          </span>
        </span>
      </label>

      <div className="flex gap-2">
        <button onClick={save} disabled={busy || !tid}
          className="flex-1 flex items-center justify-center gap-2 text-sm font-bold py-2.5 rounded-xl bg-slate-200 dark:bg-white/10 text-slate-800 dark:text-white hover:bg-slate-300 dark:hover:bg-white/20 disabled:opacity-50">
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Guardar
        </button>
        <button onClick={calc} disabled={busy || !tid}
          className="flex-1 flex items-center justify-center gap-2 text-sm font-bold py-2.5 rounded-xl bg-accent text-slate-950 hover:bg-accent-light disabled:opacity-50">
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Calculator size={15} />} Calcular puntos
        </button>
      </div>
    </div>
  )
}
