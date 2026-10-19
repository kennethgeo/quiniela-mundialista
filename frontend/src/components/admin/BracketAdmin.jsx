import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Save, RefreshCw } from 'lucide-react'
import { nombreDeFase } from '../../lib/fasesDeTorneo'
import { predictionDeadline } from '../../lib/matchStatus'

const CAMPOS = ['home_team', 'away_team', 'home_team_code', 'away_team_code']
const copia = (m) => Object.fromEntries(CAMPOS.map((k) => [k, m[k] ?? null]))

export default function BracketAdmin() {
  const [torneos, setTorneos] = useState([])
  const [tid, setTid] = useState('')
  const [matches, setMatches] = useState([])
  const [drafts, setDrafts] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(null)
  const [error, setError] = useState('')
  const [mensaje, setMensaje] = useState('')
  const [revision, setRevision] = useState(0)
  const [ahora, setAhora] = useState(() => Date.now())

  useEffect(() => {
    const timer = setInterval(() => setAhora(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    let vigente = true
    supabase.from('tournaments').select('id,name').order('id').then(({ data, error }) => {
      if (!vigente) return
      if (error) { setError('No se pudieron cargar los torneos.'); setLoading(false); return }
      setTorneos(data || [])
      setTid(data?.length ? String(data[0].id) : '')
      if (!data?.length) setLoading(false)
    })
    return () => { vigente = false }
  }, [])

  useEffect(() => {
    if (!tid) return
    let vigente = true
    supabase.from('matches')
      .select('id,tournament_id,home_team,away_team,home_team_code,away_team_code,phase,stage,status,kickoff_at,score_locked,destapado_at')
      .eq('tournament_id', Number(tid)).neq('phase', 'groups')
      .order('kickoff_at', { ascending: true })
      .then(({ data, error }) => {
        if (!vigente) return
        if (error) setError('No se pudieron cargar los cruces. Volvé a intentar.')
        else setMatches(data || [])
        setLoading(false)
      })
    return () => { vigente = false }
  }, [tid, revision])

  const cambiarTorneo = (value) => {
    if (Object.keys(drafts).length) {
      setError('Guardá o descartá tus cambios antes de cambiar de torneo.')
      return
    }
    setMensaje(''); setError(''); setMatches([]); setLoading(true); setTid(value)
  }
  const recargar = () => { setLoading(true); setError(''); setMatches([]); setRevision((n) => n + 1) }
  const editar = (m, field, value) => {
    setMensaje('')
    setDrafts((prev) => ({ ...prev, [m.id]: { ...(prev[m.id] || copia(m)), [field]: value } }))
  }
  const guardar = async (m) => {
    if (saving != null) return
    try {
      setSaving(m.id); setError(''); setMensaje('')
      const { data, error } = await supabase.auth.getSession()
      if (error || !data?.session?.access_token) throw new Error('Tu sesión no está disponible. Volvé a ingresar.')
      const response = await fetch('/_backend/api/admin/update-match-teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` },
        body: JSON.stringify({ match_id: m.id, tournament_id: Number(tid), ...drafts[m.id], expected: copia(m) }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(typeof body.detail === 'string' ? body.detail : 'No se pudieron guardar los equipos.')
      if (!body.match || body.match.id !== m.id || body.match.tournament_id !== Number(tid)) {
        throw new Error('No se pudo confirmar el guardado. Recargá antes de volver a intentar.')
      }
      setMatches((rows) => rows.map((row) => row.id === m.id ? body.match : row))
      setDrafts((prev) => { const next = { ...prev }; delete next[m.id]; return next })
      setMensaje('Equipos actualizados. Los resultados y las predicciones no se modificaron.')
    } catch (e) {
      setError(e.message)
    } finally { setSaving(null) }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600 dark:text-slate-300">
        Configurá los cruces de cada torneo. Solo se editan partidos pendientes y abiertos;
        el servidor rechaza cambios si ya tienen predicciones.
        Usá «xx» cuando un equipo no tenga código o escudo.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm font-semibold text-slate-800 dark:text-white">
          Torneo
          <select aria-label="Torneo de las llaves" value={tid} disabled={saving != null}
            onChange={(e) => cambiarTorneo(e.target.value)}
            className="ml-2 p-2 rounded-lg bg-slate-100 dark:bg-slate-900">
            {torneos.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <button disabled={saving != null || Object.keys(drafts).length > 0}
          onClick={recargar}
          className="inline-flex items-center gap-1 p-2 text-sm text-slate-600 dark:text-slate-300 disabled:opacity-40">
          <RefreshCw size={15} /> Recargar cruces
        </button>
        {Object.keys(drafts).length > 0 && <button disabled={saving != null}
          onClick={() => { setDrafts({}); setError('') }}
          className="p-2 text-sm text-slate-600 dark:text-slate-300">Descartar cambios</button>}
      </div>
      {error && <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}
      {mensaje && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">{mensaje}</p>}
      {loading ? <p role="status">Cargando cruces…</p> : matches.length === 0
        ? <p className="text-sm text-slate-500">No hay eliminatorias en este torneo.</p>
        : matches.map((m) => {
          const datos = drafts[m.id] || copia(m)
          const cierre = predictionDeadline(m.kickoff_at)
          const abierto = m.status === 'pending' && !m.score_locked && !m.destapado_at
            && cierre && cierre.getTime() > ahora
          return (
            <fieldset key={m.id} disabled={!abierto || saving != null} className="glass-card p-4 space-y-3">
              <legend className="font-bold text-sm text-slate-900 dark:text-white">{m.stage || nombreDeFase(m.phase)} · #{m.id}</legend>
              {!abierto && <p className="text-xs text-slate-500">Solo lectura: este cruce está cerrado o fijado.</p>}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {CAMPOS.map((field) => (
                  <label key={field} className="text-xs text-slate-700 dark:text-slate-300">
                    {{ home_team: 'Equipo local', away_team: 'Equipo visitante', home_team_code: 'Código o escudo local', away_team_code: 'Código o escudo visitante' }[field]}
                    <input value={datos[field] ?? ''} onChange={(e) => editar(m, field, e.target.value)}
                      maxLength={field.endsWith('_code') ? 1024 : 120}
                      className="block w-full mt-1 p-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white" />
                  </label>
                ))}
              </div>
              <button onClick={() => guardar(m)} disabled={!drafts[m.id] || saving != null}
                className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-bold text-slate-950 disabled:opacity-40">
                <Save size={14} /> {saving === m.id ? 'Guardando…' : 'Guardar equipos'}
              </button>
            </fieldset>
          )
        })}
    </div>
  )
}
