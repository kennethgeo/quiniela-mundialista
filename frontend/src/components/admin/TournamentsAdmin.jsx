/* Admin: crear y administrar torneos (multi-torneo de la 2.0). */
import { useState, useEffect } from 'react'
import { Trophy, Plus, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react'
import { supabase } from '../../lib/supabase'

const KIND = { cup: '🏆 Copa', league: '📊 Liga' }
const STATUS = { upcoming: 'Próximo', active: 'Activo', finished: 'Finalizado' }

export default function TournamentsAdmin() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [form, setForm] = useState({ name: '', kind: 'league', source: 'manual', external_ref: '', season: '', status: 'upcoming' })

  const flash = (type, text) => { setMsg({ type, text }); setTimeout(() => setMsg(null), 4000) }

  const load = async () => {
    setLoading(true)
    const { data } = await supabase.from('tournaments').select('*').order('id')
    setItems(data || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

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

  const create = async () => {
    if (!form.name.trim()) { flash('error', 'Ponele nombre al torneo'); return }
    try {
      setBusy(true)
      await callAdmin('create-tournament', form)
      setForm({ name: '', kind: 'league', source: 'manual', external_ref: '', season: '', status: 'upcoming' })
      await load()
      flash('ok', 'Torneo creado.')
    } catch (e) { flash('error', e.message) } finally { setBusy(false) }
  }

  const setStatus = async (t, status) => {
    try {
      setBusy(true)
      await callAdmin('update-tournament', { id: t.id, status })
      setItems(prev => prev.map(x => x.id === t.id ? { ...x, status } : x))
    } catch (e) { flash('error', e.message) } finally { setBusy(false) }
  }

  return (
    <div className="glass-card p-5 mt-4">
      <div className="flex items-center gap-2 mb-4 border-b border-white/10 pb-3">
        <Trophy className="text-accent" size={20} />
        <h2 className="text-lg font-bold text-slate-900 dark:text-white font-['Sora']">Torneos</h2>
      </div>

      {msg && (
        <div className={`mb-3 flex items-center gap-2 text-xs font-semibold ${msg.type === 'ok' ? 'text-emerald-500' : 'text-rose-500'}`}>
          {msg.type === 'ok' ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}{msg.text}
        </div>
      )}

      {/* Lista */}
      <div className="space-y-2 mb-5">
        {loading ? <p className="text-sm text-slate-400">Cargando…</p> : items.map(t => (
          <div key={t.id} className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 dark:bg-white/5">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">{t.name}</p>
              <p className="text-[11px] text-slate-500">{KIND[t.kind]} · {t.source === 'espn' ? 'sync ESPN' : 'manual'}{t.season ? ` · ${t.season}` : ''}</p>
            </div>
            <select value={t.status} onChange={e => setStatus(t, e.target.value)} disabled={busy}
              className="text-[11px] font-bold bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-lg px-2 py-1.5 text-slate-700 dark:text-slate-200">
              {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
        ))}
      </div>

      {/* Crear */}
      <div className="space-y-3 border-t border-white/5 pt-4">
        <p className="text-xs font-semibold text-slate-500 uppercase">Nuevo torneo</p>
        <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Nombre (ej. LaLiga 25/26)"
          className="w-full bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl px-4 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-accent" />
        <div className="grid grid-cols-2 gap-2">
          <select value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })}
            className="bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2.5 text-sm text-slate-900 dark:text-white">
            <option value="league">📊 Liga</option><option value="cup">🏆 Copa</option>
          </select>
          <select value={form.source} onChange={e => setForm({ ...form, source: e.target.value })}
            className="bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2.5 text-sm text-slate-900 dark:text-white">
            <option value="manual">Carga manual</option><option value="espn">Sync ESPN</option>
          </select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <input value={form.external_ref} onChange={e => setForm({ ...form, external_ref: e.target.value })} placeholder="Código liga (ESPN)"
            className="bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-accent" />
          <input value={form.season} onChange={e => setForm({ ...form, season: e.target.value })} placeholder="Temporada (ej. 2026)"
            className="bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-accent" />
        </div>
        <button onClick={create} disabled={busy}
          className="w-full flex items-center justify-center gap-2 font-bold text-sm py-3 rounded-xl text-slate-950 bg-accent hover:bg-accent-light disabled:opacity-50">
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} Crear torneo
        </button>
        <p className="text-[11px] text-slate-400">Nota: el torneo se crea vacío. Cargar sus partidos (manual o sync) es el siguiente paso.</p>
      </div>
    </div>
  )
}
