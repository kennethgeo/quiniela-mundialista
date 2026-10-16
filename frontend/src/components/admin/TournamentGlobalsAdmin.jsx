/* Admin: campeón/goleador/asistidor reales + bloqueo, POR TORNEO, y repartir
   sus puntos en UNA quiniela.

   Vigésima auditoría (ítem 1.4):
   - El campeón se ELIGE de la misma lista que ve la persona (los equipos de los
     partidos del torneo). Escrito a mano, «LD Alajuelense» dejaba a todos en 0
     sin ningún error.
   - Antes de repartir se ve quién acierta (vista previa del backend, que no
     escribe nada). Goleador y asistidor se comparan por nombre completo y
     alias exactos: quien escribió solo el apellido o con un error queda en 0
     salvo que se agregue como alias, y eso solo se nota mirando la lista.
   - Se reparte en la quiniela que se elige: la liga tica corre temporada tras
     temporada sobre el mismo torneo, y repartir en todas reescribiría las
     globales de una temporada ya cerrada.
   - Mientras las globales sigan ABIERTAS el backend no manda las picks (la RLS
     tampoco se las muestra a nadie, y el admin global también juega): no hay
     vista previa ni reparto hasta cerrarlas. */
import { useState, useEffect, useRef } from 'react'
import { Crown, Save, Calculator, Lock, Unlock, Loader2, CheckCircle2, AlertTriangle, LockOpen, Check, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'

const limpio = (s) => (s || '').trim()
const CATEGORIAS = [
  { clave: 'campeon', titulo: 'Campeón', real: 'actual_champion' },
  { clave: 'goleador', titulo: 'Goleador', real: 'actual_top_scorer' },
  { clave: 'asistidor', titulo: 'Asistidor', real: 'actual_top_assist' },
]

function ResumenCategoria({ titulo, datos, total, puntos }) {
  const definido = !!limpio(datos?.real)
  return (
    <div className="rounded-xl border border-slate-200 dark:border-white/10 p-3" data-categoria={titulo}>
      <div className="flex items-center justify-between gap-2 text-xs font-bold text-slate-700 dark:text-slate-200">
        <span>{titulo}</span>
        <span className="text-slate-400 font-semibold">
          {definido ? `${datos.aciertan} de ${total} aciertan · ${puntos} pts c/u` : 'Sin definir'}
        </span>
      </div>
      {definido && datos.aciertan === 0 && total > 0 && (
        <p className="mt-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-amber-500">
          <AlertTriangle size={12} /> Nadie acierta: ¿el nombre está bien escrito? Podés agregar alias separados por coma.
        </p>
      )}
      {(datos?.picks || []).length > 0 && (
        <ul className="mt-2 space-y-1">
          {datos.picks.map((p) => (
            <li key={p.pick} className="flex items-center gap-2 text-[12px] text-slate-600 dark:text-slate-300">
              {p.acierta
                ? <Check size={13} className="text-emerald-500 shrink-0" aria-label="acierta" />
                : <X size={13} className="text-slate-400 shrink-0" aria-label="no acierta" />}
              <span className="truncate">{p.pick}</span>
              <span className="ml-auto text-slate-400 shrink-0">{p.personas} {p.personas === 1 ? 'persona' : 'personas'}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function TournamentGlobalsAdmin() {
  const [tournaments, setTournaments] = useState([])
  const [tid, setTid] = useState(null)
  const [champion, setChampion] = useState('')
  const [scorer, setScorer] = useState('')
  const [assist, setAssist] = useState('')
  const [locked, setLocked] = useState(false)
  const [forceOpen, setForceOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  // Vista previa del backend: quinielas del torneo, equipos y quién acierta
  // con los reales GUARDADOS (los que va a usar el reparto).
  const [vista, setVista] = useState(null)
  const [cargandoVista, setCargandoVista] = useState(false)
  const [errorVista, setErrorVista] = useState(null)
  const [leagueId, setLeagueId] = useState('')
  const tidActual = useRef(null)
  const flash = (type, text) => { setMsg({ type, text }); setTimeout(() => setMsg(null), 5000) }

  const callAdmin = async (path, body) => {
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`/_backend/api/admin/${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify(body),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(json.detail || `Error ${res.status}`)
    return json
  }

  const cargarVista = async (id) => {
    setCargandoVista(true); setErrorVista(null)
    try {
      const r = await callAdmin('calc-tournament-globals', { tournament_id: id, dry_run: true })
      if (tidActual.current !== id) return
      setVista(r)
      setLeagueId((prev) => {
        const ids = (r.ligas || []).map((l) => l.league_id)
        if (ids.includes(prev)) return prev
        return ids.length === 1 ? ids[0] : ''
      })
    } catch (e) {
      if (tidActual.current === id) { setVista(null); setErrorVista(e.message) }
    } finally {
      if (tidActual.current === id) setCargandoVista(false)
    }
  }

  const selectT = (t) => {
    tidActual.current = t.id
    setTid(t.id); setChampion(t.actual_champion || ''); setScorer(t.actual_top_scorer || ''); setAssist(t.actual_top_assist || ''); setLocked(!!t.predictions_locked); setForceOpen(!!t.predictions_force_open)
    setVista(null); setLeagueId('')
    cargarVista(t.id)
  }
  const onSelect = (id) => { const t = tournaments.find(x => x.id === id); if (t) selectT(t) }

  useEffect(() => {
    supabase.from('tournaments').select('id, name, actual_champion, actual_top_scorer, actual_top_assist, predictions_locked, predictions_force_open').order('id')
      .then(({ data }) => { setTournaments(data || []); if (data?.[0]) selectT(data[0]) })
    // selectT solo se usa para el primer torneo al montar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // La vista previa vale mientras el formulario diga lo mismo que lo guardado
  // con lo que se calculó. Si el admin cambia un nombre, hay que guardar y
  // volver a mirar antes de repartir.
  const vigente = !!vista && limpio(vista.reales?.actual_champion) === limpio(champion)
    && limpio(vista.reales?.actual_top_scorer) === limpio(scorer)
    && limpio(vista.reales?.actual_top_assist) === limpio(assist)
  const liga = (vista?.ligas || []).find((l) => l.league_id === leagueId) || null
  const equipos = vista?.equipos || []
  const campeonFueraDeLista = !!limpio(champion) && !equipos.includes(champion)
  const abiertas = !!vista?.abiertas
  const puedeRepartir = !!liga && vigente && !abiertas

  const save = async () => {
    try {
      setBusy(true)
      await callAdmin('set-tournament-globals', { tournament_id: tid, actual_champion: champion, actual_top_scorer: scorer, actual_top_assist: assist, predictions_locked: locked, predictions_force_open: forceOpen })
      setTournaments(prev => prev.map(t => t.id === tid ? { ...t, actual_champion: champion, actual_top_scorer: scorer, actual_top_assist: assist, predictions_locked: locked, predictions_force_open: forceOpen } : t))
      flash('ok', 'Guardado.')
      await cargarVista(tid)
    } catch (e) { flash('error', e.message) } finally { setBusy(false) }
  }

  const calc = async () => {
    if (!puedeRepartir) return
    const linea = (c) => {
      const d = liga[c.clave]
      return limpio(d?.real) ? `${c.titulo}: ${d.aciertan} de ${liga.predicciones} aciertan` : `${c.titulo}: sin definir`
    }
    const texto = [`¿Repartir los puntos en «${liga.nombre}»?`, '', ...CATEGORIAS.map(linea),
      '', `Cambian ${liga.cambiarian} predicciones. Las demás quinielas del torneo no se tocan.`].join('\n')
    if (!confirm(texto)) return
    try {
      setBusy(true)
      const r = await callAdmin('calc-tournament-globals', { tournament_id: tid, league_id: liga.league_id, esperado: vista.reales })
      flash('ok', `Puntos repartidos en «${liga.nombre}»: ${r.updated} predicciones (${r.users} jugadores).`)
      await cargarVista(tid)
    } catch (e) { flash('error', e.message) } finally { setBusy(false) }
  }

  return (
    <div className="glass-card p-5 mt-4">
      <div className="flex items-center gap-2 mb-4 border-b border-white/10 pb-3">
        <Crown className="text-accent" size={20} />
        <h2 className="text-lg font-bold text-slate-900 dark:text-white font-['Unbounded']">Campeón / Goleador / Asistidor por torneo</h2>
      </div>

      {msg && (
        <div role="status" className={`mb-3 flex items-center gap-2 text-xs font-semibold ${msg.type === 'ok' ? 'text-emerald-500' : 'text-rose-500'}`}>
          {msg.type === 'ok' ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}{msg.text}
        </div>
      )}

      <select aria-label="Torneo" value={tid ?? ''} onChange={e => onSelect(Number(e.target.value))}
        className="w-full bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl px-4 py-2.5 text-sm text-slate-900 dark:text-white mb-4">
        {tournaments.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>

      <label htmlFor="campeon-real" className="block text-xs font-semibold text-slate-500 uppercase mb-1.5">Campeón real</label>
      <select id="campeon-real" value={champion} onChange={e => setChampion(e.target.value)}
        className="w-full bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl px-4 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-accent mb-1">
        <option value="">— sin definir —</option>
        {campeonFueraDeLista && <option value={champion}>{vista ? `${champion} (no está en la lista de equipos)` : champion}</option>}
        {equipos.map(t => <option key={t} value={t}>{t}</option>)}
      </select>
      <p className="text-[11px] text-slate-400 mb-3">
        {equipos.length ? 'La misma lista de equipos que ven los jugadores al elegir campeón.' : (cargandoVista ? 'Cargando equipos…' : 'Este torneo todavía no tiene partidos cargados.')}
      </p>

      <label htmlFor="goleador-real" className="block text-xs font-semibold text-slate-500 uppercase mb-1.5">Goleador real</label>
      <input id="goleador-real" value={scorer} onChange={e => setScorer(e.target.value)} placeholder="Ej. Mbappé, Kylian Mbappé (alias o empate, con coma)"
        className="w-full bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl px-4 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-accent mb-1" />
      <p className="text-[11px] text-slate-400 mb-3">Se compara el nombre COMPLETO (sin importar tildes ni mayúsculas). Para aceptar otra forma de escribirlo o un empate, separá con coma.</p>

      <label htmlFor="asistidor-real" className="block text-xs font-semibold text-slate-500 uppercase mb-1.5">Asistidor real</label>
      <input id="asistidor-real" value={assist} onChange={e => setAssist(e.target.value)} placeholder="Ej. De Bruyne, Kevin De Bruyne"
        className="w-full bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl px-4 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-accent mb-1" />
      <p className="text-[11px] text-slate-400 mb-3">Quien repartió más asistencias. Igual que el goleador: nombre completo, alias con coma.</p>

      <label className="flex items-center gap-2 cursor-pointer mb-3">
        <input type="checkbox" checked={locked} onChange={e => setLocked(e.target.checked)} className="accent-accent w-4 h-4" />
        <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
          {locked ? <Lock size={13} className="text-rose-500" /> : <Unlock size={13} className="text-emerald-500" />}
          Predicciones bloqueadas (campeón/goleador/asistidor)
        </span>
      </label>

      <label className="flex items-start gap-2 cursor-pointer mb-4">
        <input type="checkbox" checked={forceOpen} onChange={e => setForceOpen(e.target.checked)} className="accent-accent w-4 h-4 mt-0.5" />
        <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
          <span className="flex items-center gap-1.5"><LockOpen size={13} className="text-amber-500" /> Forzar apertura aunque ya haya arrancado</span>
          <span className="block text-[10.5px] font-normal text-slate-400 mt-0.5">
            Reabre las predicciones globales pese a que el torneo ya inició (p. ej. para que alguien que faltó pueda predecir). Sin esto, "Predicciones bloqueadas" en falso no alcanza una vez arrancado el primer partido.
          </span>
        </span>
      </label>

      <button onClick={save} disabled={busy || !tid}
        className="w-full flex items-center justify-center gap-2 text-sm font-bold py-2.5 rounded-xl bg-slate-200 dark:bg-white/10 text-slate-800 dark:text-white hover:bg-slate-300 dark:hover:bg-white/20 disabled:opacity-50 mb-5">
        {busy ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Guardar y ver quién acierta
      </button>

      <div className="border-t border-white/10 pt-4">
        <label htmlFor="quiniela-reparto" className="block text-xs font-semibold text-slate-500 uppercase mb-1.5">Quiniela donde se reparte</label>
        <select id="quiniela-reparto" value={leagueId} onChange={e => setLeagueId(e.target.value)} disabled={!vista?.ligas?.length}
          className="w-full bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl px-4 py-2.5 text-sm text-slate-900 dark:text-white mb-1 disabled:opacity-60">
          <option value="">— elegir quiniela —</option>
          {(vista?.ligas || []).map(l => <option key={l.league_id} value={l.league_id}>{l.nombre}</option>)}
        </select>
        <p className="text-[11px] text-slate-400 mb-3">
          Solo se tocan las predicciones de esa quiniela. Si el torneo se juega en varias temporadas, las demás quedan como están.
        </p>

        {cargandoVista && <p className="text-xs text-slate-400 flex items-center gap-1.5 mb-3"><Loader2 size={13} className="animate-spin" /> Calculando quién acierta…</p>}
        {errorVista && <p role="alert" className="text-xs font-semibold text-rose-500 flex items-center gap-1.5 mb-3"><AlertTriangle size={13} /> No se pudo calcular la vista previa: {errorVista}</p>}
        {vista && !cargandoVista && !vista.ligas?.length && <p className="text-xs text-slate-400 mb-3">Este torneo no tiene quinielas.</p>}
        {vista && !vigente && (
          <p className="text-xs font-semibold text-amber-500 flex items-center gap-1.5 mb-3"><AlertTriangle size={13} /> Cambiaste los reales: guardá para ver quién acierta antes de repartir.</p>
        )}

        {vista && vigente && abiertas && (
          <p className="text-xs font-semibold text-amber-500 flex items-center gap-1.5 mb-3" data-testid="globales-abiertas">
            <Lock size={13} /> Las globales siguen abiertas: la vista previa se ve al cerrarlas, y recién ahí se puede repartir.
          </p>
        )}

        {puedeRepartir && (
          <div className="space-y-2 mb-4" data-testid="vista-previa">
            <p className="text-xs text-slate-500">{liga.predicciones} predicciones en «{liga.nombre}» · cambian {liga.cambiarian}</p>
            {CATEGORIAS.map(c => (
              <ResumenCategoria key={c.clave} titulo={c.titulo} datos={liga[c.clave]} total={liga.predicciones} puntos={liga.puntos?.[c.clave]} />
            ))}
          </div>
        )}

        <button onClick={calc} disabled={busy || !puedeRepartir}
          className="w-full flex items-center justify-center gap-2 text-sm font-bold py-2.5 rounded-xl bg-accent text-slate-950 hover:bg-accent-light disabled:opacity-50">
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Calculator size={15} />} {liga ? `Repartir en «${liga.nombre}»` : 'Repartir puntos'}
        </button>
      </div>
    </div>
  )
}
