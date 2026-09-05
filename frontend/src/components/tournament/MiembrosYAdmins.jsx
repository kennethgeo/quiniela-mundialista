/* Miembros de la quiniela: quién es quién y quién puede administrar.

   El problema que resuelve: hasta ahora administrar era de UNA sola persona
   (leagues.admin_id). Si esa persona no está, nadie corrige nada, nadie
   confirma un pago y nadie cierra una votación. Con plata de por medio eso es
   un punto único de falla.

   El modelo tiene dos niveles a propósito:
     · el CREADOR nombra y quita administradores, y no se le puede quitar
     · cualquier ADMIN edita reglas, puntaje, pozo, pagos y votaciones

   Que nombrar admins sea solo del creador evita lo obvio: un co-admin
   promoviéndose gente hasta quedarse con la quiniela.

   Nada de esto toca los RESULTADOS de los partidos: los partidos son
   compartidos por todas las quinielas del mismo torneo. */
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useConsultaDelUsuario } from '../../hooks/useConsultaDelUsuario'
import { Users, Crown, Shield, Loader2, UserMinus, AlertTriangle } from 'lucide-react'
import { supabase } from '../../lib/supabase'

export default function MiembrosYAdmins({ leagueId }) {
  const qc = useQueryClient()
  const [porExpulsar, setPorExpulsar] = useState(null)
  const [error, setError] = useState(null)

  const { data: gente = [], isLoading } = useConsultaDelUsuario({
    queryKey: ['league_miembros', leagueId],
    enabled: !!leagueId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('league_miembros', { p_league_id: leagueId })
      if (error) throw error
      return data || []
    },
  })

  const refrescar = () => {
    qc.invalidateQueries({ queryKey: ['league_miembros', leagueId] })
    qc.invalidateQueries({ queryKey: ['league_pozo', leagueId] })
    qc.invalidateQueries({ queryKey: ['my_groups'] })
  }

  const cambiarRol = useMutation({
    mutationFn: async ({ userId, esAdmin }) => {
      const { error } = await supabase.rpc('set_league_admin', {
        p_league_id: leagueId, p_user_id: userId, p_es_admin: esAdmin,
      })
      if (error) throw error
    },
    onSuccess: () => { setError(null); refrescar() },
    onError: (e) => setError(e.message),
  })

  const expulsar = useMutation({
    mutationFn: async (userId) => {
      const { error } = await supabase.rpc('expulsar_miembro', {
        p_league_id: leagueId, p_user_id: userId,
      })
      if (error) throw error
    },
    onSuccess: () => { setError(null); setPorExpulsar(null); refrescar() },
    onError: (e) => { setError(e.message); setPorExpulsar(null) },
  })

  if (isLoading) return null

  const yo = gente.find((g) => g.soy_yo)
  const soyCreador = !!yo?.es_creador
  const soyAdmin = !!yo?.es_admin
  const admins = gente.filter((g) => g.es_admin).length

  return (
    <div className="rounded-[14px] bg-white dark:bg-[#161616] border border-slate-200 dark:border-[#262626] p-4 mt-4">
      <div className="flex items-center gap-2 mb-1">
        <Users size={15} className="text-accent" />
        <h3 className="font-bold font-['Archivo'] text-[13px] text-slate-900 dark:text-[#F3F1EA]">
          Miembros
        </h3>
        <span className="ml-auto font-['JetBrains_Mono'] text-[10px] text-[var(--text-muted,#8A8A8A)]">
          {gente.length} · {admins} {admins === 1 ? 'admin' : 'admins'}
        </span>
      </div>

      <p className="text-[11px] text-[var(--text-muted,#8A8A8A)] mb-3">
        {soyCreador
          ? 'Podés nombrar administradores para que no dependa todo de vos: editan reglas, el pozo y confirman pagos.'
          : soyAdmin
            ? 'Sos administrador: podés editar reglas, el pozo y confirmar pagos.'
            : 'Los administradores editan las reglas, el pozo y confirman los pagos.'}
      </p>

      <div className="space-y-1">
        {gente.map((g) => (
          <div key={g.user_id} className="flex items-center gap-2 py-1">
            <div className="w-7 h-7 rounded-full grid place-items-center text-[10px] font-bold text-white overflow-hidden shrink-0"
              style={{ background: g.soy_yo ? 'linear-gradient(135deg,#2ED3B7,#1a8f7c)' : 'linear-gradient(135deg,#5a2d8a,#3a1c5c)' }}>
              {g.avatar_url
                ? <img src={g.avatar_url} alt="" className="w-full h-full object-cover" />
                : (g.display_name?.[0] || '?').toUpperCase()}
            </div>

            <span className="flex-1 min-w-0 font-['Archivo'] text-[12px] text-slate-800 dark:text-[#F3F1EA] truncate">
              {g.display_name}
              {g.soy_yo && <span className="text-accent font-bold"> (vos)</span>}
            </span>

            <Rol g={g} />

            {/* Nombrar/quitar admin: solo el creador, y nunca sobre sí mismo. */}
            {soyCreador && !g.es_creador && (
              <button
                onClick={() => cambiarRol.mutate({ userId: g.user_id, esAdmin: !g.es_admin })}
                disabled={cambiarRol.isPending}
                title={g.es_admin ? 'Quitar como administrador' : 'Hacer administrador'}
                className="shrink-0 text-[10px] font-bold px-2 py-1 rounded-lg disabled:opacity-50"
                style={g.es_admin
                  ? { color: 'var(--text-muted,#8A8A8A)', background: 'rgba(127,127,127,.12)' }
                  : { color: '#2ED3B7', background: 'rgba(46,211,183,.12)' }}>
                {g.es_admin ? 'quitar' : 'hacer admin'}
              </button>
            )}

            {/* Expulsar: cualquier admin, menos al creador y menos a uno mismo. */}
            {soyAdmin && !g.es_creador && !g.soy_yo && (
              <button onClick={() => setPorExpulsar(g)} disabled={expulsar.isPending}
                title="Sacar de la quiniela"
                className="shrink-0 p-1 text-rose-500/70 hover:text-rose-500 disabled:opacity-50">
                <UserMinus size={13} />
              </button>
            )}
          </div>
        ))}
      </div>

      {error && <p className="text-[11px] text-rose-500 mt-2">{error}</p>}

      {/* Expulsar borra predicciones: se confirma antes, no se deshace. */}
      {porExpulsar && (
        <div className="mt-3 rounded-xl p-3 border" style={{ background: 'rgba(255,90,90,.08)', borderColor: 'rgba(255,90,90,.3)' }}>
          <div className="flex items-start gap-2 mb-2">
            <AlertTriangle size={14} className="text-rose-500 shrink-0 mt-0.5" />
            <p className="text-[11.5px] text-slate-700 dark:text-slate-200">
              Sacar a <strong>{porExpulsar.display_name}</strong> también borra sus predicciones
              <strong> de esta quiniela</strong> y desaparece de la tabla. No se puede deshacer:
              tendría que volver a entrar con el código y predecir de nuevo lo que no esté cerrado.
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setPorExpulsar(null)}
              className="flex-1 rounded-xl py-2 font-['Archivo'] font-bold text-[12px] bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-300">
              Cancelar
            </button>
            <button onClick={() => expulsar.mutate(porExpulsar.user_id)} disabled={expulsar.isPending}
              className="flex-1 rounded-xl py-2 font-['Archivo'] font-bold text-[12px] text-white bg-rose-500 disabled:opacity-50 flex items-center justify-center gap-1.5">
              {expulsar.isPending ? <Loader2 size={13} className="animate-spin" /> : null} Sacar
            </button>
          </div>
        </div>
      )}

      {soyCreador && admins === 1 && gente.length > 1 && (
        <p className="text-[10.5px] text-[var(--text-muted,#8A8A8A)] mt-2.5">
          Sos el único administrador. Si nombrás a alguien más, la quiniela no se traba cuando no estés.
        </p>
      )}
    </div>
  )
}

function Rol({ g }) {
  if (g.es_creador) {
    return (
      <span className="shrink-0 flex items-center gap-1 font-['JetBrains_Mono'] font-bold text-[9px] px-1.5 py-0.5 rounded-[20px]"
        style={{ color: '#E8B75A', background: 'rgba(232,183,90,.14)' }}>
        <Crown size={9} /> creó
      </span>
    )
  }
  if (g.es_admin) {
    return (
      <span className="shrink-0 flex items-center gap-1 font-['JetBrains_Mono'] font-bold text-[9px] px-1.5 py-0.5 rounded-[20px]"
        style={{ color: '#2ED3B7', background: 'rgba(46,211,183,.14)' }}>
        <Shield size={9} /> admin
      </span>
    )
  }
  return null
}
