/* Panel de administración DE LA QUINIELA.

   Es aparte de Reglas a propósito: Reglas lo ve todo el grupo (las reglas y el
   pozo son material de confianza, tienen que estar a la vista de todos). Esto
   son ACCIONES que solo un admin ejecuta, y mezclarlas ahí haría que la
   mayoría vea botones que no puede usar.

   Quién entra: el creador de la quiniela, los co-admins que él nombró
   (migración 59) y el admin global de la app, que siempre tiene acceso.

   LO QUE ESTE PANEL NO HACE: tocar resultados de partidos. Los partidos son
   compartidos por todas las quinielas del mismo torneo, así que eso sigue
   siendo del panel de admin global. */
import { useState, useMemo } from 'react'
import { motion } from 'motion/react'
import { Megaphone, ImageDown, Loader2, Check, AlertTriangle, ShieldCheck } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { partidosDeHoy, horaCostaRica } from '../../lib/partidosDelDia'
import { renderPartidosDeHoyCard, compartirImagen } from '../../lib/shareCard'

export default function PanelAdminQuiniela({ leagueId, nombreQuiniela, matches = [], soyAdminGlobal }) {
  const hoy = useMemo(() => partidosDeHoy(matches), [matches])
  const [avisando, setAvisando] = useState(false)
  const [resultado, setResultado] = useState(null)
  const [error, setError] = useState(null)
  const [generando, setGenerando] = useState(false)

  const avisar = async () => {
    try {
      setAvisando(true); setError(null); setResultado(null)
      const { data: { session } } = await supabase.auth.getSession()
      const r = await fetch('/_backend/api/matches/notify-daily-league', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ league_id: leagueId }),
      })
      const json = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(json.detail || `Error ${r.status}`)
      setResultado(json)
    } catch (e) {
      setError(e.message)
    } finally {
      setAvisando(false)
    }
  }

  const compartirImagenDelDia = async () => {
    if (generando) return
    try {
      setGenerando(true); setError(null)
      const blob = await renderPartidosDeHoyCard({
        nombreQuiniela, partidos: hoy, horaDe: horaCostaRica,
      })
      await compartirImagen(blob, 'partidos-de-hoy.png', `${nombreQuiniela} · Partidos de hoy`)
    } catch (e) {
      setError(e.message)
    } finally {
      setGenerando(false)
    }
  }

  return (
    <div className="rounded-[14px] bg-white dark:bg-[#161616] border border-slate-200 dark:border-[#262626] p-4">
      <div className="flex items-center gap-2 mb-1">
        <ShieldCheck size={15} className="text-accent" />
        <h3 className="font-bold font-['Archivo'] text-[13px] text-slate-900 dark:text-[#F3F1EA]">
          Acciones de admin
        </h3>
        {soyAdminGlobal && (
          <span className="ml-auto font-['JetBrains_Mono'] font-bold text-[9px] px-2 py-0.5 rounded-[20px]"
            style={{ color: '#E8B75A', background: 'rgba(232,183,90,.14)' }}>
            ADMIN GLOBAL
          </span>
        )}
      </div>
      <p className="text-[11px] text-[var(--text-muted,#8A8A8A)] mb-3">
        Solo lo ven los administradores de esta quiniela. Los resultados de los
        partidos no se tocan desde acá: son compartidos con las demás quinielas
        del torneo.
      </p>

      <div className="rounded-xl bg-slate-50 dark:bg-[#0C0C0C] border border-slate-200 dark:border-[#262626] p-3 mb-3">
        <p className="font-['JetBrains_Mono'] text-[9px] uppercase tracking-[0.12em] text-[var(--text-muted,#8A8A8A)] mb-1.5">
          Partidos de hoy
        </p>
        {hoy.length === 0 ? (
          <p className="text-[11.5px] text-[var(--text-muted,#8A8A8A)]">
            Hoy no se juega nada en esta quiniela.
          </p>
        ) : (
          hoy.map((m) => (
            <div key={m.id} className="flex items-center gap-2 py-0.5">
              <span className="font-['JetBrains_Mono'] text-[10.5px] text-[var(--text-muted,#8A8A8A)] w-[62px] shrink-0">
                {horaCostaRica(m.kickoff_at)}
              </span>
              <span className="flex-1 min-w-0 font-['Archivo'] text-[11.5px] text-slate-800 dark:text-[#F3F1EA] truncate">
                {m.home_team} <span className="text-[var(--text-muted,#8A8A8A)]">vs</span> {m.away_team}
              </span>
            </div>
          ))
        )}
      </div>

      <div className="space-y-2">
        <motion.button whileTap={{ scale: 0.98 }} onClick={avisar}
          disabled={avisando || hoy.length === 0}
          className="w-full rounded-xl py-2.5 font-['Archivo'] font-bold text-[12.5px] flex items-center justify-center gap-1.5 disabled:opacity-40"
          style={{ background: 'rgba(46,211,183,.12)', color: '#2ED3B7' }}>
          {avisando ? <Loader2 size={14} className="animate-spin" /> : <Megaphone size={14} />}
          {avisando ? 'Enviando…' : 'Mandar el push a la quiniela'}
        </motion.button>

        <motion.button whileTap={{ scale: 0.98 }} onClick={compartirImagenDelDia}
          disabled={generando || hoy.length === 0}
          className="w-full rounded-xl py-2.5 font-['Archivo'] font-bold text-[12.5px] flex items-center justify-center gap-1.5 bg-slate-100 dark:bg-white/5 text-slate-700 dark:text-slate-200 disabled:opacity-40">
          {generando ? <Loader2 size={14} className="animate-spin" /> : <ImageDown size={14} />}
          {generando ? 'Generando…' : 'Compartir la imagen del día'}
        </motion.button>
      </div>

      {/* El push ya sale solo a las 6am: esto es para reforzarlo, no para
          reemplazarlo. Decirlo evita que alguien lo mande tres veces. */}
      <p className="text-[10px] text-[var(--text-muted,#8A8A8A)] mt-2.5">
        El aviso automático sale todos los días a las 6:00 am. Este botón es por
        si querés reforzarlo.
      </p>

      {resultado && (
        <div className="mt-3 flex items-start gap-2 rounded-xl p-2.5"
          style={{ background: 'rgba(46,211,183,.10)' }}>
          <Check size={14} className="text-accent shrink-0 mt-0.5" />
          <p className="text-[11.5px] text-slate-700 dark:text-slate-200">
            {resultado.partidos === 0
              ? resultado.mensaje
              : <>Aviso enviado a <strong>{resultado.enviados}</strong> dispositivo(s)
                  de <strong>{resultado.personas}</strong> persona(s).
                  {resultado.sin_dispositivo > 0 && (
                    <span className="block text-[10.5px] text-[var(--text-muted,#8A8A8A)] mt-0.5">
                      {resultado.sin_dispositivo} no tienen las notificaciones activadas.
                    </span>
                  )}</>}
          </p>
        </div>
      )}

      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-xl p-2.5 border"
          style={{ background: 'rgba(255,90,90,.08)', borderColor: 'rgba(255,90,90,.3)' }}>
          <AlertTriangle size={14} className="text-rose-500 shrink-0 mt-0.5" />
          <p className="text-[11.5px] text-slate-700 dark:text-slate-200">{error}</p>
        </div>
      )}
    </div>
  )
}
