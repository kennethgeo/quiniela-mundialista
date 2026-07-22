// Hub de quinielas (grupos) — rediseño Tico Games. Datos reales vía RPCs.
import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'motion/react'
import { Plus, KeyRound, Users, X, Loader2, ChevronRight } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { fetchMyGroups, fetchTournaments, createGroup, joinGroupByCode, DEFAULT_RULES } from '../lib/groups'

// Paleta cíclica idéntica al mockup de Claude Design (teal, coral, gold, gris)
const PALETTE = [
  { color: '#2ED3B7', colorBg: 'rgba(46,211,183,.12)', grad: 'linear-gradient(90deg,#2ED3B7,#26bfa5)' },
  { color: '#FF7A59', colorBg: 'rgba(255,122,89,.14)', grad: 'linear-gradient(90deg,#FF7A59,#e85f3d)' },
  { color: '#E8B75A', colorBg: 'rgba(232,183,90,.14)', grad: 'linear-gradient(90deg,#E8B75A,#c99a3f)' },
  { color: '#8A8A8A', colorBg: 'rgba(138,138,138,.14)', grad: 'linear-gradient(90deg,#8A8A8A,#5c5c5c)' },
]

export default function HubPage() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [groups, setGroups] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [modal, setModal] = useState(null) // 'create' | 'join' | null

  const load = useCallback(async () => {
    try {
      setLoading(true); setError(null)
      const data = await fetchMyGroups()
      setGroups(data)
      // Mantener sincronizada la caché de React Query que usa la página de quiniela.
      queryClient.setQueryData(['my_groups'], data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [queryClient])

  useEffect(() => { load() }, [load])

  const firstName = (profile?.display_name || '').split(' ')[0] || 'crack'
  const initial = (profile?.display_name?.charAt(0) || '?').toUpperCase()

  return (
    <div className="max-w-xl mx-auto">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
        className="flex justify-between items-start mb-[22px]">
        <div>
          <div className="font-['Archivo'] font-semibold text-[13px] text-[var(--text-muted,#8A8A8A)]">Hola, {firstName} 👋</div>
          <h1 className="font-['Unbounded'] font-bold text-[24px] tracking-[-0.02em] mt-1 text-slate-900 dark:text-[#F3F1EA]">Mis quinielas</h1>
          <div className="font-['Archivo'] font-semibold text-xs text-[var(--text-muted,#8A8A8A)] mt-1.5">
            {loading ? 'Cargando…' : groups.length === 0
              ? 'Todavía no estás en ninguna'
              : <>Estás en <span className="text-accent font-bold">{groups.length} {groups.length === 1 ? 'quiniela' : 'quinielas'}</span></>}
          </div>
        </div>
        <div className="w-[42px] h-[42px] rounded-full grid place-items-center font-['Unbounded'] font-bold text-[15px] text-[#06231d] shrink-0"
          style={{ background: 'linear-gradient(135deg,#2ED3B7,#1a8f7c)' }}>{initial}</div>
      </motion.div>

      {/* CTAs */}
      <div className="flex gap-2.5 mb-6">
        <button onClick={() => setModal('create')}
          className="flex-1 flex items-center justify-center gap-2 rounded-xl py-3.5 font-['Archivo'] font-bold text-[13.5px] text-[#06231d] bg-gradient-to-r from-[#2ED3B7] to-[#26bfa5] active:scale-[0.98] transition-transform">
          <Plus size={17} /> Crear quiniela
        </button>
        <button onClick={() => setModal('join')}
          className="flex-1 flex items-center justify-center gap-2 rounded-xl py-3.5 font-['Archivo'] font-bold text-[13.5px] bg-transparent border-[1.5px] border-slate-200 dark:border-[#262626] text-slate-900 dark:text-[#F3F1EA] active:scale-[0.98] transition-transform">
          <KeyRound size={16} /> Unirme por código
        </button>
      </div>

      {error && (
        <div className="mb-4 text-sm text-[#FF7A59] bg-[#FF7A59]/10 border border-[#FF7A59]/25 rounded-xl p-3">
          {error.includes('function') || error.includes('does not exist')
            ? 'Falta correr la migración 26 en la base de datos.' : error}
        </div>
      )}

      {/* Lista de grupos */}
      {loading ? (
        <div className="space-y-3.5">
          {[0, 1].map(i => <div key={i} className="h-36 rounded-2xl bg-slate-100 dark:bg-white/[0.04] animate-pulse" />)}
        </div>
      ) : groups.length === 0 ? (
        <div className="border-[1.5px] border-dashed border-slate-200 dark:border-[#262626] rounded-2xl px-5 py-9 text-center">
          <div className="text-3xl mb-2.5">⚽</div>
          <div className="font-['Unbounded'] font-bold text-base text-slate-900 dark:text-[#F3F1EA]">Todavía no estás en ninguna</div>
          <div className="font-['Archivo'] font-medium text-xs text-[var(--text-muted,#8A8A8A)] mt-1.5 max-w-[280px] mx-auto">
            Creá tu propia quiniela o unite con el código de tus amigos
          </div>
        </div>
      ) : (
        <motion.div layout className="space-y-3.5">
          <AnimatePresence>
            {groups.map((g, i) => (
              <GroupCard key={g.id} g={g} pal={PALETTE[i % PALETTE.length]} onOpen={() => navigate(`/q/${g.id}`)} />
            ))}
          </AnimatePresence>
        </motion.div>
      )}

      <AnimatePresence>
        {modal === 'create' && <CreateModal onClose={() => setModal(null)} onDone={() => { setModal(null); load() }} />}
        {modal === 'join' && <JoinModal onClose={() => setModal(null)} onDone={() => { setModal(null); load() }} />}
      </AnimatePresence>

      <div className="text-center font-['JetBrains_Mono'] text-[8px] tracking-[0.12em] text-[#3a3a3a] mt-8">HUB-UI · 21jul · r2</div>
    </div>
  )
}

function GroupCard({ g, pal, onOpen }) {
  const { color, colorBg, grad } = pal
  return (
    <motion.button
      layout
      initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }}
      whileHover={{ y: -2 }}
      onClick={onOpen}
      className="relative overflow-hidden text-left w-full rounded-2xl p-[18px] bg-white dark:bg-[#161616] border border-slate-200 dark:border-[#262626] transition-colors"
    >
      <span className="absolute top-0 left-0 right-0 h-[3px]" style={{ background: grad }} />

      <div className="flex justify-between items-start gap-2.5">
        <div className="min-w-0 font-['Archivo'] font-bold text-[15px] leading-[1.25] text-slate-900 dark:text-[#F3F1EA]">{g.name}</div>
        <span className="font-['JetBrains_Mono'] font-bold text-[9px] px-2 py-[3px] rounded-[20px] whitespace-nowrap shrink-0"
          style={{ color, background: colorBg }}>
          {g.tournament_kind === 'cup' ? 'COPA' : 'LIGA'}
        </span>
      </div>
      <div className="font-['JetBrains_Mono'] font-semibold text-[10px] text-[var(--text-muted,#8A8A8A)] mt-1.5 tracking-[0.05em] uppercase truncate">{g.tournament_name}</div>

      <div className="flex justify-between items-baseline mt-[18px]">
        <div>
          <span className="font-['Unbounded'] font-bold text-[22px]" style={{ color }}>#{g.my_rank}</span>
          <span className="font-['Archivo'] font-semibold text-[11px] text-[var(--text-muted,#8A8A8A)]"> de {g.members}</span>
        </div>
        <div className="font-['JetBrains_Mono'] font-bold text-[18px] text-slate-900 dark:text-[#F3F1EA]">{g.my_points} pts</div>
      </div>

      <div className="flex justify-between items-center mt-3.5 pt-3 border-t border-slate-200 dark:border-[#262626]">
        <span className="font-['Archivo'] font-semibold text-[10.5px] text-[var(--text-muted,#8A8A8A)] flex items-center gap-1"><Users size={12} /> {g.members} miembros</span>
        <span className="font-['Archivo'] font-semibold text-[10.5px] flex items-center gap-1" style={{ color }}>Ver tabla <ChevronRight size={13} /></span>
      </div>
    </motion.button>
  )
}

