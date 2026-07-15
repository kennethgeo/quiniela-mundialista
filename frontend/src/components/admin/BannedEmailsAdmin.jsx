/* Admin: lista negra de correos (no pueden registrarse). */
import { useState, useEffect } from 'react'
import { Ban, Plus, Loader2, RotateCcw, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'

export default function BannedEmailsAdmin() {
  const [bans, setBans] = useState([])
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const flash = (type, text) => { setMsg({ type, text }); setTimeout(() => setMsg(null), 4000) }

  const load = async () => {
    setLoading(true)
    const { data } = await supabase.from('banned_emails').select('*').order('banned_at', { ascending: false })
    setBans(data || [])
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

  const add = async () => {
    const e = email.trim().toLowerCase()
    if (!e || !e.includes('@')) { flash('error', 'Correo inválido'); return }
    try {
      setBusy(true)
      await callAdmin('ban-email', { email: e, reason: 'Bloqueado manualmente' })
      setEmail('')
      await load()
      flash('ok', `${e} bloqueado.`)
    } catch (err) { flash('error', err.message) } finally { setBusy(false) }
  }

  const unban = async (e) => {
    if (!confirm(`¿Desbloquear ${e}? Podrá registrarse de nuevo.`)) return
    try {
      setBusy(true)
      await callAdmin('unban-email', { email: e })
      setBans((prev) => prev.filter((b) => b.email !== e))
      flash('ok', `${e} desbloqueado.`)
    } catch (err) { flash('error', err.message) } finally { setBusy(false) }
  }

  return (
    <div className="glass-card p-5 mt-4">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-9 h-9 rounded-xl bg-rose-500/15 flex items-center justify-center">
          <Ban size={18} className="text-rose-500" />
        </div>
        <div>
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">Correos bloqueados</h3>
          <p className="text-[11px] text-slate-500">Estos correos no pueden registrarse.</p>
        </div>
      </div>

      <div className="mt-4 flex gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder="correo@ejemplo.com"
          className="flex-1 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2 text-sm text-slate-900 dark:text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <button onClick={add} disabled={busy} className="px-3 py-2 rounded-xl bg-rose-500/20 text-rose-500 text-sm font-bold hover:bg-rose-500/30 flex items-center gap-1.5 disabled:opacity-50">
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} Bloquear
        </button>
      </div>

      {msg && (
        <div className={`mt-3 flex items-center gap-2 text-xs font-semibold ${msg.type === 'ok' ? 'text-emerald-500' : 'text-rose-500'}`}>
          {msg.type === 'ok' ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}{msg.text}
        </div>
      )}

      <div className="mt-4 space-y-1.5 max-h-72 overflow-y-auto">
        {loading ? (
          <div className="text-center py-4 text-slate-400 text-sm">Cargando...</div>
        ) : bans.length === 0 ? (
          <p className="text-xs text-slate-400 italic text-center py-3">No hay correos bloqueados.</p>
        ) : (
          bans.map((b) => (
            <div key={b.email} className="flex items-center justify-between gap-3 py-2 px-2.5 rounded-lg bg-slate-50 dark:bg-white/5">
              <span className="text-sm text-slate-800 dark:text-slate-100 truncate">{b.email}</span>
              <button onClick={() => unban(b.email)} disabled={busy} title="Desbloquear"
                className="shrink-0 px-2.5 py-1 rounded-lg text-xs font-bold text-emerald-500 hover:bg-emerald-500/10 flex items-center gap-1 disabled:opacity-40">
                <RotateCcw size={13} /> Desbloquear
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
