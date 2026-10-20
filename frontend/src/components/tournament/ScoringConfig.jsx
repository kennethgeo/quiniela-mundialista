import { useId, useState } from 'react'
import { Check, Loader2, Lock, Pencil, Vote } from 'lucide-react'
import { proposeRuleChange, setGroupScoring } from '../../lib/groups'

const campos = [
  ['points_exact', 'Marcador exacto', 3],
  ['points_correct', 'Resultado correcto', 1],
  ['powerup_limit', 'Comodines ×2 por jornada', 2],
  ['powerup_por_partidos', 'Un ×2 cada N partidos', ''],
  ['champion_points', 'Acertar campeón', 12],
  ['scorer_points', 'Acertar goleador', 12],
  ['assist_points', 'Acertar asistidor', 12],
]
const configuracionDe = (group) => Object.fromEntries(campos.map(([key, , inicial]) => [key, group[key] ?? inicial]))

export default function ScoringConfig({ group, isAdmin, tournamentStarted, hasOpenProposal, onSaved, onProposed, showToast }) {
  const id = useId()
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [cfg, setCfg] = useState(() => configuracionDe(group))
  const [error, setError] = useState(null)
  const propose = tournamentStarted

  const abrir = () => {
    setCfg(configuracionDe(group))
    setNote('')
    setError(null)
    setEditing(true)
  }
  const cancelar = () => {
    if (busy) return
    setCfg(configuracionDe(group))
    setNote('')
    setError(null)
    setEditing(false)
  }
  const save = async (event) => {
    event.preventDefault()
    if (busy) return
    // No convertir entradas vacías o decimales en un puntaje distinto al escrito.
    const parsed = {}
    for (const [key, label] of campos) {
      const value = cfg[key]
      if (key === 'powerup_por_partidos' && value === '') { parsed[key] = null; continue }
      const number = Number(value)
      if (String(value).trim() === '' || !Number.isSafeInteger(number) || number < (key === 'powerup_por_partidos' ? 1 : 0)) {
        setError(`${label}: escribí un número entero ${key === 'powerup_por_partidos' ? 'mayor que cero, o dejalo vacío para cupo fijo' : 'de cero o más'}.`)
        return
      }
      parsed[key] = number
    }
    try {
      setBusy(true)
      setError(null)
      if (propose) {
        await proposeRuleChange(group.id, 'scoring', parsed, note)
        showToast('Propuesta de puntaje enviada a votación del grupo.', 'success', 5000)
        onProposed?.()
      } else {
        await setGroupScoring(group.id, parsed)
        showToast('Reglas de puntaje actualizadas.', 'success', 4000)
        onSaved?.()
      }
      setNote('')
      setEditing(false)
    } catch (e) {
      setError(e.message || 'No se pudo guardar el puntaje. Tu borrador sigue acá.')
    } finally { setBusy(false) }
  }

  const fila = ([key, label]) => (
    <div key={key} className="scoring-row">
      <label htmlFor={editing ? `${id}-${key}` : undefined}>{label}</label>
      {editing ? (
        <input id={`${id}-${key}`} type="number" inputMode="numeric" min={key === 'powerup_por_partidos' ? 1 : 0}
          step="1" value={cfg[key]} disabled={busy}
          onChange={(event) => setCfg({ ...cfg, [key]: event.target.value })}
          aria-describedby={key === 'powerup_por_partidos' ? `${id}-frecuencia` : undefined} />
      ) : (
        <span className="scoring-value">{group[key] ?? '—'}<small>{key === 'powerup_limit' ? 'mínimo' : key === 'powerup_por_partidos' ? '' : 'pts'}</small></span>
      )}
    </div>
  )

  return (
    <div className="league-sheet scoring-sheet" aria-busy={busy}>
      <div className="league-sheet-heading">
        <div>
          <h3>Puntaje</h3>
        </div>
        {isAdmin && !editing && (!propose || !hasOpenProposal) && (
          <button onClick={abrir} className="league-button league-button-quiet">
            {propose ? <Vote size={14} /> : <Pencil size={14} />}{propose ? 'Proponer cambio' : 'Editar'}
          </button>
        )}
        {isAdmin && propose && hasOpenProposal && <span className="league-status"><Vote size={13} /> En votación</span>}
      </div>
      <form onSubmit={save} noValidate aria-label="Configuración de puntaje">
        {editing ? (
          <fieldset disabled={busy} className="scoring-fields">
            <legend>Por partido</legend>
            {campos.slice(0, 2).map(fila)}
          </fieldset>
        ) : (
          <div className="scoring-board">
            {campos.slice(0, 2).map(([key, label, initial]) => (
              <div key={key}>
                <span className="scoring-board-number">{group[key] ?? initial}<small>pts</small></span>
                <span>{label}</span>
              </div>
            ))}
          </div>
        )}
        <fieldset disabled={busy} className="scoring-fields">
          <legend>Comodines ×2</legend>
          {fila(campos[2])}
          {editing ? fila(campos[3]) : (
            <p className="scoring-footnote">{group.powerup_por_partidos
              ? `Un ×2 cada ${group.powerup_por_partidos} partidos; el mínimo se conserva.`
              : 'Cupo fijo por jornada, salvo ajustes por fase.'}</p>
          )}
          {editing && <p id={`${id}-frecuencia`} className="scoring-footnote">Dejá la frecuencia vacía para usar el cupo fijo. Los cupos por fase se ajustan abajo.</p>}
        </fieldset>
        <fieldset disabled={busy} className="scoring-fields">
          <legend>Elecciones del torneo</legend>
          {campos.slice(4).map(fila)}
        </fieldset>
        {editing && <>
          {propose && <label className="scoring-note">Motivo del cambio <span>(opcional)</span>
            <textarea value={note} onChange={(event) => setNote(event.target.value)} disabled={busy} rows={2}
              placeholder="Contale al grupo por qué proponés este cambio" />
          </label>}
          {error && <p role="alert" className="league-error">{error}</p>}
          <div className="league-form-actions">
            <button type="button" onClick={cancelar} disabled={busy} className="league-button league-button-quiet">Cancelar</button>
            <button type="submit" disabled={busy} className="league-button league-button-primary">
              {busy ? <Loader2 size={15} className="animate-spin" /> : propose ? <Vote size={15} /> : <Check size={15} />}
              {busy ? 'Enviando…' : propose ? 'Enviar a votación' : 'Guardar'}
            </button>
          </div>
        </>}
      </form>
      {propose && !editing && <p className="league-notice"><Lock size={14} />
        <span>{isAdmin
          ? 'El torneo ya inició: el puntaje queda bloqueado. Para cambiarlo, proponé el cambio y el grupo lo vota.'
          : 'El torneo ya inició: el puntaje queda bloqueado. Para cambiarlo, un admin tiene que proponerlo y lo vota el grupo.'}</span>
      </p>}
      {isAdmin && !propose && <p className="scoring-footnote mt-4">Cambiar el puntaje <strong>no vuelve a puntuar</strong> los partidos ya jugados: conservan sus puntos. Re-puntuarlos es cosa del admin de la app.</p>}
    </div>
  )
}