/* ---- Modales ---- */
function Sheet({ children, onClose, title }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onClose} className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.96, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 28 }} onClick={e => e.stopPropagation()}
        className="w-full max-w-[360px] bg-white dark:bg-[#0C0C0C] rounded-[20px] border border-slate-200 dark:border-[#262626] shadow-[0_20px_50px_-20px_rgba(0,0,0,0.6)] overflow-hidden max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-[22px] pt-[22px] pb-2">
          <h3 className="font-bold font-['Unbounded'] text-[17px] text-slate-900 dark:text-[#F3F1EA]">{title}</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-slate-100 dark:bg-white/10 grid place-items-center text-slate-500 shrink-0"><X size={16} /></button>
        </div>
        <div className="px-[22px] pb-[22px] overflow-y-auto">{children}</div>
      </motion.div>
    </motion.div>
  )
}

const MODAL_INPUT = "w-full bg-slate-100 dark:bg-[#161616] border-[1.5px] border-slate-200 dark:border-[#262626] rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-[#F3F1EA] focus:outline-none focus:border-accent"

function CreateModal({ onClose, onDone }) {
  const [name, setName] = useState('')
  const [tournaments, setTournaments] = useState([])
  const [tid, setTid] = useState(null)
  const [rules, setRules] = useState(DEFAULT_RULES)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  useEffect(() => { fetchTournaments().then(t => { setTournaments(t); setTid(t[0]?.id ?? null) }).catch(e => setErr(e.message)) }, [])

  const submit = async () => {
    if (!name.trim()) { setErr('Ponele un nombre'); return }
    try { setBusy(true); setErr(null); await createGroup(name.trim(), tid, rules.trim()); onDone() }
    catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  return (
    <Sheet title="Crear quiniela" onClose={onClose}>
      <label className="block text-xs font-semibold text-slate-500 uppercase mb-1.5">Nombre</label>
      <input value={name} onChange={e => setName(e.target.value)} maxLength={40} placeholder="La Mejenga del Barrio"
        className={MODAL_INPUT + ' mb-4'} />
      <label className="block text-xs font-semibold text-slate-500 uppercase mb-1.5">Torneo</label>
      <select value={tid ?? ''} onChange={e => setTid(Number(e.target.value))} className={MODAL_INPUT + ' mb-4'}>
        {tournaments.map(t => <option key={t.id} value={t.id}>{t.name} {t.kind === 'cup' ? '· Copa' : '· Liga'}</option>)}
      </select>
      <label className="block text-xs font-semibold text-slate-500 uppercase mb-1.5">Reglas <span className="text-[10px] normal-case text-slate-400">(editables · las verán al unirse)</span></label>
      <textarea value={rules} onChange={e => setRules(e.target.value)} rows={7}
        className={MODAL_INPUT + ' mb-4 resize-none leading-relaxed text-[13px]'} />
      {err && <p className="text-sm text-[#FF7A59] mb-3">{err}</p>}
      <button onClick={submit} disabled={busy || !tid}
        className="w-full flex items-center justify-center gap-2 font-bold font-['Archivo'] text-sm py-3.5 rounded-xl text-[#06231d] bg-gradient-to-r from-[#2ED3B7] to-[#26bfa5] disabled:opacity-50">
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
        className="w-full tracking-[0.4em] text-center font-['JetBrains_Mono'] font-bold text-xl bg-slate-100 dark:bg-[#161616] border-[1.5px] border-slate-200 dark:border-[#262626] rounded-xl px-4 py-3.5 text-slate-900 dark:text-[#F3F1EA] focus:outline-none focus:border-accent mb-4" />
      {err && <p className="text-sm text-[#FF7A59] mb-3">{err}</p>}
      <button onClick={submit} disabled={busy}
        className="w-full flex items-center justify-center gap-2 font-bold font-['Archivo'] text-sm py-3.5 rounded-xl text-[#06231d] bg-gradient-to-r from-[#2ED3B7] to-[#26bfa5] disabled:opacity-50">
        {busy ? <Loader2 size={17} className="animate-spin" /> : <KeyRound size={16} />} Unirme
      </button>
    </Sheet>
  )
}
