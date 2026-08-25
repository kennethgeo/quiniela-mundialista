/* Lo GLOBAL, en el hub de quinielas.

   Hasta ahora el número global vivía suelto en el menú lateral, sin contexto:
   se veía "142 pts" y no había dónde ver contra quién. Las pantallas que lo
   mostraban (Dashboard, Leaderboard) quedaron sin ruta hace tiempo y redirigen
   acá, así que este es el lugar.

   IMPORTANTE — esto NO es la tabla de ninguna quiniela. El puntaje global
   cuenta cada partido UNA vez (el mejor que sacaste entre tus quinielas, ver
   migración 62), mientras que dentro de cada quiniela cuenta lo de esa
   quiniela y nada más. Son dos números distintos a propósito, y el texto de
   la tarjeta lo dice para que nadie los confunda. */
import { useState } from 'react'
import { motion } from 'motion/react'
import { useQuery } from '@tanstack/react-query'
import { Globe, ChevronDown, Target, Zap } from 'lucide-react'
import { supabase } from '../../lib/supabase'

const ORO = '#E8B75A'

export default function RankingGlobal() {
  const [abierto, setAbierto] = useState(false)

  const { data: resumen } = useQuery({
    queryKey: ['mi_resumen_global'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('mi_resumen_global')
      if (error) throw error
      return data
    },
  })

  const { data: ranking = [] } = useQuery({
    queryKey: ['ranking_global'],
    enabled: abierto,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('ranking_global', { p_limite: 20 })
      if (error) throw error
      return data || []
    },
  })

  // Sin partidos jugados todavía no hay nada honesto que mostrar.
  if (!resumen || (resumen.partidos ?? 0) === 0) return null

  const { puntos, posicion, jugadores, quinielas, partidos, exactos, aciertos, medallas } = resumen
  const punteria = partidos > 0 ? Math.round((aciertos / partidos) * 100) : 0

  return (
    <div className="rounded-[14px] bg-white dark:bg-[#161616] border border-slate-200 dark:border-[#262626] p-4 mb-4">
      <div className="flex items-center gap-2 mb-2.5">
        <Globe size={15} className="text-accent" />
        <h3 className="font-bold font-['Archivo'] text-[13px] text-slate-900 dark:text-[#F3F1EA]">Tu global</h3>
        <span className="ml-auto font-['JetBrains_Mono'] text-[10px] text-[var(--text-muted,#8A8A8A)]">
          {quinielas} {quinielas === 1 ? 'quiniela' : 'quinielas'}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Dato etiqueta="Puntos" valor={puntos} color="#2ED3B7" />
        <Dato etiqueta={`de ${jugadores}`} valor={`${posicion}º`} color={posicion <= 3 ? ORO : undefined} />
        <Dato etiqueta="Puntería" valor={`${punteria}%`} />
      </div>

      <div className="flex items-center gap-3 mt-2.5 font-['JetBrains_Mono'] text-[10px] text-[var(--text-muted,#8A8A8A)]">
        <span className="flex items-center gap-1"><Target size={10} />{exactos} exactos</span>
        <span className="flex items-center gap-1"><Zap size={10} />{aciertos} de {partidos}</span>
        {medallas > 0 && <span>🏅 {medallas}</span>}
      </div>

      {/* La frase que evita la pregunta obvia en el chat. */}
      <p className="text-[10.5px] text-[var(--text-muted,#8A8A8A)] mt-2.5 leading-relaxed">
        Este número junta todas tus quinielas y cuenta cada partido una sola vez.
        Dentro de cada quiniela el puntaje es distinto: ahí cuenta solo lo de esa quiniela.
      </p>

      <button onClick={() => setAbierto(!abierto)}
        className="mt-2 flex items-center gap-1 text-[11px] font-bold text-accent">
        <ChevronDown size={13} className={`transition-transform ${abierto ? 'rotate-180' : ''}`} />
        {abierto ? 'Ocultar el ranking' : 'Ver el ranking global'}
      </button>

      {abierto && (
        <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
          className="mt-2 rounded-xl bg-slate-50 dark:bg-[#0C0C0C] border border-slate-200 dark:border-[#262626] p-2.5 space-y-0.5">
          {ranking.length === 0 ? (
            <p className="text-[11px] text-[var(--text-muted,#8A8A8A)]">Cargando…</p>
          ) : ranking.map((r, i) => (
            <div key={r.user_id}
              className="flex items-center gap-2 py-1 px-1.5 rounded-lg"
              style={r.soy_yo ? { background: 'rgba(46,211,183,.10)' } : undefined}>
              {/* Un salto en la numeración significa que estás fuera del top. */}
              {i > 0 && r.pos > ranking[i - 1].pos + 1 && (
                <span className="font-['JetBrains_Mono'] text-[10px] text-[var(--text-muted,#8A8A8A)]">⋯</span>
              )}
              <span className="w-5 text-right font-['JetBrains_Mono'] font-bold text-[10px]"
                style={{ color: r.pos <= 3 ? ORO : 'var(--text-muted,#8A8A8A)' }}>{r.pos}</span>
              <div className="w-6 h-6 rounded-full grid place-items-center text-[9px] font-bold text-white overflow-hidden shrink-0"
                style={{ background: r.soy_yo ? 'linear-gradient(135deg,#2ED3B7,#1a8f7c)' : 'linear-gradient(135deg,#5a2d8a,#3a1c5c)' }}>
                {r.avatar_url ? <img src={r.avatar_url} alt="" className="w-full h-full object-cover" /> : (r.display_name?.[0] || '?').toUpperCase()}
              </div>
              <span className="flex-1 min-w-0 font-['Archivo'] text-[12px] text-slate-800 dark:text-[#F3F1EA] truncate">
                {r.display_name}{r.soy_yo && <span className="text-accent font-bold"> (vos)</span>}
              </span>
              <span className="font-['JetBrains_Mono'] font-bold text-[12px] text-slate-900 dark:text-[#F3F1EA]">{r.puntos}</span>
            </div>
          ))}
        </motion.div>
      )}
    </div>
  )
}

function Dato({ etiqueta, valor, color }) {
  return (
    <div className="rounded-xl bg-slate-50 dark:bg-[#0C0C0C] border border-slate-200 dark:border-[#262626] p-2 text-center">
      <div className="font-['JetBrains_Mono'] font-bold text-[16px]" style={color ? { color } : undefined}>{valor}</div>
      <div className="font-['Archivo'] text-[8.5px] uppercase tracking-wide text-[var(--text-muted,#8A8A8A)] mt-0.5">{etiqueta}</div>
    </div>
  )
}
