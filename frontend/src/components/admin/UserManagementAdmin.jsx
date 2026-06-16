/* Admin: gestión de usuarios — borrar usuarios y todos sus datos */
import { useState, useEffect } from 'react'
import { Trash2, Loader2, ShieldCheck, AlertTriangle, CheckCircle2, Search } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'

export default function UserManagementAdmin() {
  const { profile } = useAuth()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [deletingId, setDeletingId] = useState(null)
  const [search, setSearch] = useState('')
  const [message, setMessage] = useState(null)

  useEffect(() => {
    load()
  }, [])

  const load = async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('users')
      .select('id, display_name, total_points, is_admin')
      .order('total_points', { ascending: false })
    if (!error) setUsers(data || [])
    setLoading(false)
  }

  const remove = async (u) => {
    const name = u.display_name || u.id
    if (!confirm(`¿Borrar a "${name}"?\n\nSe eliminarán de forma PERMANENTE todos sus datos: predicciones, puntos, membresías y su acceso. Esta acción no se puede deshacer.`)) return
    try {
      setDeletingId(u.id)
      setMessage(null)
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error('Sesión no válida, vuelve a iniciar sesión')

      const res = await fetch('/_backend/api/admin/delete-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ user_id: u.id }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.detail || `Error ${res.status}`)

      setUsers((prev) => prev.filter((x) => x.id !== u.id))
      setMessage({ type: 'ok', text: `Usuario "${name}" eliminado.` })
    } catch (err) {
      setMessage({ type: 'error', text: err.message })
    } finally {
      setDeletingId(null)
    }
  }

  const filtered = users.filter((u) => (u.display_name || '').toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="glass-card p-5">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-9 h-9 rounded-xl bg-rose-500/15 flex items-center justify-center">
          <Trash2 size={18} className="text-rose-500" />
        </div>
        <div>
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">Gestión de usuarios</h3>
          <p className="text-[11px] text-slate-500">Borra un usuario y todos sus datos. Permanente.</p>
        </div>
      </div>

      <div className="mt-3 flex items-start gap-2 text-[11px] text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg p-2.5">
        <AlertTriangle size={14} className="shrink-0 mt-0.5" />
        <span>Acción irreversible. Se eliminan predicciones, puntos, chat y membresías. Si el usuario es <b>admin de una liga</b>, esa liga se elimina con él.</span>
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

      <div className="mt-4 space-y-1.5 max-h-96 overflow-y-auto">
        {loading ? (
          <div className="text-center py-6 text-slate-400 text-sm">Cargando usuarios...</div>
        ) : (
          filtered.map((u) => {
            const isSelf = u.id === profile?.id
            return (
              <div key={u.id} className="flex items-center justify-between gap-3 py-2 px-2.5 rounded-lg bg-slate-50 dark:bg-white/5">
                <div className="min-w-0 flex items-center gap-2">
                  <span className="text-sm text-slate-800 dark:text-slate-100 truncate">{u.display_name || u.id}</span>
                  {u.is_admin && <ShieldCheck size={13} className="text-accent shrink-0" title="Administrador" />}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-xs text-slate-500 tabular-nums">{u.total_points ?? 0} pts</span>
                  <button
                    onClick={() => remove(u)}
                    disabled={isSelf || deletingId === u.id}
                    title={isSelf ? 'No puedes borrarte a ti mismo' : 'Borrar usuario'}
                    className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-500/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    {deletingId === u.id ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
