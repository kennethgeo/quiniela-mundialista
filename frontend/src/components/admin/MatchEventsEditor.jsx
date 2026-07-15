/* Admin: editar goleadores (events_json) de un partido a mano.
   De esto depende "goles del goleador" en el ranking, por si ESPN falla. */
import { useState } from 'react'
import { Plus, Trash2, Save, Loader2, Goal } from 'lucide-react'
import { supabase } from '../../lib/supabase'

const normalize = (arr) =>
  (Array.isArray(arr) ? arr : [])
    .filter((e) => e && (e.type ?? 'goal') === 'goal')
    .map((e) => ({
      player: e.player || '',
      side: e.side === 'away' ? 'away' : 'home',
      penalty: !!e.penalty,
      own_goal: !!e.own_goal,
      minute: e.minute || '',
    }))

export default function MatchEventsEditor({ match, onSaved }) {
  const [events, setEvents] = useState(() => normalize(match.events_json))
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)

  const setRow = (i, patch) => setEvents((prev) => prev.map((e, idx) => (idx === i ? { ...e, ...patch } : e)))
  const addRow = () => setEvents((prev) => [...prev, { player: '', side: 'home', penalty: false, own_goal: false, minute: '' }])
  const removeRow = (i) => setEvents((prev) => prev.filter((_, idx) => idx !== i))

  const save = async () => {
    try {
      setSaving(true); setMsg(null)
      const clean = events.filter((e) => e.player.trim())
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error('Sesión no válida')
      const res = await fetch('/_backend/api/admin/update-match-events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ match_id: match.id, events: clean }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.detail || `Error ${res.status}`)
      setEvents(normalize(json.events))
      setMsg({ type: 'ok', text: 'Goleadores guardados.' })
      onSaved?.(json.events)
    } catch (err) {
      setMsg({ type: 'error', text: err.message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-slate-100 dark:bg-black/20 p-3 rounded-xl">
      <div className="flex items-center justify-between mb-2">
        <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200">
          <Goal size={13} className="text-blue-500" /> Goleadores del partido
        </label>
        <button onClick={addRow} className="text-[11px] font-bold text-accent flex items-center gap-1 hover:text-amber-400">
          <Plus size={13} /> Agregar
        </button>
      </div>

      {events.length === 0 && <p className="text-[11px] text-slate-400 italic mb-2">Sin goles cargados.</p>}

      <div className="space-y-2">
        {events.map((e, i) => (
          <div key={i} className="flex flex-wrap items-center gap-1.5 bg-white dark:bg-slate-900 rounded-lg p-1.5 border border-slate-200 dark:border-white/10">
            <input
              value={e.player}
              onChange={(ev) => setRow(i, { player: ev.target.value })}
              placeholder="Nombre del goleador"
              className="flex-1 min-w-[120px] bg-transparent px-2 py-1 text-sm text-slate-900 dark:text-white focus:outline-none"
            />
            <select value={e.side} onChange={(ev) => setRow(i, { side: ev.target.value })}
              className="bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-white/10 rounded px-1.5 py-1 text-[11px] text-slate-700 dark:text-slate-200">
              <option value="home">{match.home_team}</option>
              <option value="away">{match.away_team}</option>
            </select>
            <input value={e.minute} onChange={(ev) => setRow(i, { minute: ev.target.value })} placeholder="min"
              className="w-12 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-white/10 rounded px-1.5 py-1 text-[11px] text-center text-slate-700 dark:text-slate-200" />
            <label className="flex items-center gap-1 text-[10px] text-slate-500 cursor-pointer" title="Penal">
              <input type="checkbox" checked={e.penalty} onChange={(ev) => setRow(i, { penalty: ev.target.checked })} className="accent-accent" /> P
            </label>
            <label className="flex items-center gap-1 text-[10px] text-slate-500 cursor-pointer" title="Autogol (no cuenta al goleador)">
              <input type="checkbox" checked={e.own_goal} onChange={(ev) => setRow(i, { own_goal: ev.target.checked })} className="accent-rose-500" /> AG
            </label>
            <button onClick={() => removeRow(i)} className="p-1 text-rose-500 hover:bg-rose-500/10 rounded">
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between mt-2.5">
        {msg ? (
          <span className={`text-[11px] font-semibold ${msg.type === 'ok' ? 'text-emerald-500' : 'text-rose-500'}`}>{msg.text}</span>
        ) : <span className="text-[10px] text-slate-400">P = penal · AG = autogol</span>}
        <button onClick={save} disabled={saving}
          className="px-3 py-1.5 rounded-lg bg-blue-500/20 text-blue-500 text-xs font-bold hover:bg-blue-500/30 flex items-center gap-1 disabled:opacity-50">
          {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Guardar goleadores
        </button>
      </div>
    </div>
  )
}
