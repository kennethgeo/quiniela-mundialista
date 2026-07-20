// Hub de quinielas (grupos) — Fase 2 de la 2.0. Datos reales vía RPCs.
import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Plus, KeyRound, Users, Trophy, Crown, ArrowRight, X, Loader2, Copy, Check, ChevronRight } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { fetchMyGroups, fetchTournaments, createGroup, joinGroupByCode, fetchGroupStandings } from '../lib/groups'

const ACCENTS = ['mint', 'violet', 'coral', 'amber']
const ACCENT_HEX = { mint: '#2fdd9a', violet: '#8b7bff', coral: '#ff6b7d', amber: '#ffbf47' }

export default function HubPage() {
  const { profile } = useAuth()
  const [groups, setGroups] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [modal, setModal] = useState(null) // 'create' | 'join' | null
  const [standingsFor, setStandingsFor] = useState(null)

  const load = useCallback(async () => {
    try {
      setLoading(true); setError(null)
      setGroups(await fetchMyGroups())
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const firstName = (profile?.display_name || '').split(' ')[0] || 'crack'
  const pending = groups.filter(g => g.tournament_status === 'active').length

  return (
    <div className="max-w-3xl mx-auto">
      {/* Hero */}
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">Buenas, {firstName} 👋</p>
        <h1 className="text-3xl font-extrabold tracking-tight font-['Sora'] text-slate-900 dark:text-white mt-1">Tus quinielas</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1.5">
          {loading ? 'Cargando…' : groups.length === 0
            ? 'Todavía no estás en ninguna. ¡Creá una o unite por código!'
            : <>Estás en <b className="text-slate-800 dark:text-slate-200">{groups.length}</b> {groups.length === 1 ? 'quiniela' : 'quinielas'}{pending > 0 && <> · {pending} activa{pending > 1 ? 's' : ''}</>}</>}
        </p>
      </motion.div>

      {error && (
        <div className="mb-4 text-sm text-rose-500 bg-rose-500/10 border border-rose-500/20 rounded-xl p-3">
          {error.includes('function') || error.includes('does not exist')
            ? 'Falta correr la migración 26 en la base de datos.' : error}
        </div>
      )}

      {/* Grid de grupos */}
      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {[0, 1].map(i => <div key={i} className="h-44 rounded-3xl bg-slate-100 dark:bg-white/[0.04] animate-pulse" />)}
        </div>
      ) : (
        <motion.div layout className="grid gap-4 sm:grid-cols-2">
          <AnimatePresence>
            {groups.map((g, i) => (
              <GroupCard key={g.id} g={g} accent={ACCENTS[i % ACCENTS.length]} onOpen={() => setStandingsFor(g)} />
            ))}
          </AnimatePresence>
        </motion.div>
      )}

      {/* CTAs */}
      <div className="flex gap-3 mt-6 flex-wrap">
        <button onClick={() => setModal('create')}
          className="flex-1 min-w-[150px] flex items-center justify-center gap-2 font-bold font-['Sora'] text-sm py-3.5 rounded-2xl text-slate-950 bg-gradient-to-br from-accent to-accent-dark shadow-lg shadow-accent/25 active:scale-[0.98] transition-transform">
          <Plus size={18} /> Crear quiniela
        </button>
        <button onClick={() => setModal('join')}
          className="flex-1 min-w-[150px] flex items-center justify-center gap-2 font-bold font-['Sora'] text-sm py-3.5 rounded-2xl text-slate-800 dark:text-white bg-white dark:bg-white/[0.05] border border-slate-200 dark:border-white/10 active:scale-[0.98] transition-transform">
          <KeyRound size={17} /> Unirme por código
        </button>
      </div>

      <AnimatePresence>
        {modal === 'create' && <CreateModal onClose={() => setModal(null)} onDone={() => { setModal(null); load() }} />}
        {modal === 'join' && <JoinModal onClose={() => setModal(null)} onDone={() => { setModal(null); load() }} />}
        {standingsFor && <StandingsModal group={standingsFor} onClose={() => setStandingsFor(null)} />}
      </AnimatePresence>
    </div>
  )
}

function GroupCard({ g, accent, onOpen }) {
  const hex = ACCENT_HEX[accent]
  return (
    <motion.button
      layout
      initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }}
      whileHover={{ y: -3 }}
      onClick={onOpen}
      className="relative overflow-hidden text-left rounded-3xl p-[18px] bg-white dark:bg-white/[0.035] border border-slate-200 dark:border-white/[0.07] hover:border-slate-300 dark:hover:border-white/15 transition-colors"
    >
      <span className="absolute left-0 top-0 bottom-0 w-1" style={{ background: hex }} />
      <div className="flex items-center justify-between mb-3">
        <div className="flex gap-1.5 flex-wrap">
          <span className="text-[10.5px] font-semibold px-2.5 py-1 rounded-full" style={{ color: hex, background: `${hex}22`, border: `1px solid ${hex}44` }}>{g.tournament_name}</span>
          <span className="text-[10.5px] font-semibold px-2.5 py-1 rounded-full text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-white/5">
            {g.tournament_kind === 'cup' ? '🏆 Copa' : '📊 Liga'}
          </span>
        </div>
        <span className="text-[11px] text-slate-400 flex items-center gap-1"><Users size={12} />{g.members}</span>
      </div>

      <h3 className="font-bold font-['Sora'] text-slate-900 dark:text-white text-[17px] leading-tight mb-3.5 truncate">{g.name}</h3>

      <div className="flex items-end justify-between">
        <div className="flex items-baseline gap-1.5">
          <span className="text-3xl font-extrabold font-['Sora'] leading-none" style={{ color: hex }}>#{g.my_rank}</span>
          <span className="text-xs text-slate-400">de {g.members}</span>
        </div>
        <div className="text-right">
          <span className="block text-xl font-extrabold font-['Sora'] text-slate-900 dark:text-white leading-none">{g.my_points}</span>
          <span className="text-[10px] text-slate-400 uppercase tracking-wide">puntos</span>
        </div>
      </div>

      <div className="flex items-center gap-1.5 mt-3.5 text-[12px] font-semibold" style={{ color: hex }}>
        Ver tabla <ChevronRight size={15} />
      </div>
    </motion.button>
  )
}

