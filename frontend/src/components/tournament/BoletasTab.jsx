/* Histórico de la quiniela — "Boletas".
   Cada jugador es una boleta (ticket de apuesta) de la jornada: sus predicciones
   como colillas, ordenadas por quién la rompió esa fecha. Todas las boletas usan
   el MISMO grid que la "regla de partidos" de arriba, así la colilla 3 de todos
   cae siempre bajo el partido 3 y se puede escanear en columna — la comparación
   de una matriz, pero sin scroll horizontal (que en móvil es lo que arruina la
   planilla clásica).

   Regla dura: los partidos que todavía NO se destaparon (RLS revela las
   predicciones ajenas recién 15 min antes del saque) NO se muestran. Nada de
   candados ni celdas fantasma: toda colilla visible tiene dato real. */
import { useState, useMemo } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'motion/react'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, ChevronDown, Zap, X, ArrowRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { fetchGroupStandings } from '../../lib/groups'
import { crestOnError } from '../../lib/teamLogo'
import LoadingSpinner from '../ui/LoadingSpinner'

// El sync guarda kickoff_at a veces sin sufijo de zona; normalizamos como en MatchCard.
const kickoffDate = (m) => {
  const s = m?.kickoff_at
  if (!s) return null
  const iso = s.endsWith('Z') || s.includes('+') ? s : `${s}Z`
  const d = new Date(iso)
  return isNaN(d) ? null : d
}

// Un partido está "destapado" cuando la BD ya revela las predicciones ajenas
// (política predictions_select_others_strict: kickoff_at - 15 min <= now()).
const estaDestapado = (m, ahora) => {
  const k = kickoffDate(m)
  return !!k && k.getTime() - 15 * 60 * 1000 <= ahora
}

// Misma agrupación por jornada/fase que usa el resto de la app.
const jornadaKeyOf = (m) =>
  m.stage || (m.matchday ? `Jornada ${m.matchday}` : (m.phase ? m.phase.replace(/_/g, ' ') : 'Partidos'))

const esAnulado = (m) => m.status === 'cancelled' || m.status === 'postponed'

/* Veredicto de una predicción contra el marcador real.
   OJO: los PUNTOS salen siempre de points_earned (lo que calculó el motor de
   scoring), acá solo se deriva el estado visual — no se reimplementa el puntaje. */
function veredictoDe(pred, match) {
  if (esAnulado(match)) return 'anulado'
  const gh = match.home_goals_actual
  const ga = match.away_goals_actual
  // Destapado pero todavía sin marcador: no hay veredicto posible aún.
  if (gh == null || ga == null) return 'pendiente'
  const ph = pred?.home_goals_pred
  const pa = pred?.away_goals_pred
  if (ph == null || pa == null) return 'sin'
  if (ph === gh && pa === ga) return 'exacto'
  const signo = (a, b) => (a === b ? 0 : a > b ? 1 : -1)
  return signo(ph, pa) === signo(gh, ga) ? 'acierto' : 'fallo'
}

const COLORES = {
  exacto: '#2ED3B7',
  acierto: '#E8B75A',
  fallo: null,
  sin: null,
  pendiente: null,
  anulado: '#FF7A59',
}

