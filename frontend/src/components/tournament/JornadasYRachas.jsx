/* Quién gana cada jornada, y las rachas que salen de eso.

   La quiniela hasta ahora solo sabía decir quién va ganando EN TOTAL, pero el
   torneo se vive por jornada: "esta la gané yo", "llevo tres seguidas", "vengo
   frío". Eso se discutía de memoria en el chat.

   Todo sale de league_jornadas() (migración 60), que usa LA MISMA escalera de
   desempate que la Tabla — puntos, exactos con ×2, exactos, aciertos, jugadas,
   menor error de gol. Un segundo criterio de desempate viviendo acá sería
   volver a abrir el problema que arregló la migración 55.

   Solo se cuentan jornadas CERRADAS: una a medias todavía se puede dar vuelta,
   y anotar una racha para desanotarla después es peor que no mostrarla. */
import { useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { useConsultaDelUsuario } from '../../hooks/useConsultaDelUsuario'
import { Trophy, Flame, ChevronDown } from 'lucide-react'
import { supabase } from '../../lib/supabase'

const ORO = '#E8B75A'
const ACENTO = '#2ED3B7'

export default function JornadasYRachas({ leagueId }) {
  const [abierto, setAbierto] = useState(false)
  const sinMovimiento = useReducedMotion()

  const { data } = useConsultaDelUsuario({
    queryKey: ['league_jornadas', leagueId],
    enabled: !!leagueId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('league_jornadas', { p_league_id: leagueId })
      if (error) throw error
      return data
    },
  })

  const rachas = data?.rachas || []
  const jornadas = data?.jornadas || []
  const cerradas = jornadas.filter((j) => j.cerrada)

  // Sin ninguna jornada cerrada no hay nada honesto que decir todavía.
  if (cerradas.length === 0) return null

  const conGanadas = rachas.filter((r) => r.ganadas > 0)
  const ultima = cerradas[cerradas.length - 1]

  return (
    <div className="rounded-[14px] bg-white dark:bg-[#161616] border border-slate-200 dark:border-[#262626] p-4 mb-3">
      <div className="flex items-center gap-2 mb-1">
        <Trophy size={15} style={{ color: ORO }} />
        <h3 className="font-bold font-['Archivo'] text-[13px] text-slate-900 dark:text-[#F3F1EA]">
          Jornadas ganadas
        </h3>
        <span className="ml-auto font-['JetBrains_Mono'] text-[10px] text-[var(--text-muted,#8A8A8A)]">
          {cerradas.length} {cerradas.length === 1 ? 'cerrada' : 'cerradas'}
        </span>
      </div>

      {conGanadas.length === 0 ? (
        <p className="text-[11.5px] text-[var(--text-muted,#8A8A8A)]">
          Todavía nadie se llevó una jornada.
        </p>
      ) : (
        <>
          <p className="text-[11px] text-[var(--text-muted,#8A8A8A)] mb-3">
            Se gana la jornada con el mismo desempate de la Tabla. Hay que sumar:
            si nadie hizo puntos, la jornada queda sin dueño.
          </p>

          <div className="space-y-0.5">
            {conGanadas.map((r, i) => (
              <Fila key={r.user_id} r={r} puesto={i + 1} sinMovimiento={sinMovimiento} />
            ))}
          </div>
        </>
      )}

      <p className="font-['JetBrains_Mono'] text-[10px] text-[var(--text-muted,#8A8A8A)] mt-3">
        Última cerrada · {ultima.label} ·{' '}
        {ultima.ganador
          ? <>ganó <strong className="text-slate-700 dark:text-[#F3F1EA]">{ultima.ganador.display_name}</strong> con {Number(ultima.ganador.puntos)} pts</>
          : 'sin ganador'}
      </p>

      <button onClick={() => setAbierto(!abierto)}
        className="mt-2 flex items-center gap-1 text-[11px] font-bold text-accent">
        <ChevronDown size={13} className={`transition-transform ${abierto ? 'rotate-180' : ''}`} />
        {abierto ? 'Ocultar el detalle' : `Ver las ${cerradas.length} jornadas`}
      </button>

      {abierto && (
        <div className="mt-2 rounded-xl bg-slate-50 dark:bg-[#0C0C0C] border border-slate-200 dark:border-[#262626] p-2.5 space-y-1">
          {[...cerradas].reverse().map((j) => (
            <div key={j.jkey} className="flex items-center gap-2 py-0.5">
              <span className="font-['JetBrains_Mono'] text-[10.5px] text-[var(--text-muted,#8A8A8A)] w-[74px] shrink-0 truncate">
                {j.label}
              </span>
              {j.ganador ? (
                <>
                  <span className="flex-1 min-w-0 font-['Archivo'] text-[11.5px] text-slate-800 dark:text-[#F3F1EA] truncate">
                    {j.ganador.display_name}
                  </span>
                  <span className="font-['JetBrains_Mono'] font-bold text-[11px]" style={{ color: ORO }}>
                    {Number(j.ganador.puntos)} pts
                  </span>
                </>
              ) : (
                <span className="flex-1 font-['Archivo'] text-[11.5px] text-[var(--text-muted,#8A8A8A)] italic">
                  nadie sumó
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Fila({ r, puesto, sinMovimiento }) {
  const enRacha = r.racha_actual >= 2
  return (
    <div className="flex items-center gap-2 py-1">
      <span className="font-['JetBrains_Mono'] text-[10px] text-[var(--text-muted,#8A8A8A)] w-3 shrink-0 text-right">
        {puesto}
      </span>

      <div className="w-6 h-6 rounded-full grid place-items-center text-[9px] font-bold text-white overflow-hidden shrink-0"
        style={{ background: r.soy_yo ? 'linear-gradient(135deg,#2ED3B7,#1a8f7c)' : 'linear-gradient(135deg,#5a2d8a,#3a1c5c)' }}>
        {r.avatar_url
          ? <img src={r.avatar_url} alt="" className="w-full h-full object-cover" />
          : (r.display_name?.[0] || '?').toUpperCase()}
      </div>

      <span className="flex-1 min-w-0 font-['Archivo'] text-[12px] text-slate-800 dark:text-[#F3F1EA] truncate">
        {r.display_name}{r.soy_yo && <span className="text-accent font-bold"> (vos)</span>}
      </span>

      {/* La racha viva se anima; una racha cortada es un dato, no una fiesta. */}
      {enRacha && (
        <motion.span
          className="shrink-0 flex items-center gap-0.5 font-['JetBrains_Mono'] font-bold text-[9px] px-1.5 py-0.5 rounded-[20px]"
          style={{ color: '#FF7A59', background: 'rgba(255,122,89,.14)' }}
          animate={sinMovimiento ? undefined : { opacity: [1, 0.65, 1] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
          title={`${r.racha_actual} jornadas seguidas`}>
          <Flame size={9} /> {r.racha_actual}
        </motion.span>
      )}

      <Forma forma={r.forma} />

      <span className="font-['JetBrains_Mono'] font-bold text-[12px] shrink-0 w-6 text-right" style={{ color: ORO }}>
        {r.ganadas}
      </span>
    </div>
  )
}

/* Las últimas 5 jornadas cerradas, la más vieja a la izquierda. Un punto lleno
   es una jornada ganada. Es la forma más corta de decir "viene caliente". */
function Forma({ forma = [] }) {
  if (forma.length === 0) return null
  return (
    <div className="shrink-0 flex items-center gap-[3px]" title="Últimas jornadas cerradas">
      {forma.map((f) => (
        <span key={f.jkey}
          title={`${f.label}: ${Number(f.puntos)} pts${f.gano ? ' · ganada' : ''}`}
          className="w-[7px] h-[7px] rounded-full"
          style={{
            background: f.gano ? ORO : 'transparent',
            border: f.gano ? 'none' : `1px solid ${Number(f.puntos) > 0 ? ACENTO : 'rgba(127,127,127,.45)'}`,
          }} />
      ))}
    </div>
  )
}