/* ---- Modales ---- */
function Sheet({ children, onClose, title }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onClose} className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4">
      <motion.div initial={{ y: 40, opacity: 0, scale: 0.98 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 40, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }} onClick={e => e.stopPropagation()}
        className="w-full sm:max-w-md bg-white dark:bg-[#12151c] rounded-t-3xl sm:rounded-3xl border border-slate-200 dark:border-white/10 shadow-2xl overflow-hidden max-h-[88vh] flex flex-col pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="flex items-center justify-between p-5 pb-3">
          <h3 className="font-bold font-['Sora'] text-lg text-slate-900 dark:text-white">{title}</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-slate-100 dark:bg-white/10 grid place-items-center text-slate-500"><X size={16} /></button>
        </div>
        <div className="px-5 pb-5 overflow-y-auto">{children}</div>
      </motion.div>
    </motion.div>
  )
}

function CreateModal({ onClose, onDone }) {
  const [name, setName] = useState('')
  const [tournaments, setTournaments] = useState([])
  const [tid, setTid] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  useEffect(() => { fetchTournaments().then(t => { setTournaments(t); setTid(t[0]?.id ?? null) }).catch(e => setErr(e.message)) }, [])

  const submit = async () => {
    if (!name.trim()) { setErr('Ponele un nombre'); return }
    try { setBusy(true); setErr(null); await createGroup(name.trim(), tid); onDone() }
    catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  return (
    <Sheet title="Crear quiniela" onClose={onClose}>
      <label className="block text-xs font-semibold text-slate-500 uppercase mb-1.5">Nombre</label>
      <input value={name} onChange={e => setName(e.target.value)} maxLength={40} placeholder="La Mejenga del Barrio"
        className="w-full bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-accent mb-4" />
      <label className="block text-xs font-semibold text-slate-500 uppercase mb-1.5">Torneo</label>
      <select value={tid ?? ''} onChange={e => setTid(Number(e.target.value))}
        className="w-full bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-accent mb-4">
        {tournaments.map(t => <option key={t.id} value={t.id}>{t.name} {t.kind === 'cup' ? '· Copa' : '· Liga'}</option>)}
      </select>
      {err && <p className="text-sm text-rose-500 mb-3">{err}</p>}
      <button onClick={submit} disabled={busy || !tid}
        className="w-full flex items-center justify-center gap-2 font-bold font-['Sora'] text-sm py-3.5 rounded-2xl text-slate-950 bg-gradient-to-br from-accent to-accent-dark disabled:opacity-50">
        {busy ? <Loader2 size={17} className="animate-spin" /> : <Plus size={17} />} Crear
      </button>
    </Sheet>
  )
}

function JoinModal({ onClose, onDone }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const submit = async () => {
    if (!code.trim()) { setErr('Escribí el código'); return }
    try { setBusy(true); setErr(null); await joinGroupByCode(code); onDone() }
    catch (e) { setErr(e.message.includes('inválido') ? 'Código inválido' : e.message) } finally { setBusy(false) }
  }
  return (
    <Sheet title="Unirme por código" onClose={onClose}>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-3">Pedile el código a quien creó la quiniela.</p>
      <input value={code} onChange={e => setCode(e.target.value.toUpperCase())} maxLength={6} placeholder="ABC123"
        className="w-full tracking-[0.4em] text-center font-['Sora'] font-bold text-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl px-4 py-3.5 text-slate-900 dark:text-white focus:outline-none focus:border-accent mb-4" />
      {err && <p className="text-sm text-rose-500 mb-3">{err}</p>}
      <button onClick={submit} disabled={busy}
        className="w-full flex items-center justify-center gap-2 font-bold font-['Sora'] text-sm py-3.5 rounded-2xl text-slate-950 bg-gradient-to-br from-accent to-accent-dark disabled:opacity-50">
        {busy ? <Loader2 size={17} className="animate-spin" /> : <KeyRound size={16} />} Unirme
      </button>
    </Sheet>
  )
}

function StandingsModal({ group, onClose }) {
  const [rows, setRows] = useState(null)
  const [copied, setCopied] = useState(false)
  useEffect(() => { fetchGroupStandings(group.id).then(setRows).catch(() => setRows([])) }, [group.id])
  const copy = () => { navigator.clipboard?.writeText(group.invitation_code); setCopied(true); setTimeout(() => setCopied(false), 1500) }

  return (
    <Sheet title={group.name} onClose={onClose}>
      <div className="flex items-center gap-2 mb-4">
        <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full text-accent bg-accent/10 border border-accent/25">{group.tournament_name}</span>
        <button onClick={copy} className="ml-auto flex items-center gap-1.5 text-xs font-bold text-slate-500 dark:text-slate-300 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg px-2.5 py-1.5">
          {copied ? <><Check size={13} className="text-emerald-500" /> Copiado</> : <><Copy size={13} /> {group.invitation_code}</>}
        </button>
      </div>
      {rows === null ? (
        <div className="py-8 text-center"><Loader2 className="animate-spin mx-auto text-slate-400" /></div>
      ) : (
        <div className="rounded-2xl border border-slate-200 dark:border-white/10 overflow-hidden">
          {rows.map((r, i) => (
            <div key={r.user_id} className={`flex items-center gap-3 px-4 py-3 border-b border-slate-100 dark:border-white/5 last:border-0 ${r.is_me ? 'bg-accent/[0.07]' : ''}`}>
              <span className={`w-7 h-7 rounded-lg grid place-items-center font-bold font-['Sora'] text-[13px] ${i === 0 ? 'bg-amber-300 text-amber-900' : i === 1 ? 'bg-slate-300 text-slate-700' : i === 2 ? 'bg-orange-300 text-orange-900' : 'bg-slate-100 dark:bg-white/5 text-slate-500'}`}>{i + 1}</span>
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-accent/30 to-violet-500/30 grid place-items-center text-xs font-bold overflow-hidden shrink-0">
                {r.avatar_url ? <img src={r.avatar_url} alt="" className="w-full h-full object-cover" /> : (r.display_name?.[0] || '?').toUpperCase()}
              </div>
              <span className="flex-1 text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{r.display_name}{r.is_me && <span className="text-accent text-xs font-bold"> · vos</span>}</span>
              <span className="font-extrabold font-['Sora'] text-slate-900 dark:text-white">{r.points}</span>
            </div>
          ))}
          {rows.length === 0 && <p className="text-sm text-slate-400 italic text-center py-6">Sin miembros todavía.</p>}
        </div>
      )}
    </Sheet>
  )
}
