/* Pozo y control de pagos de la quiniela.

   LA APP NO MUEVE PLATA: solo lleva la cuenta. El pago sigue siendo entre
   ustedes (efectivo, SINPE, lo que sea). Esto es un registro compartido para
   que nadie tenga que preguntar en el chat quién pagó y cuánto hay.

   El flujo es de dos pasos a propósito: el miembro avisa que pagó y el admin
   lo confirma. Así se distingue "dijo que pagó" de "está confirmado", que es
   justo la discusión que suele aparecer. */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Wallet, Check, Clock, Loader2, Pencil, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'

const REPARTO_DEFECTO = [
  { puesto: 1, porcentaje: 60 },
  { puesto: 2, porcentaje: 30 },
  { puesto: 3, porcentaje: 10 },
]

const plata = (n, moneda) => {
  const v = Number(n || 0)
  const txt = v.toLocaleString('es-CR', { maximumFractionDigits: 0 })
  return moneda === 'USD' ? `$${txt}` : `₡${txt}`
}

const ordinal = (n) => `${n}º`

export default function PozoYPagos({ leagueId }) {
  const qc = useQueryClient()
  const [editando, setEditando] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['league_pozo', leagueId],
    enabled: !!leagueId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('league_pozo', { p_league_id: leagueId })
      if (error) throw error
      return data
    },
  })

  const refrescar = () => qc.invalidateQueries({ queryKey: ['league_pozo', leagueId] })

  const avisar = useMutation({
    mutationFn: async (avisar) => {
      const { error } = await supabase.rpc('avisar_pago', { p_league_id: leagueId, p_avisar: avisar })
      if (error) throw error
    },
    onSuccess: refrescar,
  })

  const confirmar = useMutation({
    mutationFn: async ({ userId, confirmado }) => {
      const { error } = await supabase.rpc('confirmar_pago', {
        p_league_id: leagueId, p_user_id: userId, p_confirmado: confirmado,
      })
      if (error) throw error
    },
    onSuccess: refrescar,
  })

  if (isLoading || !data) return null

  const { cuota, moneda, reparto, soy_admin, miembros, pagados, pozo_total, recaudado, gente } = data
  const yo = (gente || []).find((g) => g.soy_yo)
  const sinConfigurar = !cuota || Number(cuota) === 0

  // Sin cuota configurada no hay nada que mostrarle al grupo; al admin sí, para
  // que sepa que puede configurarla.
  if (sinConfigurar && !soy_admin) return null

  return (
    <div className="rounded-[14px] bg-white dark:bg-[#161616] border border-slate-200 dark:border-[#262626] p-4 mt-4">
      <div className="flex items-center gap-2 mb-1">
        <Wallet size={15} className="text-accent" />
        <h3 className="font-bold font-['Archivo'] text-[13px] text-slate-900 dark:text-[#F3F1EA]">Pozo y pagos</h3>
        {soy_admin && !editando && (
          <button onClick={() => setEditando(true)} className="ml-auto text-accent" title="Configurar">
            <Pencil size={13} />
          </button>
        )}
      </div>

      {editando ? (
        <Config leagueId={leagueId} inicial={{ cuota, moneda, reparto }}
          onListo={() => { setEditando(false); refrescar() }} onCancelar={() => setEditando(false)} />
      ) : sinConfigurar ? (
        <p className="text-[11.5px] text-[var(--text-muted,#8A8A8A)] mt-1">
          Todavía no configuraste la cuota. Tocá el lápiz para hacerlo y que el grupo vea el pozo.
        </p>
      ) : (
        <>
          <p className="text-[11px] text-[var(--text-muted,#8A8A8A)] mb-3">
            La app no cobra ni reparte: solo lleva la cuenta. El pago es entre ustedes.
          </p>

          {/* Números del pozo */}
          <div className="grid grid-cols-3 gap-2 mb-3">
            <Dato etiqueta="Cuota" valor={plata(cuota, moneda)} />
            <Dato etiqueta="Recaudado" valor={plata(recaudado, moneda)} color="#2ED3B7" />
            <Dato etiqueta="Si pagan todos" valor={plata(pozo_total, moneda)} />
          </div>

          <p className="font-['JetBrains_Mono'] text-[10px] text-[var(--text-muted,#8A8A8A)] mb-3">
            {pagados} de {miembros} al día
            {pagados < miembros && ` · faltan ${plata((pozo_total - recaudado), moneda)}`}
          </p>

          {/* Reparto estimado */}
          {Array.isArray(reparto) && reparto.length > 0 && (
            <div className="rounded-xl bg-slate-50 dark:bg-[#0C0C0C] border border-slate-200 dark:border-[#262626] p-2.5 mb-3">
              <p className="font-['JetBrains_Mono'] text-[9px] uppercase tracking-[0.12em] text-[var(--text-muted,#8A8A8A)] mb-1.5">
                Reparto estimado
              </p>
              {reparto.map((r) => (
                <div key={r.puesto} className="flex items-center justify-between py-0.5">
                  <span className="text-[11.5px] text-slate-700 dark:text-slate-300">
                    {ordinal(r.puesto)} <span className="text-[var(--text-muted,#8A8A8A)]">· {r.porcentaje}%</span>
                  </span>
                  <span className="font-['JetBrains_Mono'] font-bold text-[12px] text-slate-900 dark:text-[#F3F1EA]">
                    {plata(pozo_total * (r.porcentaje / 100), moneda)}
                  </span>
                </div>
              ))}
              <p className="text-[9.5px] text-[var(--text-muted,#8A8A8A)] mt-1">
                Calculado sobre el pozo completo, asumiendo que pagan todos.
              </p>
            </div>
          )}

          {/* Mi estado */}
          {yo && !yo.confirmado && (
            <button onClick={() => avisar.mutate(!yo.aviso)} disabled={avisar.isPending}
              className="w-full mb-3 rounded-xl py-2.5 font-['Archivo'] font-bold text-[12px] disabled:opacity-50"
              style={yo.aviso
                ? { background: 'rgba(232,183,90,.14)', color: '#E8B75A' }
                : { background: 'rgba(46,211,183,.12)', color: '#2ED3B7' }}>
              {avisar.isPending ? '…' : yo.aviso ? 'Avisaste que pagaste · falta que lo confirmen' : 'Ya pagué'}
            </button>
          )}

          {/* Quién está al día */}
          <div className="space-y-1">
            {(gente || []).map((g) => (
              <div key={g.user_id} className="flex items-center gap-2 py-1">
                <div className="w-6 h-6 rounded-full grid place-items-center text-[9px] font-bold text-white overflow-hidden shrink-0"
                  style={{ background: g.soy_yo ? 'linear-gradient(135deg,#2ED3B7,#1a8f7c)' : 'linear-gradient(135deg,#5a2d8a,#3a1c5c)' }}>
                  {g.avatar_url ? <img src={g.avatar_url} alt="" className="w-full h-full object-cover" /> : (g.display_name?.[0] || '?').toUpperCase()}
                </div>
                <span className="flex-1 min-w-0 font-['Archivo'] text-[12px] text-slate-800 dark:text-[#F3F1EA] truncate">
                  {g.display_name}{g.soy_yo && <span className="text-accent font-bold"> (vos)</span>}
                </span>

                <Estado g={g} />

                {soy_admin && !g.soy_yo && (
                  <button
                    onClick={() => confirmar.mutate({ userId: g.user_id, confirmado: !g.confirmado })}
                    disabled={confirmar.isPending}
                    title={g.confirmado ? 'Marcar como pendiente' : 'Confirmar que pagó'}
                    className="shrink-0 text-[10px] font-bold px-2 py-1 rounded-lg disabled:opacity-50"
                    style={g.confirmado
                      ? { color: 'var(--text-muted,#8A8A8A)', background: 'rgba(127,127,127,.12)' }
                      : { color: '#2ED3B7', background: 'rgba(46,211,183,.12)' }}>
                    {g.confirmado ? 'quitar' : 'confirmar'}
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function Estado({ g }) {
  if (g.confirmado) {
    return (
      <span className="shrink-0 flex items-center gap-1 font-['JetBrains_Mono'] font-bold text-[9px] px-1.5 py-0.5 rounded-[20px]"
        style={{ color: '#2ED3B7', background: 'rgba(46,211,183,.14)' }}>
        <Check size={9} /> pagó
      </span>
    )
  }
  if (g.aviso) {
    return (
      <span className="shrink-0 flex items-center gap-1 font-['JetBrains_Mono'] font-bold text-[9px] px-1.5 py-0.5 rounded-[20px]"
        style={{ color: '#E8B75A', background: 'rgba(232,183,90,.14)' }}>
        <Clock size={9} /> avisó
      </span>
    )
  }
  return (
    <span className="shrink-0 font-['JetBrains_Mono'] text-[9px] px-1.5 py-0.5 rounded-[20px] text-[var(--text-muted,#8A8A8A)]"
      style={{ background: 'rgba(127,127,127,.10)' }}>
      pendiente
    </span>
  )
}

function Dato({ etiqueta, valor, color }) {
  return (
    <div className="rounded-xl bg-slate-50 dark:bg-[#0C0C0C] border border-slate-200 dark:border-[#262626] p-2 text-center">
      <div className="font-['JetBrains_Mono'] font-bold text-[13px]" style={color ? { color } : undefined}>{valor}</div>
      <div className="font-['Archivo'] text-[8.5px] uppercase tracking-wide text-[var(--text-muted,#8A8A8A)] mt-0.5">{etiqueta}</div>
    </div>
  )
}

function Config({ leagueId, inicial, onListo, onCancelar }) {
  const [cuota, setCuota] = useState(inicial.cuota || '')
  const [moneda, setMoneda] = useState(inicial.moneda || 'CRC')
  const [reparto, setReparto] = useState(
    Array.isArray(inicial.reparto) && inicial.reparto.length ? inicial.reparto : REPARTO_DEFECTO,
  )
  const [error, setError] = useState(null)

  const guardar = useMutation({
    mutationFn: async () => {
      const limpio = reparto
        .map((r) => ({ puesto: Number(r.puesto), porcentaje: Number(r.porcentaje) }))
        .filter((r) => r.puesto > 0 && r.porcentaje > 0)
      const { error } = await supabase.rpc('set_league_pozo', {
        p_league_id: leagueId,
        p_cuota: Number(cuota) || 0,
        p_moneda: moneda,
        p_reparto: limpio.length ? limpio : null,
      })
      if (error) throw error
    },
    onSuccess: onListo,
    onError: (e) => setError(e.message),
  })

  const suma = reparto.reduce((s, r) => s + (Number(r.porcentaje) || 0), 0)

  return (
    <div className="mt-2 space-y-2.5">
      <div className="flex gap-2">
        <div className="flex-1">
          <label className="block text-[10px] font-bold text-[var(--text-muted,#8A8A8A)] uppercase mb-1">Cuota por persona</label>
          <input type="number" inputMode="numeric" min="0" value={cuota} onChange={(e) => setCuota(e.target.value)}
            className="w-full bg-slate-100 dark:bg-[#0C0C0C] border border-slate-200 dark:border-[#262626] rounded-xl px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-accent" />
        </div>
        <div className="w-24">
          <label className="block text-[10px] font-bold text-[var(--text-muted,#8A8A8A)] uppercase mb-1">Moneda</label>
          <select value={moneda} onChange={(e) => setMoneda(e.target.value)}
            className="w-full bg-slate-100 dark:bg-[#0C0C0C] border border-slate-200 dark:border-[#262626] rounded-xl px-2 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-accent">
            <option value="CRC">₡ CRC</option>
            <option value="USD">$ USD</option>
          </select>
        </div>
      </div>

      <div>
        <label className="block text-[10px] font-bold text-[var(--text-muted,#8A8A8A)] uppercase mb-1">
          Reparto · suma {suma}%
        </label>
        {reparto.map((r, i) => (
          <div key={i} className="flex items-center gap-2 mb-1.5">
            <span className="w-10 text-[12px] text-slate-600 dark:text-slate-300">{ordinal(r.puesto)}</span>
            <input type="number" inputMode="numeric" min="0" max="100" value={r.porcentaje}
              onChange={(e) => setReparto(reparto.map((x, j) => j === i ? { ...x, porcentaje: e.target.value } : x))}
              className="flex-1 bg-slate-100 dark:bg-[#0C0C0C] border border-slate-200 dark:border-[#262626] rounded-lg px-2 py-1.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-accent" />
            <span className="text-[12px] text-[var(--text-muted,#8A8A8A)]">%</span>
            <button onClick={() => setReparto(reparto.filter((_, j) => j !== i))}
              className="text-rose-500 p-1" title="Quitar puesto"><X size={13} /></button>
          </div>
        ))}
        <button onClick={() => setReparto([...reparto, { puesto: reparto.length + 1, porcentaje: 0 }])}
          className="text-[11px] font-bold text-accent">+ agregar puesto</button>
        {suma > 100 && (
          <p className="text-[10.5px] text-rose-500 mt-1">
            Suma más de 100%: estarías repartiendo plata que no existe.
          </p>
        )}
      </div>

      {error && <p className="text-[11px] text-rose-500">{error}</p>}

      <div className="flex gap-2">
        <button onClick={onCancelar}
          className="flex-1 rounded-xl py-2 font-['Archivo'] font-bold text-[12px] bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-300">
          Cancelar
        </button>
        <button onClick={() => guardar.mutate()} disabled={guardar.isPending || suma > 100}
          className="flex-1 rounded-xl py-2 font-['Archivo'] font-bold text-[12px] text-[#06231d] bg-accent disabled:opacity-50 flex items-center justify-center gap-1.5">
          {guardar.isPending ? <Loader2 size={13} className="animate-spin" /> : null} Guardar
        </button>
      </div>
    </div>
  )
}
