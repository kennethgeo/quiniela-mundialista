/* Llenar una jornada entera de una sola vez.

   Con diez partidos por jornada, predecir era diez tarjetas y diez toques de
   "Guardar". Acá van todos en una lista compacta y se guardan en UNA sola
   escritura.

   ── El orden del lote NO es un detalle ──
   El trigger check_powerup_limit corre fila por fila DENTRO del mismo INSERT, y
   sí ve las filas anteriores del mismo lote. Comprobado contra Postgres: mover
   el ×2 del partido A al B funciona si el "apagar A" va antes que el "prender
   B", y REVIENTA con "Límite de comodines x2 alcanzado" si van al revés,
   aunque el estado final respete el cupo. Por eso el lote se ordena siempre con
   las desactivaciones primero (ver ordenarLote).

   El lote es atómico: si el trigger rechaza algo, no se guarda NADA. Es lo
   correcto — media jornada guardada sería peor que ninguna — pero obliga a que
   el cupo de ×2 se respete también acá, en vivo, antes de mandar. */
import { useState, useMemo } from 'react'
import { motion } from 'motion/react'
import { Zap, X, Loader2, Check, ListChecks } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { friendlySaveError } from '../../lib/saveError'
import { ordenarLote } from '../../lib/loteJornada'

const teamLabel = (t) => (t || '—')

export default function PredecirJornada({
  label, matches = [], predictions = [], leagueId, profileId,
  powerupLimit = 0, powerupsUsedFuera = 0, onClose, onGuardado,
}) {
  const previas = useMemo(() => {
    const o = {}
    for (const p of predictions) o[p.match_id] = p
    return o
  }, [predictions])

  const [filas, setFilas] = useState(() =>
    matches.map((m) => {
      const p = previas[m.id]
      return {
        match: m,
        home: p?.home_goals_pred ?? 0,
        away: p?.away_goals_pred ?? 0,
        x2: !!p?.use_powerup_x2,
        yaEstaba: !!p,
      }
    }),
  )
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)

  // Comodines de la jornada: los de esta lista + los que ya estaban puestos en
  // partidos que no se ven acá (otros filtros, o ya cerrados).
  const x2Aca = filas.filter((f) => f.x2).length
  const x2Total = powerupsUsedFuera + x2Aca
  const sinCupo = x2Total >= powerupLimit

  const set = (i, patch) => setFilas((f) => f.map((x, j) => (j === i ? { ...x, ...patch } : x)))

  const guardar = async () => {
    try {
      setGuardando(true); setError(null)
      const lote = ordenarLote(filas.map((f) => ({
        user_id: profileId,
        league_id: leagueId,
        match_id: f.match.id,
        prediction_type: 'Marcador',
        home_goals_pred: f.home,
        away_goals_pred: f.away,
        // La tanda de penales se sigue eligiendo en la tarjeta del partido: acá
        // no cabe sin volver la lista un formulario, y solo aplica a empates de
        // eliminatoria. Se conserva lo que ya hubiera.
        penalties_winner_pred: previas[f.match.id]?.penalties_winner_pred ?? null,
        use_powerup_x2: f.x2,
      })))
      const { error } = await supabase.from('predictions')
        .upsert(lote, { onConflict: 'user_id, league_id, match_id' })
      if (error) throw error
      onGuardado?.()
      onClose?.()
    } catch (e) {
      // Mismo traductor de errores que el guardado de a uno: si el lote se
      // cae por RLS (algún partido se cerró mientras tanto) o por el cupo de
      // ×2, el mensaje tiene que decir qué pasó, no un error de Postgres.
      setError(friendlySaveError(e))
      setGuardando(false)
    }
  }

  return (
    <>
      <motion.div className="fixed inset-0 bg-black/60 z-[90]" onClick={guardando ? undefined : onClose}
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
      <div className="fixed inset-0 z-[95] grid place-items-center p-4 pointer-events-none">
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 320, damping: 28 }}
          className="pointer-events-auto w-full max-w-md rounded-[18px] bg-white dark:bg-[#161616] border border-slate-200 dark:border-[#262626] shadow-2xl max-h-[84vh] flex flex-col overflow-hidden">

          <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 dark:border-[#262626]">
            <ListChecks size={15} className="text-accent" />
            <h3 className="font-bold font-['Archivo'] text-[13px] text-slate-900 dark:text-[#F3F1EA]">
              {label}
            </h3>
            {powerupLimit > 0 && (
              <span className="ml-auto font-['JetBrains_Mono'] font-bold text-[9px] px-2 py-0.5 rounded-[20px]"
                style={sinCupo
                  ? { color: '#FF7A59', background: 'rgba(255,122,89,.12)' }
                  : { color: '#2ED3B7', background: 'rgba(46,211,183,.12)' }}>
                ×2 · {Math.max(0, powerupLimit - x2Total)}/{powerupLimit}
              </span>
            )}
            <button onClick={onClose} disabled={guardando}
              className={`${powerupLimit > 0 ? '' : 'ml-auto '}p-1 text-[var(--text-muted,#8A8A8A)] disabled:opacity-40`}>
              <X size={16} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-3 py-2">
            {filas.map((f, i) => (
              <Fila key={f.match.id} f={f} i={i} set={set} sinCupo={sinCupo} />
            ))}
          </div>

          <div className="px-4 py-3 border-t border-slate-200 dark:border-[#262626]">
            {error && <p className="text-[11px] text-rose-500 mb-2">{error}</p>}
            <p className="text-[10.5px] text-[var(--text-muted,#8A8A8A)] mb-2">
              Se guardan los {filas.length} de una sola vez. Podés seguir editando cada
              uno por separado después.
            </p>
            <button onClick={guardar} disabled={guardando}
              className="w-full rounded-xl py-2.5 font-['Archivo'] font-bold text-[13px] text-[#06231d] bg-accent disabled:opacity-50 flex items-center justify-center gap-1.5">
              {guardando ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
              {guardando ? 'Guardando…' : `Guardar los ${filas.length}`}
            </button>
          </div>
        </motion.div>
      </div>
    </>
  )
}

