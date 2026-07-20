/* Admin: gestión de usuarios — editar, rol admin, ajuste de puntos, contraseña temporal y borrar */
import { useState, useEffect } from 'react'
import { Trash2, Loader2, ShieldCheck, ShieldOff, AlertTriangle, CheckCircle2, Search, Pencil, KeyRound, Save, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'

export default function UserManagementAdmin() {
  const { profile } = useAuth()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState(null)
  const [search, setSearch] = useState('')
  const [message, setMessage] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [nameDraft, setNameDraft] = useState('')
  const [adjDraft, setAdjDraft] = useState('')

  useEffect(() => { load() }, [])

  const load = async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('users')
      .select('id, display_name, total_points, is_admin, points_adjustment')
      .order('total_points', { ascending: false })
    if (!error) setUsers(data || [])
    setLoading(false)
  }

  // Llama a un endpoint /api/admin/* con el token del admin.
  const callAdmin = async (path, body) => {
    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token
    if (!token) throw new Error('Sesión no válida, vuelve a iniciar sesión')
    const res = await fetch(`/_backend/api/admin/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(json.detail || `Error ${res.status}`)
    return json
  }

  const flash = (type, text) => { setMessage({ type, text }); setTimeout(() => setMessage(null), 4000) }

  const startEdit = (u) => {
    setEditingId(u.id)
    setNameDraft(u.display_name || '')
    setAdjDraft(String(u.points_adjustment ?? 0))
  }

  const saveName = async (u) => {
    const name = nameDraft.trim()
    if (!name || name === u.display_name) { setEditingId(null); return }
    try {
      setBusyId(u.id)
      await callAdmin('update-user', { user_id: u.id, display_name: name })
      setUsers((prev) => prev.map((x) => x.id === u.id ? { ...x, display_name: name } : x))
      flash('ok', `Nombre actualizado a "${name}".`)
      setEditingId(null)
    } catch (err) { flash('error', err.message) } finally { setBusyId(null) }
  }

  const toggleAdmin = async (u) => {
    const next = !u.is_admin
    if (!confirm(next ? `¿Hacer admin a "${u.display_name}"?` : `¿Quitar admin a "${u.display_name}"?`)) return
    try {
      setBusyId(u.id)
      await callAdmin('update-user', { user_id: u.id, is_admin: next })
      setUsers((prev) => prev.map((x) => x.id === u.id ? { ...x, is_admin: next } : x))
      flash('ok', `${u.display_name} ${next ? 'ahora es admin' : 'ya no es admin'}.`)
    } catch (err) { flash('error', err.message) } finally { setBusyId(null) }
  }

  const saveAdjust = async (u) => {
    const adj = parseInt(adjDraft, 10)
    if (Number.isNaN(adj)) { flash('error', 'El ajuste debe ser un número entero'); return }
    if (adj === (u.points_adjustment ?? 0)) { setEditingId(null); return }
    try {
      setBusyId(u.id)
      await callAdmin('adjust-points', { user_id: u.id, points_adjustment: adj })
      // El total lo recalcula la BD; recargamos para reflejarlo.
      await load()
      flash('ok', `Ajuste de ${adj >= 0 ? '+' : ''}${adj} pts aplicado a ${u.display_name}.`)
      setEditingId(null)
    } catch (err) { flash('error', err.message) } finally { setBusyId(null) }
  }

  const tempPassword = async (u) => {
    if (!confirm(`¿Generar una contraseña temporal para "${u.display_name}"?\nLa actual dejará de funcionar.`)) return
    try {
      setBusyId(u.id)
      const { temp_password } = await callAdmin('set-temp-password', { user_id: u.id })
      window.prompt(`Contraseña temporal de ${u.display_name} (cópiala y compártela; que la cambie al entrar):`, temp_password)
    } catch (err) { flash('error', err.message) } finally { setBusyId(null) }
  }

  const remove = async (u) => {
    const name = u.display_name || u.id
    if (!confirm(`¿Borrar a "${name}"?\n\nSe eliminarán de forma PERMANENTE todos sus datos: predicciones, puntos, membresías y su acceso. Esta acción no se puede deshacer.`)) return
    const ban = confirm(`¿Bloquear también su correo?\n\nAceptar = NO podrá volver a registrarse con ese correo.\nCancelar = solo se borra (podría registrarse de nuevo).`)
    try {
      setBusyId(u.id)
      const res = await callAdmin('delete-user', { user_id: u.id, ban })
      setUsers((prev) => prev.filter((x) => x.id !== u.id))
      flash('ok', `Usuario "${name}" eliminado${res.banned_email ? ' y correo bloqueado' : ''}.`)
    } catch (err) { flash('error', err.message) } finally { setBusyId(null) }
  }

  const filtered = users.filter((u) => (u.display_name || '').toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="glass-card p-5">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-9 h-9 rounded-xl bg-rose-500/15 flex items-center justify-center">
          <ShieldCheck size={18} className="text-rose-500" />
        </div>
        <div>
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">Gestión de usuarios</h3>
          <p className="text-[11px] text-slate-500">Editar nombre, rol admin, ajustar puntos, contraseña temporal o borrar.</p>
        </div>
      </div>

      <div className="relative mt-4">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          placeholder="Buscar usuario..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl pl-9 pr-4 py-2 text-sm text-slate-900 dark:text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </div>

      {message && (
        <div className={`mt-3 flex items-center gap-2 text-xs font-semibold ${message.type === 'ok' ? 'text-emerald-500' : 'text-rose-500'}`}>
          {message.type === 'ok' ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
          {message.text}
        </div>
      )}

      <div className="mt-4 space-y-1.5 max-h-[28rem] overflow-y-auto">
        {loading ? (
          <div className="text-center py-6 text-slate-400 text-sm">Cargando usuarios...</div>
        ) : (
          filtered.map((u) => {
            const isSelf = u.id === profile?.id
            const isEditing = editingId === u.id
            const busy = busyId === u.id
            const adj = u.points_adjustment ?? 0
            return (
              <div key={u.id} className="rounded-xl bg-slate-50 dark:bg-white/5 border border-transparent dark:border-white/5">
                <div className="flex items-center justify-between gap-3 py-2 px-2.5">
                  <div className="min-w-0 flex items-center gap-2">
                    <span className="text-sm text-slate-800 dark:text-slate-100 truncate">{u.display_name || u.id}</span>
                    {u.is_admin && <ShieldCheck size={13} className="text-accent shrink-0" title="Administrador" />}
                    {adj !== 0 && <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${adj > 0 ? 'text-emerald-500 bg-emerald-500/10' : 'text-rose-500 bg-rose-500/10'}`}>{adj > 0 ? '+' : ''}{adj}</span>}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-xs text-slate-500 tabular-nums mr-1">{u.total_points ?? 0} pts</span>
                    <button onClick={() => (isEditing ? setEditingId(null) : startEdit(u))} disabled={busy} title="Editar" className="p-1.5 rounded-lg text-slate-500 hover:text-accent hover:bg-accent/10 disabled:opacity-30 transition-colors">
                      {isEditing ? <X size={15} /> : <Pencil size={15} />}
                    </button>
                    <button onClick={() => remove(u)} disabled={isSelf || busy} title={isSelf ? 'No puedes borrarte a ti mismo' : 'Borrar usuario'} className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-500/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                      {busy ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                    </button>
                  </div>
                </div>

                {isEditing && (
                  <div className="px-2.5 pb-3 pt-1 space-y-3 border-t border-slate-200/70 dark:border-white/5">
                    {/* Nombre */}
                    <div>
                      <label className="block text-[10px] text-slate-400 mb-1 font-semibold uppercase">Nombre</label>
                      <div className="flex gap-2">
                        <input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} maxLength={40}
                          className="flex-1 bg-white dark:bg-slate-900 border border-slate-300 dark:border-white/10 rounded-lg px-3 py-1.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-accent" />
                        <button onClick={() => saveName(u)} disabled={busy} className="px-3 py-1.5 rounded-lg bg-accent/20 text-accent text-xs font-bold hover:bg-accent/30 flex items-center gap-1"><Save size={13} /> Guardar</button>
                      </div>
                    </div>
                    {/* Ajuste de puntos */}
                    <div>
                      <label className="block text-[10px] text-slate-400 mb-1 font-semibold uppercase">Ajuste manual de puntos (reemplaza el actual)</label>
                      <div className="flex gap-2">
                        <input type="number" value={adjDraft} onChange={(e) => setAdjDraft(e.target.value)} placeholder="0 (ej. 5 o -3)"
                          className="flex-1 bg-white dark:bg-slate-900 border border-slate-300 dark:border-white/10 rounded-lg px-3 py-1.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-accent" />
                        <button onClick={() => saveAdjust(u)} disabled={busy} className="px-3 py-1.5 rounded-lg bg-accent/20 text-accent text-xs font-bold hover:bg-accent/30 flex items-center gap-1"><Save size={13} /> Aplicar</button>
                      </div>
                    </div>
                    {/* Acciones */}
                    <div className="flex flex-wrap gap-2 pt-1">
                      <button onClick={() => toggleAdmin(u)} disabled={busy || isSelf} title={isSelf ? 'No puedes cambiar tu propio rol' : ''}
                        className="px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 bg-white/5 border border-white/10 text-slate-600 dark:text-slate-300 hover:bg-white/10 disabled:opacity-30">
                        {u.is_admin ? <ShieldOff size={13} /> : <ShieldCheck size={13} />}
                        {u.is_admin ? 'Quitar admin' : 'Hacer admin'}
                      </button>
                      <button onClick={() => tempPassword(u)} disabled={busy}
                        className="px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 bg-white/5 border border-white/10 text-slate-600 dark:text-slate-300 hover:bg-white/10 disabled:opacity-30">
                        <KeyRound size={13} /> Contraseña temporal
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
