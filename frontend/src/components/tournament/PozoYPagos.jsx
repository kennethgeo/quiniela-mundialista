/* Pozo y control de pagos de la quiniela — su PESTAÑA propia (13 oct 2026).

   LA APP NO MUEVE PLATA: solo lleva la cuenta. El pago sigue siendo entre
   ustedes (efectivo, SINPE, lo que sea). Esto es un registro compartido para
   que nadie tenga que preguntar en el chat quién pagó y cuánto hay.

   Lo ve TODO el grupo (la base lo limita a los miembros y al admin global).

   El flujo es de dos pasos a propósito: el miembro avisa que pagó —toda la
   cuota, la mitad o el monto que sea— y un admin de la quiniela lo confirma.
   Así se distingue "dijo que pagó" de "está confirmado", que es justo la
   discusión que suele aparecer. Un pago puede ir en partes: cada abono
   confirmado SUMA (migración 110), y el historial dice cuánto y quién.

   «Quitar» un pago confirmado pide confirmación y queda en el historial
   (migración 109): antes era un toque y no dejaba rastro. */
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useConsultaDelUsuario } from '../../hooks/useConsultaDelUsuario'
import { useHistorialPagosDisponible } from '../../hooks/useHistorialPagosDisponible'
import { Wallet, Check, Clock, Loader2, Pencil, X, AlertTriangle, History, Share2 } from 'lucide-react'
import { ErrorState } from '../ui/StatePanel'
import { supabase } from '../../lib/supabase'
import { describirMovimiento, plata } from '../../lib/historialPagos'
import {
  conAbonos, convertirReparto, detalleDe, estadoDe, etiquetaDe, faltaDe, montoDe, montoDelAviso,
  opcionesDeMonto, repartoDe, repartoParaGuardar, resumen, textoParaCompartir, validarMonto,
} from '../../lib/pozo'
import { renderPozoCard, compartirImagen } from '../../lib/shareCard'

const ordinal = (n) => `${n}º`

