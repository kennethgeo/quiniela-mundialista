/* Cara a cara: tu historial contra el de otro jugador de la quiniela.
   Se abre tocando a alguien en la Tabla. La idea es que sea material de carga
   para el grupo: en qué jornadas le ganaste, dónde te sacó ventaja y en qué
   partidos puntual predijeron distinto.

   Solo mira partidos ya jugados: los pendientes no dicen nada y los que aún no
   se destapan no son visibles para las predicciones ajenas (RLS). */
import { useMemo } from 'react'
import { motion } from 'motion/react'
import { useConsultaDelUsuario } from '../../hooks/useConsultaDelUsuario'
import { X, Zap, Trophy } from 'lucide-react'
import { supabase } from '../../lib/supabase'

const jornadaKeyOf = (m) =>
  m.stage || (m.matchday ? `Jornada ${m.matchday}` : (m.phase ? m.phase.replace(/_/g, ' ') : 'Partidos'))

const esAnulado = (m) => m.status === 'cancelled' || m.status === 'postponed'

const kickoffMs = (m) => {
  const s = m?.kickoff_at
  if (!s) return 0
  const d = new Date(s.endsWith('Z') || s.includes('+') ? s : `${s}Z`)
  return isNaN(d) ? 0 : d.getTime()
}

const esExacto = (p, m) =>
  p && m.home_goals_actual != null &&
  p.home_goals_pred === m.home_goals_actual && p.away_goals_pred === m.away_goals_actual