/* Dos líneas por partido a propósito. En una sola, los dos steppers se comen
   el ancho y nombres como "Municipal Liberia" o "Pérez Zeledón" quedan
   cortados — y en una lista de diez partidos, no saber cuál estás prediciendo
   es justo el error que este modo tiene que evitar. */
function Fila({ f, i, set, sinCupo }) {
  // El ×2 se puede APAGAR siempre; encender solo si queda cupo.
  const puedeEncender = f.x2 || !sinCupo
  return (
    <div className="py-2 border-b border-slate-100 dark:border-[#1e1e1e] last:border-0">
      <div className="flex items-center gap-2">
        <span className="flex-1 min-w-0 font-['Archivo'] text-[12px] text-slate-800 dark:text-[#F3F1EA] truncate">
          {teamLabel(f.match.home_team)}
          <span className="text-[var(--text-muted,#8A8A8A)]"> vs </span>
          {teamLabel(f.match.away_team)}
        </span>

        <button onClick={() => puedeEncender && set(i, { x2: !f.x2 })} disabled={!puedeEncender}
          title={f.x2 ? 'Quitar el comodín ×2' : sinCupo ? 'Sin comodines ×2 en esta jornada' : 'Usar el comodín ×2'}
          className="shrink-0 flex items-center gap-1 h-6 px-2 rounded-lg font-['JetBrains_Mono'] font-bold text-[9px] disabled:opacity-25"
          style={f.x2
            ? { background: 'rgba(46,211,183,.18)', color: '#2ED3B7' }
            : { background: 'rgba(127,127,127,.10)', color: 'var(--text-muted,#8A8A8A)' }}>
          <Zap size={11} fill={f.x2 ? '#2ED3B7' : 'none'} /> ×2
        </button>
      </div>

      <div className="flex items-center justify-center gap-2 mt-1.5">
        <Contador value={f.home} onChange={(v) => set(i, { home: v })} />
        <span className="text-[11px] text-[var(--text-muted,#8A8A8A)]">:</span>
        <Contador value={f.away} onChange={(v) => set(i, { away: v })} />
      </div>
    </div>
  )
}

/* Contador chico: la lista tiene hasta diez filas, el stepper grande de la
   tarjeta no entra. [−] número [+] en línea — la primera versión usaba el
   número como botón de subir y no hay forma de que eso se adivine en un móvil,
   donde no existe el hover ni el title. */
function Contador({ value, onChange }) {
  return (
    <div className="shrink-0 flex items-center bg-slate-100 dark:bg-[#0C0C0C] border border-slate-200 dark:border-[#262626] rounded-lg">
      <button onClick={() => onChange(Math.max(0, value - 1))} disabled={value <= 0}
        aria-label="Un gol menos"
        className="w-6 h-7 grid place-items-center text-[var(--text-muted,#8A8A8A)] text-[14px] leading-none disabled:opacity-25">
        −
      </button>
      <span className="w-5 text-center font-['JetBrains_Mono'] font-bold text-[13px] text-slate-900 dark:text-[#F3F1EA] tabular-nums">
        {value}
      </span>
      <button onClick={() => onChange(Math.min(20, value + 1))} disabled={value >= 20}
        aria-label="Un gol más"
        className="w-6 h-7 grid place-items-center text-accent text-[14px] leading-none disabled:opacity-25">
        +
      </button>
    </div>
  )
}