export default function BoletasTab({ leagueId, matches = [] }) {
  const navigate = useNavigate()
  const reduce = useReducedMotion()
  const [jornadaSel, setJornadaSel] = useState(null)
  const [expandida, setExpandida] = useState(null)   // user_id de la boleta abierta
  const [columna, setColumna] = useState(null)       // match para la hoja de columna

  // now() se congela por render: alcanza y evita recalcular en cada celda.
  const ahora = Date.now()

  const { data: miembros = [], isLoading: cargandoMiembros } = useQuery({
    queryKey: ['group_standings', leagueId],
    queryFn: () => fetchGroupStandings(leagueId),
    enabled: !!leagueId,
  })

  // Predicciones de TODA la quiniela. RLS devuelve solo las propias para los
  // partidos que aún no se destaparon, y eso está bien: esos partidos ni se muestran.
  const { data: predicciones = [], isLoading: cargandoPreds } = useQuery({
    queryKey: ['boletas_predictions', leagueId],
    enabled: !!leagueId,
    staleTime: 1000 * 60,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('predictions')
        .select('user_id, match_id, home_goals_pred, away_goals_pred, use_powerup_x2, points_earned, penalties_winner_pred')
        .eq('league_id', leagueId)
      if (error) throw error
      return data || []
    },
  })

  // Solo partidos destapados, agrupados por jornada y ordenados cronológicamente.
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

  // Por defecto, la jornada destapada más reciente (es un histórico: entrás por lo último).
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

  // Cuántos partidos de esta jornada faltan destapar (para la línea honesta del pie).
  const pendientesJornada = useMemo(() => {
    if (!jornada) return 0
    const idsVisibles = new Set(jornada.partidos.map((m) => m.id))
    return (matches || []).filter(
      (m) => jornadaKeyOf(m) === jornada.label && !idsVisibles.has(m.id),
    ).length
  }, [jornada, matches])

  // Una boleta por miembro, con sus colillas y el total de LA JORNADA.
  const boletas = useMemo(() => {
    if (!jornada) return []
    return miembros
      .map((u) => {
        const colillas = jornada.partidos.map((m) => {
          const pred = predPorClave[`${u.user_id}|${m.id}`] || null
          const veredicto = veredictoDe(pred, m)
          return {
            match: m,
            pred,
            veredicto,
            puntos: esAnulado(m) ? 0 : (pred?.points_earned || 0),
            x2: !!pred?.use_powerup_x2,
          }
        })
        const total = colillas.reduce((s, c) => s + c.puntos, 0)
        return {
          ...u,
          colillas,
          total,
          exactos: colillas.filter((c) => c.veredicto === 'exacto').length,
          fallos: colillas.filter((c) => c.veredicto === 'fallo').length,
          x2usados: colillas.filter((c) => c.x2).length,
          jugo: colillas.some((c) => c.pred),
        }
      })
      .sort((a, b) =>
        b.total - a.total ||
        b.exactos - a.exactos ||
        (a.display_name || '').localeCompare(b.display_name || ''),
      )
  }, [miembros, jornada, predPorClave])

  // El titular de la fecha: lo primero que querés saber al entrar.
  const titular = useMemo(() => {
    if (!boletas.length) return null
    const pegados = boletas.reduce(
      (s, b) => s + b.colillas.filter((c) => c.x2 && c.veredicto === 'exacto' && c.match.status !== 'in_progress').length, 0)
    if (pegados > 0) {
      return { icono: 'zap', texto: pegados === 1 ? 'Un comodín ×2 clavó el marcador' : `${pegados} comodines ×2 clavaron el marcador` }
    }
    const lider = boletas[0]
    if (lider?.total > 0) {
      const segundo = boletas[1]?.total ?? 0
      if (lider.total - segundo >= 2) return { icono: 'fuego', texto: `${lider.display_name} la rompió · ${lider.total} pts` }
      return { icono: 'fuego', texto: `Puntean con ${lider.total} pts` }
    }
    return null
  }, [boletas])

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

  const cols = jornada.partidos.length <= 6 ? jornada.partidos.length : 4
  const gridStyle = { gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }

  return (
    <div className="max-w-3xl mx-auto">
      {/* Chips de jornada (solo las que tienen algo destapado) */}
      {jornadas.length > 1 && (
        <div className="flex gap-1.5 mb-3 overflow-x-auto scrollbar-hide">
          {jornadas.map((j) => (
            <button key={j.label} onClick={() => { setJornadaSel(j.label); setExpandida(null) }}
              className={`shrink-0 px-3 py-1.5 rounded-[10px] font-['JetBrains_Mono'] font-bold text-[10px] uppercase tracking-[0.08em] whitespace-nowrap transition-all ${
                j.label === labelActiva
                  ? 'bg-accent text-[#06231d]'
                  : 'bg-white dark:bg-[#161616] text-[var(--text-muted,#8A8A8A)] border border-slate-200 dark:border-[#262626]'}`}>
              {j.label.replace(/^Jornada\s+/i, 'J')}
            </button>
          ))}
        </div>
      )}

      {/* Título + navegación entre jornadas */}
      <div className="flex items-center gap-2 mb-3">
        <NavBtn disabled={idxActiva <= 0}
          onClick={() => { setJornadaSel(jornadas[idxActiva - 1]?.label); setExpandida(null) }}>
          <ChevronLeft size={15} />
        </NavBtn>
        <div className="flex-1 min-w-0 text-center">
          <p className="font-['Archivo'] font-bold text-[13px] text-slate-900 dark:text-[#F3F1EA] truncate">{jornada.label}</p>
          <p className="font-['JetBrains_Mono'] text-[9px] tracking-[0.06em] text-[var(--text-muted,#8A8A8A)]">
            {jornada.partidos.length} {jornada.partidos.length === 1 ? 'partido' : 'partidos'} · {boletas.length} {boletas.length === 1 ? 'jugador' : 'jugadores'}
          </p>
        </div>
        <NavBtn disabled={idxActiva >= jornadas.length - 1}
          onClick={() => { setJornadaSel(jornadas[idxActiva + 1]?.label); setExpandida(null) }}>
          <ChevronRight size={15} />
        </NavBtn>
      </div>

      {/* El titular de la fecha */}
      {titular && (
        <div className="rounded-xl px-3 py-2 mb-2 flex items-center gap-2" style={{ background: 'rgba(46,211,183,.08)' }}>
          {titular.icono === 'zap'
            ? <Zap size={13} className="text-accent shrink-0 fill-current" />
            : <span className="text-[13px] leading-none shrink-0">🔥</span>}
          <span className="font-['Archivo'] font-semibold text-[11.5px] text-slate-800 dark:text-[#F3F1EA]">{titular.texto}</span>
        </div>
      )}

      {/* La regla de partidos: fija el eje de las columnas */}
      <div className="rounded-[14px] bg-white dark:bg-[#161616] border border-slate-200 dark:border-[#262626] px-2.5 py-2 mb-2">
        <div className="grid gap-1" style={gridStyle}>
          {jornada.partidos.map((m) => (
            <button key={m.id} onClick={() => setColumna(m)} className="min-w-0 text-center">
              <div className="flex items-center justify-center gap-1">
                <img src={m.home_flag_url || `https://flagcdn.com/w40/${(m.home_team_code || 'xx').toLowerCase()}.png`}
                  alt="" className="w-[18px] h-[18px] object-contain" onError={crestOnError(m.home_team)} />
                <img src={m.away_flag_url || `https://flagcdn.com/w40/${(m.away_team_code || 'xx').toLowerCase()}.png`}
                  alt="" className="w-[18px] h-[18px] object-contain" onError={crestOnError(m.away_team)} />
              </div>
              <div className="font-['JetBrains_Mono'] font-bold text-[12px] tabular-nums mt-0.5 text-slate-900 dark:text-[#F3F1EA]">
                {m.home_goals_actual ?? '–'}<span className="text-[var(--text-muted,#8A8A8A)] mx-0.5">·</span>{m.away_goals_actual ?? '–'}
              </div>
              <EstadoPartido match={m} />
            </button>
          ))}
        </div>
      </div>

      {/* Stack de boletas */}
      <div className="space-y-2">
        {boletas.map((b, i) => (
          <Boleta key={b.user_id} boleta={b} rank={i} gridStyle={gridStyle} reduce={reduce}
            abierta={expandida === b.user_id}
            onToggle={() => setExpandida(expandida === b.user_id ? null : b.user_id)}
            onColilla={(m) => setColumna(m)} />
        ))}
      </div>

      {/* Línea honesta: la jornada puede estar a medio destapar */}
      {pendientesJornada > 0 && (
        <p className="font-['JetBrains_Mono'] text-[9px] text-[var(--text-muted,#8A8A8A)] text-center mt-3">
          {pendientesJornada} {pendientesJornada === 1 ? 'partido más se destapa' : 'partidos más se destapan'} 15 min antes del saque
        </p>
      )}

      {/* Hoja de columna: cómo le fue a TODOS en un partido */}
      <AnimatePresence>
        {columna && (
          <HojaColumna key="hoja-columna" match={columna} boletas={boletas} onClose={() => setColumna(null)}
            onVerPartido={() => { const id = columna.id; setColumna(null); navigate(`/match/${id}`) }} />
        )}
      </AnimatePresence>

      <div className="h-32 w-full shrink-0 md:hidden pointer-events-none" />
    </div>
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

function EstadoPartido({ match }) {
  const base = "font-['JetBrains_Mono'] font-bold text-[8px] tracking-[0.1em] mt-0.5"
  if (esAnulado(match)) return <div className={base} style={{ color: '#FF7A59' }}>NO SE JUGÓ</div>
  if (match.status === 'in_progress') {
    return (
      <div className={`${base} flex items-center justify-center gap-1`} style={{ color: '#FF4D6D' }}>
        <span className="w-1 h-1 rounded-full bg-[#FF4D6D] animate-pulse" />EN VIVO
      </div>
    )
  }
  if (match.goes_to_penalties) return <div className={base} style={{ color: '#E8B75A' }}>PENALES</div>
  if (match.status === 'finished') return <div className={`${base} text-[var(--text-muted,#8A8A8A)]`}>FINAL</div>
  return <div className={`${base} text-[var(--text-muted,#8A8A8A)]`}>POR JUGAR</div>
}

function Boleta({ boleta, rank, gridStyle, reduce, abierta, onToggle, onColilla }) {
  const rankColor = rank === 0 ? '#E8B75A' : rank === 1 ? '#C7CDD6' : rank === 2 ? '#FF7A59' : 'var(--text-muted,#8A8A8A)'
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: reduce ? 0 : Math.min(rank * 0.03, 0.3) }}
      className={`relative rounded-[14px] bg-white dark:bg-[#161616] border border-slate-200 dark:border-[#262626] px-2.5 pt-2 pb-2.5 ${boleta.jugo ? '' : 'opacity-70'}`}
      style={boleta.is_me ? { background: 'rgba(46,211,183,.08)', borderColor: '#2ED3B7' } : undefined}
    >
      {/* Cabecera del ticket (toda la fila abre el reverso) */}
      <button onClick={onToggle} className="w-full flex items-center gap-2 text-left">
        <span className="w-[20px] text-center font-['JetBrains_Mono'] font-bold text-[12px] shrink-0" style={{ color: rankColor }}>{rank + 1}</span>
        <div className="w-7 h-7 rounded-full grid place-items-center text-[10px] font-bold font-['Archivo'] text-white overflow-hidden shrink-0"
          style={{ background: boleta.is_me ? 'linear-gradient(135deg,#2ED3B7,#1a8f7c)' : 'linear-gradient(135deg,#5a2d8a,#3a1c5c)' }}>
          {boleta.avatar_url ? <img src={boleta.avatar_url} alt="" className="w-full h-full object-cover" /> : (boleta.display_name?.[0] || '?').toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <span className="font-['Archivo'] font-semibold text-[12.5px] text-slate-800 dark:text-[#F3F1EA] truncate block">
            {boleta.display_name}{boleta.is_me && <span className="text-accent font-bold"> (vos)</span>}
          </span>
          <span className="font-['JetBrains_Mono'] text-[8.5px] text-[var(--text-muted,#8A8A8A)]">
            {boleta.jugo
              ? `${boleta.exactos} ${boleta.exactos === 1 ? 'exacto' : 'exactos'} · ${boleta.fallos} ${boleta.fallos === 1 ? 'fallo' : 'fallos'}${boleta.x2usados ? ` · ⚡${boleta.x2usados}` : ''}`
              : 'no jugó esta jornada'}
          </span>
        </div>
        <div className="text-right shrink-0">
          <div className="font-['Unbounded'] font-bold text-[18px] leading-none" style={rank === 0 && boleta.total > 0 ? { color: '#E8B75A' } : undefined}>{boleta.total}</div>
          <div className="font-['JetBrains_Mono'] text-[8px] text-[var(--text-muted,#8A8A8A)]">pts</div>
        </div>
        <ChevronDown size={13} className={`shrink-0 text-[var(--text-muted,#8A8A8A)] transition-transform ${abierta ? 'rotate-180' : ''}`} />
      </button>

      {/* Perforación del ticket */}
      <div className="border-t border-dashed border-slate-200 dark:border-[#262626] mt-2" />

      {/* Colillas */}
      <div className="grid gap-1 mt-2" style={gridStyle}>
        {boleta.colillas.map((c) => (
          <Colilla key={c.match.id} colilla={c} reduce={reduce} onClick={() => onColilla(c.match)} />
        ))}
      </div>

      {/* Reverso: detalle partido por partido */}
      <AnimatePresence initial={false}>
        {abierta && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }} className="overflow-hidden">
            <div className="mt-2.5 pt-2.5 border-t border-slate-200 dark:border-[#262626] space-y-1.5">
              {boleta.colillas.map((c) => (
                <DetalleFila key={c.match.id} colilla={c} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

/* Una colilla. La barra superior es el encoding redundante del veredicto (sirve
   también para daltónicos): ancho completo = exacto, media = acierto, nada = fallo. */
function Colilla({ colilla, reduce, onClick }) {
  const { match, pred, veredicto, puntos, x2 } = colilla
  const color = COLORES[veredicto]
  const enVivo = match.status === 'in_progress'
  // El destello solo se gana cuando el partido YA terminó: en vivo el marcador
  // todavía puede cambiar y sería un festejo prematuro.
  const pegoConX2 = x2 && veredicto === 'exacto' && !enVivo
  const anchoBarra = veredicto === 'exacto' ? '100%' : veredicto === 'acierto' ? '45%' : 0

  return (
    <button onClick={onClick}
      className="relative h-[42px] rounded-[9px] overflow-hidden bg-slate-50 dark:bg-[#0C0C0C] border border-slate-200 dark:border-[#262626] grid place-items-center"
      style={pegoConX2 ? { borderColor: '#2ED3B7', background: 'rgba(46,211,183,.12)' } : undefined}>
      {/* Barra de veredicto */}
      {anchoBarra !== 0 && (
        <span className="absolute top-0 left-1/2 -translate-x-1/2 h-[3px] rounded-b"
          style={{ width: anchoBarra, background: color }} />
      )}

      {/* Destello del ×2 que clavó el marcador: el momento estrella.
          Solo se anima en las colillas que pegaron (son pocas), no las 85. */}
      {pegoConX2 && !reduce && (
        <motion.span aria-hidden className="absolute inset-0 pointer-events-none"
          style={{ background: 'linear-gradient(105deg,transparent 35%,rgba(46,211,183,.55) 50%,transparent 65%)' }}
          initial={{ x: '-120%' }} animate={{ x: '120%' }}
          transition={{ duration: 1.6, repeat: Infinity, repeatDelay: 2.4, ease: 'easeInOut' }} />
      )}

      <div className="relative text-center leading-none">
        <div className="font-['JetBrains_Mono'] font-bold text-[13px] tabular-nums text-slate-900 dark:text-[#F3F1EA]">
          {pred ? `${pred.home_goals_pred}-${pred.away_goals_pred}` : '—'}
        </div>
        <div className="font-['JetBrains_Mono'] font-bold text-[9px] mt-1 flex items-center justify-center gap-0.5"
          style={{ color: enVivo ? '#FF4D6D' : (color || 'var(--text-muted,#8A8A8A)') }}>
          {x2 && <Zap size={8} className={pegoConX2 ? 'fill-current' : ''} />}
          {!pred ? 'sin'
            : veredicto === 'anulado' ? 'anul'
            : veredicto === 'pendiente' ? '·'
            : enVivo ? <><span className="w-1 h-1 rounded-full bg-[#FF4D6D] animate-pulse inline-block" />vivo</>
            : `+${puntos}`}
        </div>
      </div>
    </button>
  )
}

function DetalleFila({ colilla }) {
  const { match: m, pred, veredicto, puntos, x2 } = colilla
  const color = COLORES[veredicto]
  const enVivo = m.status === 'in_progress'
  const etiqueta = veredicto === 'exacto' ? 'EXACTO'
    : veredicto === 'acierto' ? 'ACIERTO'
    : veredicto === 'anulado' ? 'ANULADO'
    : veredicto === 'pendiente' ? 'POR JUGAR'
    : pred ? 'FALLO' : 'SIN PICK'
  const muestraPuntos = pred && !enVivo && veredicto !== 'anulado' && veredicto !== 'pendiente'
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="font-['Archivo'] text-slate-600 dark:text-slate-300 truncate flex-1 min-w-0">
        {m.home_team} <span className="font-['JetBrains_Mono'] font-bold tabular-nums text-slate-900 dark:text-[#F3F1EA]">{m.home_goals_actual ?? '–'}-{m.away_goals_actual ?? '–'}</span> {m.away_team}
      </span>
      <span className="font-['JetBrains_Mono'] text-[10px] tabular-nums text-[var(--text-muted,#8A8A8A)] shrink-0">
        {pred ? `${pred.home_goals_pred}-${pred.away_goals_pred}` : '—'}
      </span>
      {x2 && <Zap size={9} className="text-accent shrink-0 fill-current" />}
      <span className="shrink-0 font-['JetBrains_Mono'] font-bold text-[8.5px] px-1.5 py-0.5 rounded-[20px]"
        style={{ color: color || 'var(--text-muted,#8A8A8A)', background: color ? `${color}1f` : 'rgba(138,138,138,.14)' }}>
        {muestraPuntos ? `+${puntos} ` : ''}{enVivo ? 'EN VIVO' : etiqueta}
      </span>
    </div>
  )
}

/* Hoja inferior: la lectura en COLUMNA — cómo le fue a todo el grupo en un partido.
   Es lo que reemplaza al scroll horizontal de una matriz. */
function HojaColumna({ match, boletas, onClose, onVerPartido }) {
  const filas = boletas
    .map((b) => ({ b, c: b.colillas.find((c) => c.match.id === match.id) }))
    .filter((x) => x.c)
    .sort((a, b) => b.c.puntos - a.c.puntos || (a.b.display_name || '').localeCompare(b.b.display_name || ''))

  return (
    <>
      <motion.div className="fixed inset-0 bg-black/50 z-40" onClick={onClose}
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
      <motion.div
        className="fixed left-0 right-0 bottom-0 z-50 rounded-t-[20px] bg-white dark:bg-[#161616] border-t border-slate-200 dark:border-[#262626] max-h-[80vh] flex flex-col"
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ type: 'spring', stiffness: 320, damping: 28 }}>
        <div className="px-4 pt-3 pb-2 shrink-0">
          <div className="w-9 h-1 rounded-full bg-slate-300 dark:bg-[#262626] mx-auto mb-3" />
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0 text-center">
              <div className="flex items-center justify-center gap-2">
                <img src={match.home_flag_url || `https://flagcdn.com/w40/${(match.home_team_code || 'xx').toLowerCase()}.png`}
                  alt="" className="w-6 h-6 object-contain" onError={crestOnError(match.home_team)} />
                <span className="font-['Unbounded'] font-bold text-[20px] leading-none text-slate-900 dark:text-[#F3F1EA] tabular-nums">
                  {match.home_goals_actual ?? '–'}-{match.away_goals_actual ?? '–'}
                </span>
                <img src={match.away_flag_url || `https://flagcdn.com/w40/${(match.away_team_code || 'xx').toLowerCase()}.png`}
                  alt="" className="w-6 h-6 object-contain" onError={crestOnError(match.away_team)} />
              </div>
              <p className="font-['Archivo'] text-[11px] text-[var(--text-muted,#8A8A8A)] truncate mt-1">
                {match.home_team} vs {match.away_team}
              </p>
              {match.goes_to_penalties && match.penalties_winner_real && (
                <p className="font-['JetBrains_Mono'] font-bold text-[9px] mt-0.5" style={{ color: '#E8B75A' }}>
                  {match.penalties_winner_real} avanza por penales
                </p>
              )}
            </div>
            <button onClick={onClose} className="w-8 h-8 shrink-0 rounded-[9px] grid place-items-center text-[var(--text-muted,#8A8A8A)]">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="overflow-y-auto px-4 pb-2 flex-1">
          <div className="space-y-1">
            {filas.map(({ b, c }) => {
              const color = COLORES[c.veredicto]
              return (
                <div key={b.user_id} className="flex items-center gap-2 py-1.5 border-b border-slate-100 dark:border-white/5 last:border-0"
                  style={b.is_me ? { background: 'rgba(46,211,183,.06)' } : undefined}>
                  <div className="w-6 h-6 rounded-full grid place-items-center text-[9px] font-bold text-white overflow-hidden shrink-0"
                    style={{ background: b.is_me ? 'linear-gradient(135deg,#2ED3B7,#1a8f7c)' : 'linear-gradient(135deg,#5a2d8a,#3a1c5c)' }}>
                    {b.avatar_url ? <img src={b.avatar_url} alt="" className="w-full h-full object-cover" /> : (b.display_name?.[0] || '?').toUpperCase()}
                  </div>
                  <span className="flex-1 min-w-0 font-['Archivo'] text-[12px] text-slate-800 dark:text-[#F3F1EA] truncate">{b.display_name}</span>
                  <span className="font-['JetBrains_Mono'] font-bold text-[12px] tabular-nums shrink-0 text-slate-900 dark:text-[#F3F1EA]">
                    {c.pred ? `${c.pred.home_goals_pred}-${c.pred.away_goals_pred}` : '—'}
                  </span>
                  {c.x2 && <Zap size={10} className="text-accent shrink-0 fill-current" />}
                  <span className="w-[38px] text-right font-['JetBrains_Mono'] font-bold text-[10px] shrink-0"
                    style={{ color: color || 'var(--text-muted,#8A8A8A)' }}>
                    {c.pred && c.veredicto !== 'anulado' ? `+${c.puntos}` : '—'}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        <div className="px-4 py-3 shrink-0 border-t border-slate-200 dark:border-[#262626]">
          <button onClick={onVerPartido}
            className="w-full flex items-center justify-center gap-1.5 rounded-xl py-2.5 font-['Archivo'] font-bold text-[12px] text-accent"
            style={{ background: 'rgba(46,211,183,.10)' }}>
            Ver partido <ArrowRight size={14} />
          </button>
        </div>
      </motion.div>
    </>
  )
}
