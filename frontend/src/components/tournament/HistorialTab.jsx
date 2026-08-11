/* Histórico de la quiniela — matriz por jornada.
   Filas = jugadores, columnas = partidos. En cada celda, el marcador que predijo
   esa persona, tintado según le fue. La columna del jugador queda fija a la
   izquierda, así el eje nunca se pierde.

   La gracia de una matriz es la ALINEACIÓN: una sola tabla, sin tarjetas ni
   bordes por celda, para que se lea de corrido tanto en fila (cómo le fue a
   alguien en la jornada) como en columna (cómo le fue a todo el grupo en un
   partido).

   Regla dura: los partidos que todavía no se destaparon (RLS revela las
   predicciones ajenas recién 15 min antes del saque) NO se muestran. Nada de
   candados ni celdas fantasma: toda celda visible tiene dato real. */
import { useState, useMemo } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Zap } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { fetchGroupStandings } from '../../lib/groups'
import { crestOnError } from '../../lib/teamLogo'
import LoadingSpinner from '../ui/LoadingSpinner'

// El sync a veces guarda kickoff_at sin sufijo de zona; normalizamos como MatchCard.
const kickoffDate = (m) => {
  const s = m?.kickoff_at
  if (!s) return null
  const iso = s.endsWith('Z') || s.includes('+') ? s : `${s}Z`
  const d = new Date(iso)
  return isNaN(d) ? null : d
}

// Destapado = la BD ya revela las predicciones ajenas (kickoff - 15 min <= now).
const estaDestapado = (m, ahora) => {
  const k = kickoffDate(m)
  return !!k && k.getTime() - 15 * 60 * 1000 <= ahora
}

const jornadaKeyOf = (m) =>
  m.stage || (m.matchday ? `Jornada ${m.matchday}` : (m.phase ? m.phase.replace(/_/g, ' ') : 'Partidos'))

const esAnulado = (m) => m.status === 'cancelled' || m.status === 'postponed'

/* Estado visual de una celda. Los PUNTOS salen siempre de points_earned (lo que
   calculó el motor de scoring); acá solo se deriva el color. */
function veredictoDe(pred, match) {
  if (esAnulado(match)) return 'anulado'
  const gh = match.home_goals_actual
  const ga = match.away_goals_actual
  if (gh == null || ga == null) return 'pendiente'
  const ph = pred?.home_goals_pred
  const pa = pred?.away_goals_pred
  if (ph == null || pa == null) return 'sin'
  if (ph === gh && pa === ga) return 'exacto'
  const signo = (a, b) => (a === b ? 0 : a > b ? 1 : -1)
  return signo(ph, pa) === signo(gh, ga) ? 'acierto' : 'fallo'
}

/* Estilo de una celda. Regla única para que el color no confunda:
   EL COLOR SIEMPRE REPRESENTA EL RESULTADO, y la intensidad va con lo que
   sumaste. Por eso el fallo va apagado (no compite con los aciertos) y el rayo
   del comodín se pinta del color del resultado — un ×2 sobre un fallo es un
   comodín QUEMADO y se ve en rojo, no en verde. */
function estiloCelda(veredicto, x2) {
  switch (veredicto) {
    case 'exacto':
      return { fondo: 'rgba(46,211,183,.22)', texto: '#2ED3B7', rayo: '#2ED3B7', fuerte: true }
    case 'acierto':
      return { fondo: 'rgba(232,183,90,.18)', texto: '#E8B75A', rayo: '#E8B75A', fuerte: true }
    case 'fallo':
      // Comodín quemado: falló Y encima gastó el ×2. Se marca en rojo apagado.
      return x2
        ? { fondo: 'rgba(255,90,90,.10)', texto: '#FF8A8A', rayo: '#FF5A5A', quemado: true }
        : { fondo: 'transparent', texto: 'var(--text-muted,#8A8A8A)', rayo: null }
    case 'anulado':
      return { fondo: 'rgba(255,122,89,.12)', texto: '#FF7A59', rayo: '#FF7A59' }
    default: // sin / pendiente
      return { fondo: 'transparent', texto: 'var(--text-muted,#8A8A8A)', rayo: '#8A8A8A' }
  }
}

