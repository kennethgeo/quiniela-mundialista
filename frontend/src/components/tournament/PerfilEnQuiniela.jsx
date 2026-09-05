/* Perfil de una persona DENTRO de una quiniela.

   El perfil de la app era uno solo y mezclaba todo: juntaba las predicciones de
   todas las quinielas en un mismo montón. Pero el jugador piensa por quiniela
   —"en la Bundestica voy 3º"—, así que los números de acá son SOLO de esta
   quiniela. El número global vive en el hub y no se mezcla.

   Todo sale de perfil_en_quiniela() (migración 63), que a su vez reusa
   league_table (el desempate oficial) y league_jornadas (las rachas). No se
   recalcula nada en el navegador. */
import { useState } from 'react'
import { motion } from 'motion/react'
import { useConsultaDelUsuario } from '../../hooks/useConsultaDelUsuario'
import { X, Zap, Flame, Swords, Loader2, Trophy, AlertTriangle, Share2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { MedalStrip } from '../medals/BadgeShowcase'
import { renderMiTemporadaCard, compartirImagen } from '../../lib/shareCard'

const ORO = '#E8B75A'

export default function PerfilEnQuiniela({ leagueId, userId, nombreQuiniela, onClose, onCaraACara }) {
  const [generando, setGenerando] = useState(false)

  const compartir = async (p) => {
    if (generando) return
    setGenerando(true)
    try {
      const blob = await renderMiTemporadaCard({ nombreQuiniela: nombreQuiniela || '', p })
      await compartirImagen(blob, 'mi-temporada.png', `${p.display_name} · ${nombreQuiniela}`)
    } catch {
      /* Sin canvas no hay tarjeta; el perfil se sigue viendo igual. */
    } finally {
      setGenerando(false)
    }
  }
  const { data: p, isLoading, isError, error } = useConsultaDelUsuario({
    queryKey: ['perfil_en_quiniela', leagueId, userId],
    enabled: !!leagueId && !!userId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('perfil_en_quiniela', {
        p_league_id: leagueId, p_user_id: userId,
      })
      if (error) throw error
      return data
    },
  })

  return (
    <>
      <motion.div className="fixed inset-0 bg-black/60 z-[90]" onClick={onClose}
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
      <div className="fixed inset-0 z-[95] grid place-items-center p-4 pointer-events-none">
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.97, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 320, damping: 28 }}
          className="pointer-events-auto w-full max-w-md rounded-[18px] bg-white dark:bg-[#161616] border border-slate-200 dark:border-[#262626] shadow-2xl max-h-[84vh] flex flex-col overflow-hidden">

          {isError || (!isLoading && !p) ? (
            /* Antes, un fallo dejaba el spinner girando para siempre y no había
               forma de saber qué pasó ni de cerrar con un botón visible. */
            <div className="p-6 text-center">
              <AlertTriangle size={20} className="text-[#FF7A59] mx-auto mb-2" />
              <p className="text-[12.5px] text-slate-700 dark:text-slate-200">No se pudo cargar este perfil.</p>
              <p className="font-['JetBrains_Mono'] text-[10px] text-[var(--text-muted,#8A8A8A)] mt-1">
                {error?.message || 'La consulta no devolvió datos.'}
              </p>
              <button onClick={onClose}
                className="mt-4 w-full rounded-xl py-2.5 font-['Archivo'] font-bold text-[12.5px] bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-300">
                Cerrar
              </button>
            </div>
          ) : isLoading ? (
            <div className="p-10 grid place-items-center">
              <Loader2 size={20} className="animate-spin text-accent" />
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2.5 px-4 py-3 border-b border-slate-200 dark:border-[#262626]">
                <div className="w-9 h-9 rounded-full grid place-items-center text-[12px] font-bold text-white overflow-hidden shrink-0"
                  style={{ background: p.soy_yo ? 'linear-gradient(135deg,#2ED3B7,#1a8f7c)' : 'linear-gradient(135deg,#5a2d8a,#3a1c5c)' }}>
                  {p.avatar_url
                    ? <img src={p.avatar_url} alt="" className="w-full h-full object-cover" />
                    : (p.display_name?.[0] || '?').toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="font-bold font-['Archivo'] text-[14px] text-slate-900 dark:text-[#F3F1EA] truncate">
                    {p.display_name}{p.soy_yo && <span className="text-accent"> (vos)</span>}
                  </h3>
                  {/* Se aclara de qué quiniela son estos números, justo porque
                      el otro perfil (el del hub) cuenta otra cosa. */}
                  <p className="font-['JetBrains_Mono'] text-[9.5px] text-[var(--text-muted,#8A8A8A)] truncate">
                    en {nombreQuiniela || 'esta quiniela'}
                  </p>
                </div>
                <button onClick={() => compartir(p)} disabled={generando}
                  title="Compartir esta temporada"
                  className="p-1 text-accent disabled:opacity-50">
                  {generando ? <Loader2 size={16} className="animate-spin" /> : <Share2 size={16} />}
                </button>
                <button onClick={onClose} className="p-1 text-[var(--text-muted,#8A8A8A)]"><X size={16} /></button>
              </div>

              <div className="flex-1 overflow-y-auto px-4 py-3">
                <div className="grid grid-cols-3 gap-2 mb-3">
                  <Dato etiqueta="Puntos" valor={Number(p.puntos)} color="#2ED3B7" />
                  <Dato etiqueta={`de ${p.miembros}`} valor={`${p.pos}º`} />
                  <Dato etiqueta="Jugados" valor={p.jugadas} />
                </div>

                <div className="grid grid-cols-3 gap-2 mb-3">
                  <Dato etiqueta="Exactos" valor={p.exactos} />
                  <Dato etiqueta="Aciertos" valor={p.aciertos} />
                  <Dato etiqueta="Error de gol" valor={p.error_goles} />
                </div>

                {/* El ×2: cuántos tiró y cuántos pegó. Es el dato que más se
                    discute en el chat y no estaba en ningún lado. */}
                <Fila icono={<Zap size={13} className="text-accent" />} etiqueta="Comodines ×2"
                  valor={p.x2_usados === 0 ? 'ninguno todavía'
                    : `${p.x2_pegados} de ${p.x2_usados} pegados${p.exactos_x2 ? ` · ${p.exactos_x2} exactos` : ''}`} />

                <Fila icono={<Trophy size={13} style={{ color: ORO }} />} etiqueta="Jornadas ganadas"
                  valor={p.jornadas_ganadas === 0 ? 'ninguna' : `${p.jornadas_ganadas}${p.mejor_racha > 1 ? ` · mejor racha ${p.mejor_racha}` : ''}`} />

                {p.racha_actual >= 2 && (
                  <Fila icono={<Flame size={13} className="text-[#FF7A59]" />} etiqueta="Viene caliente"
                    valor={`${p.racha_actual} jornadas seguidas`} />
                )}

                {Array.isArray(p.forma) && p.forma.length > 0 && (
                  <div className="flex items-center gap-2 py-1.5">
                    <span className="font-['Archivo'] text-[11.5px] text-[var(--text-muted,#8A8A8A)]">Últimas jornadas</span>
                    <div className="flex items-center gap-[3px] ml-auto">
                      {p.forma.map((f) => (
                        <span key={f.jkey} title={`${f.label}: ${Number(f.puntos)} pts${f.gano ? ' · ganada' : ''}`}
                          className="w-[7px] h-[7px] rounded-full"
                          style={{
                            background: f.gano ? ORO : 'transparent',
                            border: f.gano ? 'none' : `1px solid ${Number(f.puntos) > 0 ? '#2ED3B7' : 'rgba(127,127,127,.45)'}`,
                          }} />
                      ))}
                    </div>
                  </div>
                )}

                {p.mejor_partido && (
                  <div className="mt-2 rounded-xl bg-slate-50 dark:bg-[#0C0C0C] border border-slate-200 dark:border-[#262626] p-2.5">
                    <p className="font-['JetBrains_Mono'] text-[9px] uppercase tracking-[0.12em] text-[var(--text-muted,#8A8A8A)] mb-1">
                      Su mejor partido acá
                    </p>
                    <p className="font-['Archivo'] text-[12px] text-slate-800 dark:text-[#F3F1EA]">
                      {p.mejor_partido.local} <span className="text-[var(--text-muted,#8A8A8A)]">vs</span> {p.mejor_partido.visita}
                    </p>
                    <p className="font-['JetBrains_Mono'] text-[11px] mt-0.5">
                      <span className="text-[var(--text-muted,#8A8A8A)]">predijo</span> <strong>{p.mejor_partido.prediccion}</strong>
                      <span className="text-slate-400 mx-1.5">·</span>
                      <span className="text-[var(--text-muted,#8A8A8A)]">quedó</span> <strong>{p.mejor_partido.marcador}</strong>
                      <span className="text-slate-400 mx-1.5">·</span>
                      <strong className="text-accent">+{p.mejor_partido.puntos}</strong>
                      {p.mejor_partido.x2 && <Zap size={9} className="inline ml-1 text-accent fill-current" />}
                    </p>
                  </div>
                )}

                {Array.isArray(p.medallas) && p.medallas.length > 0 && (
                  <div className="mt-2.5 flex items-center gap-2">
                    <span className="font-['Archivo'] text-[11.5px] text-[var(--text-muted,#8A8A8A)]">Medallas acá</span>
                    <div className="ml-auto"><MedalStrip keys={p.medallas} max={8} /></div>
                  </div>
                )}
              </div>

              {!p.soy_yo && onCaraACara && (
                <div className="px-4 py-3 border-t border-slate-200 dark:border-[#262626]">
                  <button onClick={onCaraACara}
                    className="w-full rounded-xl py-2.5 font-['Archivo'] font-bold text-[12.5px] flex items-center justify-center gap-1.5"
                    style={{ background: 'rgba(46,211,183,.12)', color: '#2ED3B7' }}>
                    <Swords size={14} /> Cara a cara contra vos
                  </button>
                </div>
              )}
            </>
          )}
        </motion.div>
      </div>
    </>
  )
}

function Dato({ etiqueta, valor, color }) {
  return (
    <div className="rounded-xl bg-slate-50 dark:bg-[#0C0C0C] border border-slate-200 dark:border-[#262626] p-2 text-center">
      <div className="font-['JetBrains_Mono'] font-bold text-[15px]" style={color ? { color } : undefined}>{valor}</div>
      <div className="font-['Archivo'] text-[8.5px] uppercase tracking-wide text-[var(--text-muted,#8A8A8A)] mt-0.5">{etiqueta}</div>
    </div>
  )
}

function Fila({ icono, etiqueta, valor }) {
  return (
    <div className="flex items-center gap-2 py-1.5 border-b border-slate-100 dark:border-[#1e1e1e] last:border-0">
      {icono}
      <span className="font-['Archivo'] text-[11.5px] text-[var(--text-muted,#8A8A8A)]">{etiqueta}</span>
      <span className="ml-auto font-['Archivo'] text-[11.5px] font-semibold text-slate-800 dark:text-[#F3F1EA] text-right">{valor}</span>
    </div>
  )
}
