/* Admin: banner de anuncio (global_settings) + notificación push a todos. */
import { useState, useEffect } from 'react'
import { motion } from 'motion/react'
import { Megaphone, Save, Bell, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react'
import { supabase } from '../../lib/supabase'

export default function AnnouncementsAdmin() {
  const [text, setText] = useState('')
  const [active, setActive] = useState(false)
  const [savingBanner, setSavingBanner] = useState(false)

  const [pushTitle, setPushTitle] = useState('')
  const [pushBody, setPushBody] = useState('')
  const [sending, setSending] = useState(false)

  const [msg, setMsg] = useState(null)
  const flash = (type, t) => { setMsg({ type, text: t }); setTimeout(() => setMsg(null), 5000) }

  useEffect(() => {
    supabase.from('global_settings').select('announcement, announcement_active').eq('id', 1).single()
      .then(({ data }) => { if (data) { setText(data.announcement || ''); setActive(!!data.announcement_active) } })
  }, [])

  const saveBanner = async () => {
    try {
      setSavingBanner(true)
      const { error } = await supabase.from('global_settings')
        .upsert({ id: 1, announcement: text, announcement_active: active })
      if (error) throw error
      flash('ok', 'Anuncio guardado.')
    } catch (err) { flash('error', 'Error al guardar: ' + err.message) } finally { setSavingBanner(false) }
  }

  const sendPush = async () => {
    if (!pushTitle.trim() || !pushBody.trim()) { flash('error', 'Título y mensaje son obligatorios'); return }
    if (!confirm('¿Enviar esta notificación push a TODOS los jugadores?')) return
    try {
      setSending(true)
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      const res = await fetch('/_backend/api/admin/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ title: pushTitle.trim(), body: pushBody.trim(), url: '/' }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.detail || `Error ${res.status}`)
      const sent = typeof json?.result === 'number' ? json.result : null
      flash('ok', `Notificación enviada${sent !== null ? ` a ${sent} dispositivo(s)` : ''}.`)
      setPushTitle(''); setPushBody('')
    } catch (err) { flash('error', err.message) } finally { setSending(false) }
  }

  return (
    <div className="glass-card p-5 mt-4">
      <div className="flex items-center gap-2 mb-4 border-b border-white/10 pb-3">
        <Megaphone className="text-accent" size={20} />
        <h2 className="text-lg font-bold text-slate-900 dark:text-white">Anuncios y Notificaciones</h2>
      </div>

      {msg && (
        <div className={`mb-4 flex items-center gap-2 text-xs font-semibold ${msg.type === 'ok' ? 'text-emerald-500' : 'text-rose-500'}`}>
          {msg.type === 'ok' ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}{msg.text}
        </div>
      )}

      {/* Banner */}
      <div className="space-y-3">
        <label className="block text-xs font-semibold text-slate-500 uppercase">Banner en la app</label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          maxLength={280}
          placeholder="Ej. ¡Ya abrió octavos! Pongan sus marcadores antes del sábado 11am."
          className="w-full bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white resize-none focus:outline-none focus:border-accent"
        />
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="accent-accent w-4 h-4" />
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">Mostrar banner a todos</span>
          </label>
          <button onClick={saveBanner} disabled={savingBanner}
            className="px-4 py-2 rounded-xl bg-accent/20 text-accent text-sm font-bold hover:bg-accent/30 flex items-center gap-1.5 disabled:opacity-50">
            {savingBanner ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Guardar banner
          </button>
        </div>
      </div>

      {/* Push */}
      <div className="mt-6 pt-4 border-t border-white/5 space-y-3">
        <label className="block text-xs font-semibold text-slate-500 uppercase">Notificación push a todos</label>
        <input value={pushTitle} onChange={(e) => setPushTitle(e.target.value)} maxLength={60} placeholder="Título (ej. ⚽ Quiniela)"
          className="w-full bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 rounded-xl px-4 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-accent" />
        <textarea value={pushBody} onChange={(e) => setPushBody(e.target.value)} rows={2} maxLength={180} placeholder="Mensaje..."
          className="w-full bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 rounded-xl px-4 py-2.5 text-sm text-slate-900 dark:text-white resize-none focus:outline-none focus:border-accent" />
        <div className="flex justify-end">
          <button onClick={sendPush} disabled={sending}
            className="px-4 py-2 rounded-xl bg-accent text-slate-950 text-sm font-bold hover:bg-accent-light flex items-center gap-1.5 disabled:opacity-50">
            {sending ? <Loader2 size={15} className="animate-spin" /> : <Bell size={15} />} Enviar push
          </button>
        </div>
      </div>
    </div>
  )
}