export default function HistorialTab({ leagueId, matches = [] }) {
  const reduce = useReducedMotion()
  const [jornadaSel, setJornadaSel] = useState(null)
  const ahora = Date.now()

  const { data: miembros = [], isLoading: cargandoMiembros } = useQuery({
    queryKey: ['group_standings', leagueId],
    queryFn: () => fetchGroupStandings(leagueId),
    enabled: !!leagueId,
  })

  const { data: predicciones = [], isLoading: cargandoPreds } = useQuery({
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

  const jornadas = useMemo(() => {
    const destapados = (matches || [])
      .filter((m) => estaDestapado(m, ahora))
      .sort((a, b) => (kickoffDate(a)?.getTime() || 0) - (kickoffDate(b)?.getTime() || 0))
    const mapa = new Map()
    for (const m of destapados) {
      const k = jornadaKeyOf(m)
      if (!mapa.has(k)) mapa.set(k, [])
      mapa.get(k).push(m)
    }
    return [...mapa.entries()].map(([label, partidos]) => ({ label, partidos }))
  }, [matches, ahora])

  const labelActiva = jornadaSel && jornadas.some((j) => j.label === jornadaSel)
    ? jornadaSel
    : jornadas.length ? jornadas[jornadas.length - 1].label : null
  const idxActiva = jornadas.findIndex((j) => j.label === labelActiva)
  const jornada = idxActiva >= 0 ? jornadas[idxActiva] : null

  const predPorClave = useMemo(() => {
    const o = {}
    for (const p of predicciones) o[`${p.user_id}|${p.match_id}`] = p
    return o
  }, [predicciones])

  // Filas ordenadas por puntos de ESTA jornada.
  const filas = useMemo(() => {
    if (!jornada) return []
    return miembros
      .map((u) => {
        const celdas = jornada.partidos.map((m) => {
          const pred = predPorClave[`${u.user_id}|${m.id}`] || null
          return {
            match: m,
            pred,
            veredicto: veredictoDe(pred, m),
            puntos: esAnulado(m) ? 0 : (pred?.points_earned || 0),
            x2: !!pred?.use_powerup_x2,
          }
        })
        return {
          ...u,
          celdas,
          total: celdas.reduce((s, c) => s + c.puntos, 0),
          exactos: celdas.filter((c) => c.veredicto === 'exacto').length,
        }
      })
      .sort((a, b) =>
        b.total - a.total ||
        b.exactos - a.exactos ||
        (a.display_name || '').localeCompare(b.display_name || ''),
      )
  }, [miembros, jornada, predPorClave])

  const pendientes = useMemo(() => {
    if (!jornada) return 0
    const visibles = new Set(jornada.partidos.map((m) => m.id))
    return (matches || []).filter((m) => jornadaKeyOf(m) === jornada.label && !visibles.has(m.id)).length
  }, [jornada, matches])

  if (cargandoMiembros || cargandoPreds) return <LoadingSpinner />

  if (!jornadas.length) {
    return (
      <div className="rounded-[14px] bg-white dark:bg-[#161616] border border-slate-200 dark:border-[#262626] p-8 text-center">
        <p className="font-['Archivo'] text-[13px] text-slate-600 dark:text-slate-300">Todavía no hay nada que mostrar.</p>
        <p className="font-['JetBrains_Mono'] text-[10px] text-[var(--text-muted,#8A8A8A)] mt-1.5">
          Las predicciones del grupo se destapan 15 min antes de cada partido.
        </p>
      </div>
    )
  }

  const n = jornada.partidos.length
  // Con pocas columnas entra todo en pantalla y no hace falta scroll lateral.
  const necesitaScroll = n > 5
  const plantilla = `104px repeat(${n}, minmax(50px, 1fr))`

  return (
    <div className="max-w-3xl mx-auto">
      {/* Navegación de jornada */}
      <div className="flex items-center gap-2 mb-3">
        <NavBtn disabled={idxActiva <= 0} onClick={() => setJornadaSel(jornadas[idxActiva - 1]?.label)}>
          <ChevronLeft size={15} />
        </NavBtn>
        <div className="flex-1 min-w-0 text-center">
          <p className="font-['Archivo'] font-bold text-[13px] text-slate-900 dark:text-[#F3F1EA] truncate">{jornada.label}</p>
          <p className="font-['JetBrains_Mono'] text-[9px] tracking-[0.06em] text-[var(--text-muted,#8A8A8A)]">
            {n} {n === 1 ? 'partido' : 'partidos'} · {filas.length} {filas.length === 1 ? 'jugador' : 'jugadores'}
          </p>
        </div>
        <NavBtn disabled={idxActiva >= jornadas.length - 1} onClick={() => setJornadaSel(jornadas[idxActiva + 1]?.label)}>
          <ChevronRight size={15} />
        </NavBtn>
      </div>

      {/* La matriz */}
      <div className="rounded-[14px] bg-white dark:bg-[#161616] border border-slate-200 dark:border-[#262626] overflow-hidden">
        <div className={necesitaScroll ? 'overflow-x-auto scrollbar-hide' : ''}>
          <div className={necesitaScroll ? 'min-w-max' : ''}>

            {/* Cabecera: el partido y su marcador real */}
            <div className="grid border-b border-slate-200 dark:border-[#262626]" style={{ gridTemplateColumns: plantilla }}>
              <div className="sticky left-0 z-10 bg-white dark:bg-[#161616] px-2.5 py-2">
                <span className="font-['JetBrains_Mono'] text-[8.5px] uppercase tracking-[0.12em] text-[var(--text-muted,#8A8A8A)]">Jugador</span>
              </div>
              {jornada.partidos.map((m) => (
                <div key={m.id} className="px-1 py-2 text-center min-w-0">
                  <div className="flex items-center justify-center gap-0.5">
                    <img src={m.home_flag_url || `https://flagcdn.com/w40/${(m.home_team_code || 'xx').toLowerCase()}.png`}
                      alt={m.home_team} title={m.home_team} className="w-[15px] h-[15px] object-contain" onError={crestOnError(m.home_team)} />
                    <img src={m.away_flag_url || `https://flagcdn.com/w40/${(m.away_team_code || 'xx').toLowerCase()}.png`}
                      alt={m.away_team} title={m.away_team} className="w-[15px] h-[15px] object-contain" onError={crestOnError(m.away_team)} />
                  </div>
                  <div className="font-['JetBrains_Mono'] font-bold text-[11px] tabular-nums mt-0.5 text-slate-900 dark:text-[#F3F1EA]">
                    {esAnulado(m)
                      ? <span style={{ color: '#FF7A59' }}>—</span>
                      : <>{m.home_goals_actual ?? '·'}<span className="text-[var(--text-muted,#8A8A8A)]">-</span>{m.away_goals_actual ?? '·'}</>}
                  </div>
                </div>
              ))}
            </div>

            {/* Filas de jugadores */}
            {filas.map((f, i) => {
              // El tinte de fila va también en la columna fija, montado sobre una
              // base opaca: si no, al scrollear lateralmente las celdas se verían
              // por debajo del nombre.
              const tinteFila = f.is_me
                ? 'rgba(46,211,183,.07)'
                : (i % 2 ? 'rgba(127,127,127,.035)' : 'transparent')
              return (
              <div key={f.user_id} className="grid items-stretch border-b border-slate-100 dark:border-white/5 last:border-0"
                style={{ gridTemplateColumns: plantilla, background: tinteFila }}>
                {/* Columna fija: puesto, nombre y puntos de la jornada */}
                <div className="relative sticky left-0 z-10 bg-white dark:bg-[#161616] px-2.5 py-1.5 flex items-center gap-1.5 min-w-0">
                  <span aria-hidden className="absolute inset-0 pointer-events-none" style={{ background: tinteFila }} />
                  <span className="relative font-['Archivo'] text-[11.5px] text-slate-800 dark:text-[#F3F1EA] truncate flex-1 min-w-0"
                    title={f.display_name}>
                    {f.display_name}
                  </span>
                  <span className="relative font-['JetBrains_Mono'] font-bold text-[11px] tabular-nums shrink-0"
                    style={{ color: f.total > 0 ? '#2ED3B7' : 'var(--text-muted,#8A8A8A)' }}>{f.total}</span>
                </div>

                {/* Celdas: el pick, tintado según le fue */}
                {f.celdas.map((c) => (
                  <Celda key={c.match.id} celda={c} reduce={reduce} orden={i} />
                ))}
              </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Leyenda */}
      <div className="flex items-center justify-center flex-wrap gap-x-3 gap-y-1.5 mt-2.5">
        <Ref color="rgba(46,211,183,.22)" texto="Exacto" />
        <Ref color="rgba(232,183,90,.18)" texto="Acierto" />
        <Ref color="transparent" texto="Fallo" borde />
        <span className="flex items-center gap-1 font-['JetBrains_Mono'] text-[8.5px] text-[var(--text-muted,#8A8A8A)]">
          <Zap size={9} className="fill-current" style={{ color: '#2ED3B7' }} /> ×2 que pegó
        </span>
        <span className="flex items-center gap-1 font-['JetBrains_Mono'] text-[8.5px] text-[var(--text-muted,#8A8A8A)]">
          <Zap size={9} style={{ color: '#FF5A5A' }} /> ×2 quemado
        </span>
      </div>

      {pendientes > 0 && (
        <p className="font-['JetBrains_Mono'] text-[9px] text-[var(--text-muted,#8A8A8A)] text-center mt-2">
          {pendientes} {pendientes === 1 ? 'partido más se destapa' : 'partidos más se destapan'} 15 min antes del saque
        </p>
      )}

      <div className="h-32 w-full shrink-0 md:hidden pointer-events-none" />
    </div>
  )
}

/* Cada combinación de resultado + comodín tiene su propia reacción:
     · exacto + ×2  → el premio gordo: golpe de entrada y destello en loop
     · exacto       → golpe de entrada, sin loop
     · acierto + ×2 → un único destello dorado al aparecer
     · acierto      → aparece y ya
     · fallo + ×2   → comodín quemado: sacudida corta y celda en rojo apagado
     · fallo / sin  → nada, apagado, no compite con lo demás
   Solo el premio gordo anima en loop (son pocas celdas); el resto son
   animaciones de una sola vez, que no cuestan nada aunque haya 85 celdas. */
function Celda({ celda, reduce, orden }) {
  const { match, pred, veredicto, x2 } = celda
  const enVivo = match.status === 'in_progress'
  const st = estiloCelda(veredicto, x2)

  // En vivo el marcador todavía puede cambiar: nada de festejar antes de tiempo.
  const premioGordo = x2 && veredicto === 'exacto' && !enVivo
  const destelloUnico = x2 && veredicto === 'acierto' && !enVivo
  const quemado = !!st.quemado && !enVivo
  const anima = !reduce
  const retraso = Math.min(orden * 0.02, 0.5)

  return (
    <motion.div className="relative px-1 py-1.5 grid place-items-center min-w-0 overflow-hidden"
      style={{ background: st.fondo }}
      initial={anima && (premioGordo || veredicto === 'exacto') ? { scale: 0.8 } : false}
      animate={anima && quemado
        ? { scale: 1, x: [0, -2.5, 2.5, -1.5, 1.5, 0] }
        : { scale: 1, x: 0 }}
      transition={quemado
        ? { x: { duration: 0.4, delay: retraso + 0.15 } }
        : { type: 'spring', stiffness: 420, damping: 18, delay: retraso }}
    >
      {/* Premio gordo: destello en loop */}
      {premioGordo && anima && (
        <motion.span aria-hidden className="absolute inset-0 pointer-events-none"
          style={{ background: 'linear-gradient(105deg,transparent 35%,rgba(46,211,183,.5) 50%,transparent 65%)' }}
          initial={{ x: '-120%' }} animate={{ x: '120%' }}
          transition={{ duration: 1.5, repeat: Infinity, repeatDelay: 2.6, ease: 'easeInOut' }} />
      )}
      {/* Acierto con comodín: un solo destello dorado al aparecer */}
      {destelloUnico && anima && (
        <motion.span aria-hidden className="absolute inset-0 pointer-events-none"
          style={{ background: 'linear-gradient(105deg,transparent 35%,rgba(232,183,90,.45) 50%,transparent 65%)' }}
          initial={{ x: '-120%' }} animate={{ x: '120%' }}
          transition={{ duration: 0.9, delay: retraso + 0.2, ease: 'easeOut' }} />
      )}

      <span className="relative font-['JetBrains_Mono'] font-bold text-[11px] tabular-nums flex items-center gap-0.5"
        style={{ color: st.texto }}>
        {x2 && st.rayo && (
          <Zap size={8} className={`shrink-0 ${st.fuerte ? 'fill-current' : ''}`} style={{ color: st.rayo }} />
        )}
        <span className={pred ? '' : 'opacity-40'}>
          {pred ? `${pred.home_goals_pred}-${pred.away_goals_pred}` : '·'}
        </span>
      </span>
    </motion.div>
  )
}

function NavBtn({ disabled, onClick, children }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className="w-[30px] h-[30px] shrink-0 rounded-[9px] bg-white dark:bg-[#161616] border border-slate-200 dark:border-[#262626] grid place-items-center text-[var(--text-muted,#8A8A8A)] disabled:opacity-30 disabled:pointer-events-none">
      {children}
    </button>
  )
}

function Ref({ color, texto, borde }) {
  return (
    <span className="flex items-center gap-1 font-['JetBrains_Mono'] text-[8.5px] text-[var(--text-muted,#8A8A8A)]">
      <span className="w-2.5 h-2.5 rounded-[3px] inline-block"
        style={{ background: color, border: borde ? '1px solid rgba(127,127,127,.35)' : undefined }} />
      {texto}
    </span>
  )
}