export default function CaraACara({ leagueId, matches = [], yo, rival, onClose }) {
  // Comparte caché con la pestaña Histórico: misma clave, misma consulta.
  const { data: predicciones = [], isLoading } = useConsultaDelUsuario({
    queryKey: ['historial_predictions', leagueId],
    enabled: !!leagueId,
    staleTime: 1000 * 60,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('predictions')
        .select('user_id, match_id, home_goals_pred, away_goals_pred, use_powerup_x2, points_earned')
        .eq('league_id', leagueId)
      if (error) throw error
      return data || []
    },
  })

  const datos = useMemo(() => {
    const jugados = (matches || [])
      .filter((m) => m.status === 'finished' && !esAnulado(m))
      .sort((a, b) => kickoffMs(a) - kickoffMs(b))

    const porClave = {}
    for (const p of predicciones) porClave[`${p.user_id}|${p.match_id}`] = p

    const resumen = () => ({ pts: 0, exactos: 0, aciertos: 0, x2: 0, jugadas: 0 })
    const a = resumen()
    const b = resumen()

    // Agrupado por jornada, en orden cronológico.
    const jornadas = new Map()
    for (const m of jugados) {
      const k = jornadaKeyOf(m)
      if (!jornadas.has(k)) jornadas.set(k, { label: k, a: 0, b: 0 })
      const j = jornadas.get(k)

      const pa = porClave[`${yo.user_id}|${m.id}`] || null
      const pb = porClave[`${rival.user_id}|${m.id}`] || null
      const ptsA = pa?.points_earned || 0
      const ptsB = pb?.points_earned || 0
      j.a += ptsA
      j.b += ptsB

      for (const [acc, p, pts] of [[a, pa, ptsA], [b, pb, ptsB]]) {
        acc.pts += pts
        if (p) acc.jugadas += 1
        if (pts > 0) acc.aciertos += 1
        if (esExacto(p, m)) acc.exactos += 1
        if (p?.use_powerup_x2) acc.x2 += 1
      }
    }

    const lista = [...jornadas.values()]
    const duelos = lista.reduce(
      (acc, j) => {
        if (j.a > j.b) acc.a += 1
        else if (j.b > j.a) acc.b += 1
        else acc.empate += 1
        return acc
      },
      { a: 0, b: 0, empate: 0 },
    )

    return { jornadas: lista, a, b, duelos }
  }, [predicciones, matches, yo, rival])

  const { a, b, duelos, jornadas } = datos
  const gano = a.pts > b.pts ? 'a' : b.pts > a.pts ? 'b' : null

  /* Ventana centrada, no hoja desde abajo. Pegada al borde inferior chocaba
     con la barra de navegación (z-50) y con el botón flotante del chat
     (z-[60]), que le quedaban ENCIMA y tapaban las últimas filas. Centrada y
     con margen no toca ninguna de las dos zonas, y el z-index queda por arriba
     de ambas (pero debajo de los toasts, que son z-[100]). */
  return (
    <>
      <motion.div className="fixed inset-0 bg-black/60 z-[90]" onClick={onClose}
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
      <div className="fixed inset-0 z-[95] grid place-items-center p-4 pointer-events-none">
      <motion.div
        className="pointer-events-auto w-full max-w-md rounded-[18px] bg-white dark:bg-[#161616] border border-slate-200 dark:border-[#262626] shadow-2xl max-h-[82vh] flex flex-col overflow-hidden"
        initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.94 }}
        transition={{ type: 'spring', stiffness: 340, damping: 26 }}>

        <div className="px-4 pt-3.5 pb-3 shrink-0 border-b border-slate-200 dark:border-[#262626]">
          <div className="flex items-start gap-2">
            <h3 className="flex-1 font-['Archivo'] font-bold text-[13px] text-slate-900 dark:text-[#F3F1EA]">Cara a cara</h3>
            <button onClick={onClose} className="w-7 h-7 shrink-0 rounded-[9px] grid place-items-center text-[var(--text-muted,#8A8A8A)]">
              <X size={15} />
            </button>
          </div>

          {/* Marcador general */}
          <div className="flex items-center gap-3 mt-3">
            <Lado persona={yo} pts={a.pts} gana={gano === 'a'} />
            <div className="shrink-0 text-center">
              <div className="font-['JetBrains_Mono'] text-[9px] text-[var(--text-muted,#8A8A8A)] uppercase tracking-[0.1em]">jornadas</div>
              <div className="font-['JetBrains_Mono'] font-bold text-[13px] text-slate-700 dark:text-slate-300 tabular-nums">
                {duelos.a}<span className="text-[var(--text-muted,#8A8A8A)] mx-1">-</span>{duelos.b}
              </div>
              {duelos.empate > 0 && (
                <div className="font-['JetBrains_Mono'] text-[8.5px] text-[var(--text-muted,#8A8A8A)]">{duelos.empate} iguales</div>
              )}
            </div>
            <Lado persona={rival} pts={b.pts} gana={gano === 'b'} derecha />
          </div>
        </div>

        <div className="overflow-y-auto flex-1 px-4 py-3">
          {isLoading ? (
            <p className="text-center text-[12px] text-[var(--text-muted,#8A8A8A)] py-6">Cargando…</p>
          ) : jornadas.length === 0 ? (
            <p className="text-center text-[12px] text-[var(--text-muted,#8A8A8A)] py-6">Todavía no hay partidos jugados.</p>
          ) : (
            <>
              {/* Comparativa de métricas */}
              <div className="rounded-xl bg-slate-50 dark:bg-[#0C0C0C] border border-slate-200 dark:border-[#262626] p-3 mb-3">
                <Metrica etiqueta="Marcadores exactos" a={a.exactos} b={b.exactos} />
                <Metrica etiqueta="Aciertos" a={a.aciertos} b={b.aciertos} />
                <Metrica etiqueta="Partidos jugados" a={a.jugadas} b={b.jugadas} />
                <Metrica etiqueta="Comodines usados" a={a.x2} b={b.x2} icono />
              </div>

              {/* Jornada por jornada */}
              <p className="font-['JetBrains_Mono'] font-bold text-[9.5px] uppercase tracking-[0.18em] text-[var(--text-muted,#8A8A8A)] mb-2 px-0.5">
                Jornada por jornada
              </p>
              <div className="space-y-1">
                {jornadas.map((j) => {
                  const gA = j.a > j.b, gB = j.b > j.a
                  return (
                    <div key={j.label} className="flex items-center gap-2 py-1.5 border-b border-slate-100 dark:border-white/5 last:border-0">
                      <span className="w-[46px] shrink-0 text-center font-['JetBrains_Mono'] font-bold text-[13px] tabular-nums"
                        style={{ color: gA ? '#2ED3B7' : 'var(--text-muted,#8A8A8A)' }}>{j.a}</span>
                      <span className="flex-1 min-w-0 text-center font-['Archivo'] text-[11.5px] text-slate-600 dark:text-slate-400 truncate">
                        {j.label}
                      </span>
                      <span className="w-[46px] shrink-0 text-center font-['JetBrains_Mono'] font-bold text-[13px] tabular-nums"
                        style={{ color: gB ? '#2ED3B7' : 'var(--text-muted,#8A8A8A)' }}>{j.b}</span>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>
      </motion.div>
      </div>
    </>
  )
}

function Lado({ persona, pts, gana, derecha }) {
  return (
    <div className={`flex-1 min-w-0 flex items-center gap-2 ${derecha ? 'flex-row-reverse text-right' : ''}`}>
      <div className="w-9 h-9 shrink-0 rounded-full grid place-items-center text-[12px] font-bold font-['Archivo'] text-white overflow-hidden"
        style={{ background: persona?.is_me ? 'linear-gradient(135deg,#2ED3B7,#1a8f7c)' : 'linear-gradient(135deg,#5a2d8a,#3a1c5c)' }}>
        {persona?.avatar_url
          ? <img src={persona.avatar_url} alt="" className="w-full h-full object-cover" />
          : (persona?.display_name?.[0] || '?').toUpperCase()}
      </div>
      <div className="min-w-0">
        <p className="font-['Archivo'] font-semibold text-[12px] text-slate-800 dark:text-[#F3F1EA] truncate">
          {persona?.display_name}
        </p>
        <p className="font-['JetBrains_Mono'] font-bold text-[17px] leading-none tabular-nums flex items-center gap-1"
          style={{ color: gana ? '#E8B75A' : 'inherit' }}>
          {derecha && gana && <Trophy size={11} />}
          {pts}
          {!derecha && gana && <Trophy size={11} />}
        </p>
      </div>
    </div>
  )
}

function Metrica({ etiqueta, a, b, icono }) {
  const gA = a > b, gB = b > a
  const col = (gana) => ({ color: gana ? '#2ED3B7' : 'var(--text-muted,#8A8A8A)' })
  return (
    <div className="flex items-center gap-2 py-1">
      <span className="w-[46px] shrink-0 text-center font-['JetBrains_Mono'] font-bold text-[13px] tabular-nums" style={col(gA)}>{a}</span>
      <span className="flex-1 text-center font-['Archivo'] text-[11px] text-slate-500 dark:text-slate-400 flex items-center justify-center gap-1">
        {icono && <Zap size={10} className="text-accent" />}{etiqueta}
      </span>
      <span className="w-[46px] shrink-0 text-center font-['JetBrains_Mono'] font-bold text-[13px] tabular-nums" style={col(gB)}>{b}</span>
    </div>
  )
}
