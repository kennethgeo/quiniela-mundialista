/* Comodines de la liga: cuántos x2 usó (y le quedan) cada jugador por
   jornada/fase, contando SOLO partidos finalizados (la BD no revela los
   comodines de otros en partidos aún pendientes). */
import { useState, useEffect } from 'react'
import { motion } from 'motion/react'
import { Zap, Lock } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import LoadingSpinner from '../ui/LoadingSpinner'

const KNOCKOUT_LABELS = {
  round_of_32: 'Ronda de 32',
  round_of_16: 'Octavos',
  quarter_finals: 'Cuartos',
  semi_finals: 'Semis',
  third_place: '3er Puesto',
  final: 'Final',
}
const SEGMENT_ORDER = ['groups_1', 'groups_2', 'groups_3', 'round_of_32', 'round_of_16', 'quarter_finals', 'semi_finals', 'third_place', 'final']

export default function PowerupUsage() {
  const { profile } = useAuth()
  const [matches, setMatches] = useState([])
  const [powerupPreds, setPowerupPreds] = useState([])
  const [limits, setLimits] = useState({})
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedKey, setSelectedKey] = useState(null)

  useEffect(() => {
    const load = async () => {
      try {
        const [mRes, pRes, lRes, uRes] = await Promise.all([
          supabase.from('matches').select('id,phase,group_name,matchday,kickoff_at,status'),
          // RLS solo devuelve comodines de otros en partidos ya no pendientes.
          supabase.from('predictions').select('user_id,match_id,use_powerup_x2').eq('use_powerup_x2', true),
          supabase.from('powerup_limits').select('*'),
          supabase.from('users').select('id,display_name,avatar_url'),
        ])
        if (mRes.error) throw mRes.error
        if (pRes.error) throw pRes.error
        setMatches(mRes.data || [])
        setPowerupPreds(pRes.data || [])
        const lo = {}
        ;(lRes.data || []).forEach((l) => { lo[l.matchday ? `${l.phase}_${l.matchday}` : l.phase] = l.max_uses })
        setLimits(lo)
        setUsers(uRes.data || [])
      } catch (err) {
        console.error('Error cargando comodines:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  if (loading) return <LoadingSpinner />

  // Jornada de cada partido de grupos, recalculada como en el resto de la app
  // (cronológico por grupo, 2 por jornada) para no depender del dato de la API.
  const mdById = {}
  const byGroup = {}
  matches.filter((m) => m.phase === 'groups').forEach((m) => { (byGroup[m.group_name] ||= []).push(m) })
  Object.values(byGroup).forEach((arr) => {
    arr.sort((a, b) => new Date(a.kickoff_at) - new Date(b.kickoff_at))
    arr.forEach((m, idx) => { mdById[m.id] = Math.floor(idx / 2) + 1 })
  })

  // Segmento (jornada/fase) y estado de cada partido.
  const segByMatch = {}
  matches.forEach((m) => {
    if (m.phase === 'groups') {
      const md = mdById[m.id] ?? m.matchday
      segByMatch[m.id] = { key: `groups_${md}`, label: `Grupos · J${md}`, status: m.status }
    } else {
      segByMatch[m.id] = { key: m.phase, label: KNOCKOUT_LABELS[m.phase] || m.phase, status: m.status }
    }
  })

  // Segmentos que ya tienen al menos un partido finalizado (los que se pueden mostrar).
  const finishedSegs = new Map()
  matches.forEach((m) => {
    if (m.status === 'finished') {
      const s = segByMatch[m.id]
      if (s && !finishedSegs.has(s.key)) finishedSegs.set(s.key, s)
    }
  })
  const segments = SEGMENT_ORDER.filter((k) => finishedSegs.has(k)).map((k) => finishedSegs.get(k))

  if (segments.length === 0) {
    return (
      <div className="glass-card p-8 text-center">
        <Lock size={26} className="text-slate-400 mx-auto mb-3" />
        <p className="text-slate-500 text-sm">Aún no hay partidos jugados. Los comodines de cada quien se revelan cuando los partidos terminan.</p>
      </div>
    )
  }

  // Por defecto, la jornada/fase más avanzada con datos.
  const activeKey = selectedKey && segments.some((s) => s.key === selectedKey)
    ? selectedKey
    : segments[segments.length - 1].key
  const limit = limits[activeKey] ?? 0

  // Comodines usados por jugador en el segmento activo (solo partidos finalizados).
  const usedByUser = {}
  powerupPreds.forEach((p) => {
    const seg = segByMatch[p.match_id]
    if (seg && seg.key === activeKey && seg.status === 'finished') {
      usedByUser[p.user_id] = (usedByUser[p.user_id] || 0) + 1
    }
  })

  const rows = users
    .map((u) => {
      const used = usedByUser[u.id] || 0
      return { ...u, used, remaining: Math.max(0, limit - used) }
    })
    .sort((a, b) => b.used - a.used || a.display_name.localeCompare(b.display_name))

  return (
    <div>
      {/* Selector de jornada/fase */}
      <div className="flex gap-2 overflow-x-auto pb-3 scrollbar-hide mb-3">
        {segments.map((s) => (
          <button
            key={s.key}
            onClick={() => setSelectedKey(s.key)}
            className={`shrink-0 px-3.5 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
              activeKey === s.key ? 'gradient-2026 text-white shadow-md' : 'glass-strong text-slate-500 bg-white dark:bg-transparent'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Encabezado con el límite */}
      <div className="flex items-center gap-2 mb-3 px-1 text-xs text-slate-500">
        <Zap size={13} className="text-accent" />
        <span>Límite: <span className="font-bold text-slate-700 dark:text-slate-300">{limit}</span> por {activeKey.startsWith('groups') ? 'jornada' : 'fase'}</span>
        <span className="ml-auto italic">Solo partidos jugados</span>
      </div>

      {/* Lista de jugadores */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-card divide-y divide-slate-100 dark:divide-white/5 overflow-hidden">
        {rows.map((u) => {
          const isMe = u.id === profile?.id
          return (
            <div key={u.id} className={`flex items-center gap-3 px-4 py-3 ${isMe ? 'bg-accent/5' : ''}`}>
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-accent/30 to-primary-lighter flex items-center justify-center text-xs font-bold overflow-hidden shrink-0">
                {u.avatar_url ? (
                  <img src={u.avatar_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-slate-600 dark:text-slate-200">{u.display_name?.charAt(0).toUpperCase()}</span>
                )}
              </div>
              <p className="text-sm font-semibold text-slate-900 dark:text-white truncate flex-1 min-w-0">
                {u.display_name}{isMe && <span className="text-[10px] text-accent font-bold ml-1">· Tú</span>}
              </p>

              {/* Puntitos: usados (llenos) vs disponibles */}
              <div className="flex items-center gap-1 shrink-0">
                {Array.from({ length: limit }).map((_, i) => (
                  <Zap
                    key={i}
                    size={13}
                    className={i < u.used ? 'text-accent fill-current' : 'text-slate-300 dark:text-slate-600'}
                  />
                ))}
              </div>

              <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 tabular-nums shrink-0 w-14 text-right">
                {u.remaining === 0 ? 'sin cupo' : `quedan ${u.remaining}`}
              </span>
            </div>
          )
        })}
      </motion.div>
    </div>
  )
}
