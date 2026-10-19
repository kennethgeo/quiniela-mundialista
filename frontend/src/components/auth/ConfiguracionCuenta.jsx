import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { cambiarNombre } from '../../lib/cuenta'

export default function ConfiguracionCuenta({ user, profile, onSaved }) {
  const [editando, setEditando] = useState(false)
  const [nombre, setNombre] = useState(profile.display_name || '')
  const [anterior, setAnterior] = useState(profile.display_name)
  const [busy, setBusy] = useState(null)
  const [aviso, setAviso] = useState(null)
  const guardar = async (e) => {
    e.preventDefault()
    if (busy) return
    setBusy('nombre'); setAviso(null)
    try {
      await cambiarNombre({ client: supabase, userId: user.id, anterior, nombre })
      setEditando(false)
      await onSaved(user.id)
      setAviso({ texto: 'Nombre actualizado.' })
    } catch (error) { setAviso({ error: true, texto: error.message }) }
    finally { setBusy(null) }
  }
  const cambiarClave = async () => {
    if (busy || !user.email) return
    setBusy('clave'); setAviso(null)
    try {
      // Se envía al correo de esta cuenta. No hay contraseñas en el perfil ni
      // en localStorage; se reutiliza la recuperación y su página existente.
      const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
        redirectTo: `${window.location.origin}/reset-password`,
      })
      if (error) throw error
      setAviso({ texto: `Revisá ${user.email}: solicitamos el enlace para cambiar tu contraseña.` })
    } catch { setAviso({ error: true, texto: 'No pudimos solicitar el enlace. Volvé a intentar en unos minutos.' }) }
    finally { setBusy(null) }
  }
  return (
    <section aria-label="Configuración de cuenta" className="glass-card p-4 mb-5 space-y-3 text-slate-800 dark:text-slate-200">
      <h2 className="font-bold">Tu cuenta</h2>
      {editando ? (
        <form onSubmit={guardar} className="space-y-2">
          <label htmlFor="nombre-perfil" className="block text-sm">Nombre visible</label>
          <input id="nombre-perfil" autoComplete="nickname" value={nombre} onChange={e => setNombre(e.target.value)}
            minLength={2} maxLength={50} required disabled={!!busy}
            className="w-full rounded-xl p-3 bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600" />
          <div className="flex gap-4 text-sm font-semibold">
            <button type="submit" disabled={!!busy} className="py-2 text-emerald-700 dark:text-emerald-300 disabled:opacity-50">{busy === 'nombre' ? 'Guardando…' : 'Guardar nombre'}</button>
            <button type="button" disabled={!!busy} onClick={() => setEditando(false)} className="py-2">Cancelar</button>
          </div>
        </form>
      ) : <button disabled={!!busy} onClick={() => { setNombre(profile.display_name || ''); setAnterior(profile.display_name); setAviso(null); setEditando(true) }} className="block py-2 text-sm font-semibold">Editar nombre</button>}
      <button disabled={!!busy || !user.email} onClick={cambiarClave} className="block py-2 text-sm font-semibold disabled:opacity-50">
        {busy === 'clave' ? 'Solicitando enlace…' : 'Cambiar contraseña por correo'}
      </button>
      {aviso && <p role={aviso.error ? 'alert' : 'status'} className={`text-sm ${aviso.error ? 'text-rose-700 dark:text-rose-300' : ''}`}>{aviso.texto}</p>}
    </section>
  )
}