export default function PozoYPagos({ leagueId, nombreQuiniela = 'Quiniela' }) {
  const qc = useQueryClient()
  const [editando, setEditando] = useState(false)
  const [porQuitar, setPorQuitar] = useState(null)
  // De quién está abierto el panel de admin (registrar otro monto / quitar).
  const [gestionando, setGestionando] = useState(null)
  const [avisando, setAvisando] = useState(false)
  const [compartiendo, setCompartiendo] = useState(false)
  const [errorCompartir, setErrorCompartir] = useState(null)

  const { data, isLoading, isError, refetch } = useConsultaDelUsuario({
    queryKey: ['league_pozo', leagueId],
    enabled: !!leagueId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('league_pozo', { p_league_id: leagueId })
      if (error) throw error
      return data
    },
  })

  const refrescar = () => {
    qc.invalidateQueries({ queryKey: ['league_pozo', leagueId] })
    qc.invalidateQueries({ queryKey: ['historial_pagos', leagueId] })
  }
  const historial = useHistorialPagosDisponible(leagueId, !!data)

  // Avisar: con monto (110) o, con el servidor de antes, el botón de siempre.
  const avisar = useMutation({
    mutationFn: async ({ monto, retirar }) => {
      const { error } = retirar || monto == null
        ? await supabase.rpc('avisar_pago', { p_league_id: leagueId, p_avisar: !retirar })
        : await supabase.rpc('avisar_abono', { p_league_id: leagueId, p_monto: monto })
      if (error) throw error
    },
    onSuccess: () => { setAvisando(false); refrescar() },
  })

  /* Confirmar un abono. `totalVisto` es lo que el admin tenía en pantalla: si
     otro admin confirmó lo mismo en el medio, la base lo rechaza en vez de
     sumarlo dos veces. Con el servidor de antes, el confirmar de siempre. */
  const confirmar = useMutation({
    mutationFn: async ({ userId, monto, totalVisto, avisoVisto, quitar, completo }) => {
      const { error } = quitar
        ? await supabase.rpc('confirmar_pago', { p_league_id: leagueId, p_user_id: userId, p_confirmado: false })
        : completo
          ? await supabase.rpc('confirmar_pago', { p_league_id: leagueId, p_user_id: userId, p_confirmado: true })
          : await supabase.rpc('confirmar_abono', {
            p_league_id: leagueId, p_user_id: userId, p_monto: monto, p_total_visto: totalVisto,
            p_aviso_visto: avisoVisto,
          })
      if (error) throw error
    },
    onSuccess: () => { setPorQuitar(null); setGestionando(null); refrescar() },
    onError: () => setPorQuitar(null),
  })

  if (isError) return <ErrorState compact title="No pudimos cargar el pozo"
    description="Revisá tu conexión y reintentá." onRetry={refetch} />
  if (isLoading) return <p role="status" className="p-4 text-sm">Cargando pozo y pagos…</p>
  if (!data) return null

  const { cuota, moneda, reparto, soy_admin, gente } = data
  const r = resumen(data)
  const abonos = conAbonos(data)
  const yo = (gente || []).find((g) => g.soy_yo)
  const sinConfigurar = !cuota || Number(cuota) === 0
  const admins = (gente || []).filter((g) => g.es_admin).map((g) => g.display_name)
  const errorDePago = avisar.error || confirmar.error

  const compartir = async () => {
    if (compartiendo) return
    try {
      setCompartiendo(true); setErrorCompartir(null)
      const blob = await renderPozoCard({ nombreQuiniela, pozo: data })
      const slug = (nombreQuiniela || 'quiniela').toLowerCase().normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      const url = typeof window !== 'undefined' ? `${window.location.origin}/q/${leagueId}?tab=pozo` : ''
      await compartirImagen(blob, `pozo-${slug || 'quiniela'}.png`, `Pozo · ${nombreQuiniela}`,
        textoParaCompartir(data, nombreQuiniela, url))
    } catch (err) {
      console.error('No se pudo compartir el pozo:', err)
      setErrorCompartir('No se pudo armar la imagen. Probá de nuevo.')
    } finally {
      setCompartiendo(false)
    }
  }

  return (
    <div className="league-sheet pozo-sheet">
      <div className="league-sheet-heading pozo-heading">
        <div className="flex items-center gap-2.5">
          <Wallet size={21} className="league-ink" />
          <h3>Pozo y pagos</h3>
        </div>
        {!sinConfigurar && !editando && (
          <button onClick={compartir} disabled={compartiendo}
            className="league-button league-button-quiet ml-auto">
            {compartiendo ? <Loader2 size={14} className="animate-spin" /> : <Share2 size={14} />} Compartir
          </button>
        )}
        {soy_admin && !editando && (
          <button onClick={() => setEditando(true)} className={`league-button league-button-quiet ${sinConfigurar ? 'ml-auto' : ''}`} title="Configurar" aria-label="Configurar el pozo">
            <Pencil size={15} />
          </button>
        )}
      </div>

      {errorCompartir && <p role="alert" className="text-[11px] text-rose-500 mb-2">{errorCompartir}</p>}
      {errorDePago && <div className="my-3">
        <ErrorState compact title="No se guardó el cambio del pago"
          description={errorDePago.message || 'Actualizá el estado antes de volver a intentarlo.'}
          onRetry={async () => {
            const resultado = await refetch()
            if (!resultado.isError) { avisar.reset(); confirmar.reset() }
          }} />
      </div>}
      {editando ? (
        <Config leagueId={leagueId} inicial={{ cuota, moneda, reparto, total: r.total }}
          onListo={() => { setEditando(false); refrescar() }} onCancelar={() => setEditando(false)} />
      ) : sinConfigurar ? (
        <p className="text-[11.5px] text-[var(--text-muted,#8A8A8A)] mt-1">
          {soy_admin
            ? 'Todavía no configuraste la cuota. Tocá el lápiz para hacerlo y que el grupo vea el pozo.'
            : 'Esta quiniela todavía no tiene cuota. Cuando un admin la configure, el pozo aparece acá.'}
        </p>
      ) : (
        <>
          <p className="scoring-footnote mb-4">
            La app no cobra ni reparte: solo lleva la cuenta. El pago es entre ustedes.
          </p>

          {/* Números del pozo */}
          <div className="pozo-board">
            <div className="pozo-collected">
              <span>Recaudado</span>
              <strong>{plata(r.recaudado, moneda)}</strong>
            </div>
            <div className="pozo-targets">
              <Dato etiqueta="Si pagan todos" valor={plata(r.total, moneda)} />
              <Dato etiqueta="Cuota" valor={plata(cuota, moneda)} />
            </div>
          </div>
          <div className="pozo-progress"
            role="progressbar" aria-label="Recaudado del pozo"
            aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(r.avance * 100)}>
            <div style={{ width: `${r.avance * 100}%` }} />
          </div>

          <p className="pozo-progress-copy">
            <span><strong>{r.alDia} de {r.miembros}</strong> al día</span>
            {r.faltan > 0 && <span> · faltan {plata(r.faltan, moneda)}</span>}
          </p>

          {/* Premios: montos acordados o porcentajes del pozo */}
          <Premios reparto={repartoDe(data)} moneda={moneda} />

          {/* Mi estado */}
          {yo && (
            <MiPago yo={yo} cuota={cuota} moneda={moneda} abonos={abonos} abierto={avisando}
              onAbrir={() => setAvisando(true)} onCerrar={() => setAvisando(false)}
              pendiente={avisar.isPending}
              onAvisar={(monto) => avisar.mutate({ monto })}
              onRetirar={() => avisar.mutate({ retirar: true })} />
          )}

          {/* Quién está al día */}
          <div className="pozo-roster" aria-label="Pagos del grupo">
            <h4>Pagos del grupo <span>{r.miembros} personas</span></h4>
            {(gente || []).map((g) => (
              <div key={g.user_id}>
                <Fila g={g} cuota={cuota} moneda={moneda}>
                  {soy_admin && !g.soy_yo && (
                    <AccionAdmin g={g} cuota={cuota} moneda={moneda} abonos={abonos}
                      pendiente={confirmar.isPending}
                      onConfirmarAviso={() => confirmar.mutate({
                        userId: g.user_id, monto: montoDelAviso(g, cuota), totalVisto: montoDe(g),
                        avisoVisto: g.aviso ? montoDelAviso(g, cuota) : null,
                      })}
                      onConfirmarCompleto={() => confirmar.mutate({ userId: g.user_id, completo: true })}
                      onGestionar={() => setGestionando(gestionando === g.user_id ? null : g.user_id)}
                      onQuitar={() => setPorQuitar(g)} />
                  )}
                </Fila>
                {gestionando === g.user_id && (
                  <div className="ml-8 mb-2 rounded-xl border border-slate-200 dark:border-[#262626] p-2.5">
                    <p className="text-[11px] text-slate-600 dark:text-slate-300 mb-2">
                      Registrar un pago de <strong>{g.display_name}</strong>
                      {estadoDe(g) === 'parcial' && ` (lleva ${plata(montoDe(g), moneda)})`}
                    </p>
                    <FormMonto cuota={cuota} falta={faltaDe(g, cuota)} moneda={moneda}
                      accion="Confirmar" pendiente={confirmar.isPending}
                      onEnviar={(monto) => confirmar.mutate({ userId: g.user_id, monto, totalVisto: montoDe(g),
                        avisoVisto: g.aviso ? montoDelAviso(g, cuota) : null })}
                      onCancelar={() => setGestionando(null)} />
                    {g.confirmado && (
                      <button onClick={() => { setGestionando(null); setPorQuitar(g) }}
                        className="mt-2 text-[11px] font-bold text-rose-500">
                        Quitar el pago confirmado
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          {admins.length > 0 && (
            <p className="mt-3 text-[10.5px] text-[var(--text-muted,#8A8A8A)]">
              Confirman los pagos: {admins.join(', ')}.
            </p>
          )}

          {/* Quitar un pago confirmado no es un toque más: el pozo baja y se
              pierde la fecha original. Se confirma, y queda en el historial. */}
          {porQuitar && (
            <div role="dialog" aria-label={`Quitar el pago de ${porQuitar.display_name}`}
              className="mt-3 rounded-xl p-3 border" style={{ background: 'rgba(255,90,90,.08)', borderColor: 'rgba(255,90,90,.3)' }}>
              <div className="flex items-start gap-2 mb-2">
                <AlertTriangle size={14} className="text-rose-500 shrink-0 mt-0.5" />
                <p className="text-[11.5px] text-slate-700 dark:text-slate-200">
                  ¿Quitar el pago confirmado de <strong>{porQuitar.display_name}</strong>
                  {montoDe(porQuitar) > 0 && <> ({plata(montoDe(porQuitar), moneda)})</>}? Va a figurar como
                  pendiente y lo recaudado baja. {historial.data === true
                    ? 'Queda registrado en el historial quién lo quitó y cuándo; '
                    : 'No hay un historial de pagos verificado disponible para este cambio. '}
                  Si después se vuelve a confirmar, cuenta como un pago nuevo.
                </p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setPorQuitar(null)}
                  className="flex-1 rounded-xl py-2 font-['Archivo'] font-bold text-[12px] bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-300">
                  Cancelar
                </button>
                <button onClick={() => confirmar.mutate({ userId: porQuitar.user_id, quitar: true })}
                  disabled={confirmar.isPending}
                  className="flex-1 rounded-xl py-2 font-['Archivo'] font-bold text-[12px] text-white bg-rose-500 disabled:opacity-50 flex items-center justify-center gap-1.5">
                  {confirmar.isPending ? <Loader2 size={13} className="animate-spin" /> : null} Quitar el pago
                </button>
              </div>
            </div>
          )}

          {historial.data === true && <HistorialPagos leagueId={leagueId} gente={gente} abonos={abonos} />}
          {historial.data === false && <p className="mt-3 text-[11px] text-[var(--text-muted,#8A8A8A)]">
            El historial de pagos todavía no está disponible en esta quiniela.
          </p>}
          {historial.isError && <ErrorState compact title="No pudimos comprobar el historial de pagos"
            description="Volvé a comprobarlo antes de consultar los movimientos." onRetry={historial.refetch} />}
        </>
      )}
    </div>
  )
}

/* Lo de quien mira: avisar un pago (todo, la mitad u otro monto), ver que
   falta que lo confirmen, cambiarlo o retirarlo. */
function MiPago({ yo, cuota, moneda, abonos, abierto, onAbrir, onCerrar, pendiente, onAvisar, onRetirar }) {
  const estado = estadoDe(yo)
  const falta = faltaDe(yo, cuota)
  if (estado === 'pagado') {
    return (
      <p className="mb-3 rounded-xl py-2.5 px-3 text-center font-['Archivo'] font-bold text-[12px]"
        style={{ background: 'rgba(46,211,183,.12)', color: 'var(--league-green)' }}>
        <Check size={13} className="inline -mt-0.5" /> Estás al día
      </p>
    )
  }
  if (abierto) {
    return (
      <div className="mb-3 rounded-xl border border-slate-200 dark:border-[#262626] p-2.5">
        <p className="text-[11.5px] text-slate-700 dark:text-slate-200 mb-2">
          ¿Cuánto pagaste?{estado === 'parcial' && ` Llevás ${plata(montoDe(yo), moneda)} confirmados.`}
        </p>
        <FormMonto cuota={cuota} falta={falta} moneda={moneda} accion="Avisar"
          pendiente={pendiente} onEnviar={onAvisar} onCancelar={onCerrar} />
      </div>
    )
  }
  if (yo.aviso) {
    return (
      <div className="mb-3 rounded-xl py-2.5 px-3" style={{ background: 'rgba(232,183,90,.14)' }}>
        <p className="text-center font-['Archivo'] font-bold text-[12px]" style={{ color: 'var(--league-gold)' }}>
          {abonos
            ? `Avisaste ${plata(montoDelAviso(yo, cuota), moneda)} · falta que lo confirme un admin`
            : 'Avisaste que pagaste · falta que lo confirmen'}
        </p>
        <div className="flex justify-center gap-4 mt-1.5">
          {abonos && (
            <button onClick={onAbrir} disabled={pendiente} className="text-[11px] font-bold text-accent disabled:opacity-50">
              Cambiar monto
            </button>
          )}
          <button onClick={onRetirar} disabled={pendiente} className="text-[11px] font-bold text-[var(--text-muted,#8A8A8A)] disabled:opacity-50">
            Retirar aviso
          </button>
        </div>
      </div>
    )
  }
  return (
    <button onClick={() => (abonos ? onAbrir() : onAvisar(null))} disabled={pendiente}
      className="w-full mb-3 rounded-xl py-2.5 font-['Archivo'] font-bold text-[12px] disabled:opacity-50"
      style={{ background: 'rgba(46,211,183,.12)', color: 'var(--league-green)' }}>
      {pendiente ? '…' : estado === 'parcial'
        ? `Avisar otro pago · te falta ${plata(falta, moneda)}`
        : abonos ? 'Avisar un pago' : 'Ya pagué'}
    </button>
  )
}

/* Elegir un monto: lo que falta, la mitad, u otro escrito a mano. */
function FormMonto({ cuota, falta, moneda, accion, pendiente, onEnviar, onCancelar }) {
  const opciones = opcionesDeMonto({ cuota, falta })
  const [elegido, setElegido] = useState(opciones[0]?.clave || 'otro')
  const [otro, setOtro] = useState('')
  const [error, setError] = useState(null)

  const enviar = () => {
    if (elegido !== 'otro') {
      const o = opciones.find((x) => x.clave === elegido)
      if (o) { onEnviar(o.monto); return }
    }
    const v = validarMonto(otro, falta, moneda)
    if (v.error) { setError(v.error); return }
    setError(null)
    onEnviar(v.monto)
  }

  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-2" role="radiogroup" aria-label="Monto">
        {opciones.map((o) => (
          <Chip key={o.clave} activo={elegido === o.clave} onClick={() => { setElegido(o.clave); setError(null) }}>
            {o.etiqueta} · {plata(o.monto, moneda)}
          </Chip>
        ))}
        <Chip activo={elegido === 'otro'} onClick={() => setElegido('otro')}>Otro monto</Chip>
      </div>
      {elegido === 'otro' && (
        <input type="number" inputMode="decimal" min="0" step="any" value={otro} autoFocus
          onChange={(e) => { setOtro(e.target.value); setError(null) }}
          placeholder={`Hasta ${plata(falta, moneda)}`} aria-label="Monto"
          className="w-full mb-2 bg-slate-100 dark:bg-[#0C0C0C] border border-slate-200 dark:border-[#262626] rounded-xl px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-accent" />
      )}
      {error && <p role="alert" className="text-[11px] text-rose-500 mb-2">{error}</p>}
      <div className="flex gap-2">
        <button onClick={onCancelar}
          className="flex-1 rounded-xl py-2 font-['Archivo'] font-bold text-[12px] bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-300">
          Cancelar
        </button>
        <button onClick={enviar} disabled={pendiente}
          className="flex-1 rounded-xl py-2 font-['Archivo'] font-bold text-[12px] text-[#06231d] bg-accent disabled:opacity-50 flex items-center justify-center gap-1.5">
          {pendiente ? <Loader2 size={13} className="animate-spin" /> : null} {accion}
        </button>
      </div>
    </div>
  )
}

function Chip({ activo, onClick, children }) {
  return (
    <button type="button" role="radio" aria-checked={activo} onClick={onClick}
      className={`text-[11px] font-bold px-2.5 py-1.5 rounded-lg border ${activo
        ? 'border-accent bg-accent/10 text-accent'
        : 'border-slate-200 dark:border-[#262626] text-slate-600 dark:text-slate-300'}`}>
      {children}
    </button>
  )
}

function Fila({ g, cuota, moneda, children }) {
  const detalle = detalleDe(g, cuota, moneda)
  return (
    <div className="pozo-person" data-persona={g.display_name}>
      <div className={`pozo-avatar ${g.soy_yo ? 'pozo-avatar-me' : ''}`}>
        {g.avatar_url ? <img src={g.avatar_url} alt="" className="w-full h-full object-cover" /> : (g.display_name?.[0] || '?').toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <p className="pozo-person-name">
          {g.display_name}{g.soy_yo && <span className="league-ink font-bold"> (vos)</span>}
        </p>
        {detalle && <p className="font-['JetBrains_Mono'] text-[9.5px] text-[var(--text-muted,#8A8A8A)] truncate">{detalle}</p>}
      </div>
      <Estado g={g} moneda={moneda} />
      {children}
    </div>
  )
}

/* El botón de cada fila para un admin: el paso obvio a un toque, y el resto
   en el panel de «gestionar». */
function AccionAdmin({ g, cuota, moneda, abonos, pendiente, onConfirmarAviso, onConfirmarCompleto, onGestionar, onQuitar }) {
  const estado = estadoDe(g)
  const estilo = (activo) => (activo
    ? { color: 'var(--league-green)', background: 'rgba(46,211,183,.12)' }
    : { color: 'var(--text-muted,#8A8A8A)', background: 'rgba(127,127,127,.12)' })
  const clase = 'shrink-0 text-[10px] font-bold px-2 py-1 rounded-lg disabled:opacity-50'

  if (!abonos) {
    // Servidor de antes: confirmar la cuota entera o quitar, como siempre.
    return estado === 'pagado'
      ? <button onClick={onQuitar} disabled={pendiente} className={clase} style={estilo(false)}>quitar</button>
      : <button onClick={onConfirmarCompleto} disabled={pendiente} className={clase} style={estilo(true)}>confirmar</button>
  }
  if (estado === 'pagado') {
    return <button onClick={onQuitar} disabled={pendiente} className={clase} style={estilo(false)} title="Marcar como pendiente">quitar</button>
  }
  if (g.aviso) {
    return (
      <div className="flex items-center gap-1">
        <button onClick={onConfirmarAviso} disabled={pendiente} className={clase} style={estilo(true)}
          title={`Confirmar lo que avisó: ${plata(montoDelAviso(g, cuota), moneda)}`}>
          confirmar {plata(montoDelAviso(g, cuota), moneda)}
        </button>
        <button onClick={onGestionar} disabled={pendiente} className={clase} style={estilo(false)}>gestionar</button>
      </div>
    )
  }
  return <button onClick={onGestionar} disabled={pendiente} className={clase} style={estilo(true)}>registrar</button>
}

/* La disponibilidad ya se comprobó con id; las filas del historial se cargan
   recién al abrirlo. Solo la 110 permite seleccionar también monto_total. */
function HistorialPagos({ leagueId, gente, abonos }) {
  const [abierto, setAbierto] = useState(false)
  return (
    <details className="mt-3" onToggle={(e) => setAbierto(e.currentTarget.open)}>
      <summary className="cursor-pointer flex items-center gap-1.5 font-['JetBrains_Mono'] text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted,#8A8A8A)]">
        <History size={11} /> Historial de pagos
      </summary>
      {abierto && <ListaHistorial leagueId={leagueId} gente={gente} abonos={abonos} />}
    </details>
  )
}

function ListaHistorial({ leagueId, gente, abonos }) {
  const { data: filas = [], isLoading, isError, refetch } = useConsultaDelUsuario({
    queryKey: ['historial_pagos', leagueId, abonos],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('historial_pagos')
        .select(`id, user_id, accion, monto, moneda, por, created_at, sembrada${abonos ? ', monto_total' : ''}`)
        .eq('league_id', leagueId)
        .order('created_at', { ascending: false })
        .limit(50)
      if (error) throw error
      return data || []
    },
  })
  if (isLoading) return <p role="status" className="text-[11px] mt-2">Cargando historial…</p>
  if (isError) return <div className="mt-2"><ErrorState compact title="No pudimos cargar el historial de pagos"
    description="Revisá tu conexión y reintentá." onRetry={refetch} /></div>
  if (!filas.length) return <p className="text-[11px] text-[var(--text-muted,#8A8A8A)] mt-2">Todavía no hay movimientos.</p>
  const nombres = Object.fromEntries((gente || []).map((g) => [g.user_id, g.display_name]))
  return (
    <ul className="mt-2 space-y-1.5" aria-label="Movimientos de pagos">
      {filas.map((f) => {
        const m = describirMovimiento(f, nombres)
        return (
          <li key={f.id} className="text-[11px] text-slate-700 dark:text-slate-300">
            <span>{m.texto}</span>
            {m.monto && <span className="font-['JetBrains_Mono'] font-bold"> · {m.monto}</span>}
            <span className="block font-['JetBrains_Mono'] text-[9.5px] text-[var(--text-muted,#8A8A8A)]">
              {m.cuando}{m.nota && ` · ${m.nota}`}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

function Estado({ g, moneda }) {
  const e = etiquetaDe(g, moneda)
  const estilos = {
    pagado: { color: 'var(--league-green)', background: 'rgba(46,211,183,.14)' },
    parcial: { color: 'var(--league-gold)', background: 'rgba(232,183,90,.14)' },
    aviso: { color: 'var(--league-gold)', background: 'rgba(232,183,90,.14)' },
  }
  return (
    <span className={`shrink-0 flex items-center gap-1 font-['JetBrains_Mono'] ${e.tipo === 'pendiente' ? '' : 'font-bold'} text-[9px] px-1.5 py-0.5 rounded-[20px] ${e.tipo === 'pendiente' ? 'text-[var(--text-muted,#8A8A8A)]' : ''}`}
      style={estilos[e.tipo] || { background: 'rgba(127,127,127,.10)' }}>
      {e.tipo === 'pagado' && <Check size={9} />}
      {e.tipo === 'aviso' && <Clock size={9} />}
      {e.texto}
    </span>
  )
}

function Dato({ etiqueta, valor }) {
  return (
    <div className="pozo-target">
      <span>{etiqueta}</span>
      <strong>{valor}</strong>
    </div>
  )
}

function Premios({ reparto, moneda }) {
  if (!reparto.filas.length) return null
  const montos = reparto.modo === 'montos'
  return (
    <div className="pozo-prizes"
      data-reparto={reparto.modo}>
      <h4>
        {montos ? 'Premios' : 'Reparto estimado'}
      </h4>
      {reparto.filas.map((x) => (
        <div key={x.puesto} className="pozo-prize-row" data-puesto={x.puesto}>
          <span className="pozo-place">{ordinal(x.puesto)}</span>
          <span className="pozo-prize-label">{x.puesto === 1 ? 'Primer puesto' : `Puesto ${x.puesto}`}
            {x.porcentaje != null && <small>{x.porcentaje}% del pozo</small>}
          </span>
          <span className="pozo-prize-amount">
            {plata(x.monto, moneda)}
          </span>
        </div>
      ))}
      <p className="text-[9.5px] text-[var(--text-muted,#8A8A8A)] mt-1">
        {montos
          ? 'Montos acordados por el grupo.'
          : 'Calculado sobre el pozo completo, asumiendo que pagan todos.'}
      </p>
      {reparto.excede && (
        <p className="flex items-start gap-1 text-[10.5px] text-amber-600 dark:text-amber-400 mt-1">
          <AlertTriangle size={12} className="mt-px shrink-0" />
          Los premios suman {plata(reparto.suma, moneda)} y el pozo completo es {plata(reparto.total, moneda)}.
        </p>
      )}
    </div>
  )
}

function Config({ leagueId, inicial, onListo, onCancelar }) {
  const [cuota, setCuota] = useState(inicial.cuota || '')
  const [moneda, setMoneda] = useState(inicial.moneda || 'CRC')
  const guardado = Array.isArray(inicial.reparto) ? inicial.reparto : []
  // Sin nada guardado arranca en montos: es lo que el grupo acuerda de antemano.
  const [modo, setModo] = useState(
    guardado.length && !guardado.some((x) => x?.monto != null) ? 'porcentajes' : 'montos',
  )
  const [valores, setValores] = useState(() => {
    const v = [...guardado].sort((a, b) => Number(a.puesto) - Number(b.puesto))
      .map((x) => String(x?.monto ?? x?.porcentaje ?? ''))
    return v.length ? v : ['', '', '']
  })
  const [error, setError] = useState(null)
  const [borradores, setBorradores] = useState({})
  const total = Number(inicial.total || 0)

  const listo = repartoParaGuardar(valores, modo)
  const guardar = useMutation({
    mutationFn: async () => {
      if (listo.error) throw new Error(listo.error)
      const { error } = await supabase.rpc('set_league_pozo', {
        p_league_id: leagueId,
        p_cuota: Number(cuota) || 0,
        p_moneda: moneda,
        p_reparto: listo.reparto,
      })
      if (error) throw error
    },
    onSuccess: onListo,
    onError: (e) => setError(e.message),
  })

  const cambiarModo = (nuevo) => {
    if (nuevo === modo) return
    setBorradores({ ...borradores, [modo]: valores })
    setValores(borradores[nuevo] ?? convertirReparto(valores, nuevo, total))
    setModo(nuevo)
    setError(null)
  }
  const sumaMontos = modo === 'montos' && listo.reparto ? listo.reparto.reduce((s, x) => s + x.monto, 0) : 0
  const sumaPorc = valores.reduce((s, v) => s + (Number(v) || 0), 0)

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
        <p className="block text-[10px] font-bold text-[var(--text-muted,#8A8A8A)] uppercase mb-1">Premios</p>
        <div role="radiogroup" aria-label="Cómo se reparte" className="flex gap-1.5 mb-2">
          {[['montos', 'Montos fijos'], ['porcentajes', 'Porcentajes']].map(([clave, texto]) => (
            <button key={clave} type="button" role="radio" aria-checked={modo === clave} onClick={() => cambiarModo(clave)}
              className={`flex-1 rounded-lg py-1.5 font-['Archivo'] font-bold text-[11px] border ${modo === clave
                ? 'bg-accent/15 border-accent text-accent'
                : 'bg-slate-100 dark:bg-white/5 border-transparent text-slate-600 dark:text-slate-300'}`}>
              {texto}
            </button>
          ))}
        </div>
        {valores.map((v, i) => (
          <div key={i} className="flex items-center gap-2 mb-1.5">
            <span className="w-10 text-[12px] text-slate-600 dark:text-slate-300">{ordinal(i + 1)}</span>
            {modo === 'montos' && <span className="text-[12px] text-[var(--text-muted,#8A8A8A)]">{moneda === 'USD' ? '$' : '₡'}</span>}
            <input type="number" inputMode="decimal" min="0" step="any" value={v}
              aria-label={`${modo === 'montos' ? 'Monto' : 'Porcentaje'} del ${ordinal(i + 1)} puesto`}
              onChange={(e) => setValores(valores.map((x, j) => j === i ? e.target.value : x))}
              className="flex-1 bg-slate-100 dark:bg-[#0C0C0C] border border-slate-200 dark:border-[#262626] rounded-lg px-2 py-1.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-accent" />
            {modo === 'porcentajes' && <span className="text-[12px] text-[var(--text-muted,#8A8A8A)]">%</span>}
            <button type="button" onClick={() => setValores(valores.filter((_, j) => j !== i))}
              className="text-rose-500 p-1" aria-label={`Quitar el ${ordinal(i + 1)} puesto`}><X size={13} /></button>
          </div>
        ))}
        <button type="button" onClick={() => setValores([...valores, ''])}
          className="text-[11px] font-bold text-accent">+ agregar puesto</button>
        <p className="text-[10.5px] text-[var(--text-muted,#8A8A8A)] mt-1">
          {modo === 'montos'
            ? `Suman ${plata(sumaMontos, moneda)}${total > 0 ? ` · el pozo completo es ${plata(total, moneda)}` : ''}.`
            : `Suman ${Math.round(sumaPorc * 10) / 10}% del pozo completo.`}
        </p>
        {modo === 'montos' && total > 0 && sumaMontos > total && (
          <p className="text-[10.5px] text-amber-600 dark:text-amber-400 mt-0.5">
            Los premios pasan el pozo completo: revisá que sea lo acordado.
          </p>
        )}
        {listo.error && <p role="alert" className="text-[10.5px] text-rose-500 mt-1">{listo.error}</p>}
      </div>

      {error && <p className="text-[11px] text-rose-500">{error}</p>}

      <div className="flex gap-2">
        <button onClick={onCancelar}
          className="flex-1 rounded-xl py-2 font-['Archivo'] font-bold text-[12px] bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-300">
          Cancelar
        </button>
        <button onClick={() => guardar.mutate()} disabled={guardar.isPending || !!listo.error}
          className="flex-1 rounded-xl py-2 font-['Archivo'] font-bold text-[12px] text-[#06231d] bg-accent disabled:opacity-50 flex items-center justify-center gap-1.5">
          {guardar.isPending ? <Loader2 size={13} className="animate-spin" /> : null} Guardar
        </button>
      </div>
    </div>
  )
}
