/* Alineaciones, estadísticas, forma reciente e historial.

   PENSADO PARA QUE SIRVA ANTES DEL PARTIDO, que es cuando ayuda a predecir:
     · Desde siempre  -> forma reciente de los dos equipos e historial entre
                         ambos. Es lo único que hay hasta una hora antes.
     · ~1 h antes     -> la alineación con su formación. Medido: a 87 y a 73
                         minutos del saque ESPN todavía no la publica. Como las
                         predicciones cierran 15 min antes, quedan unos 45
                         minutos para ver el once y corregir.
     · En curso       -> estadísticas (posesión, tiros, tarjetas…).

   NO HAY CUOTAS DE APUESTAS (decisión del dueño) ni «noticias»: las que da
   ESPN son de la LIGA, no del partido, y mostrarlas acá sería mentir.

   La sección que no tiene datos NO SE DIBUJA. Una tarjeta vacía con un
   «—» hace pensar que la app está rota; que falte, no. */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'motion/react'
import { Users, BarChart3, History, TrendingUp, Loader2, ChevronDown } from 'lucide-react'
import { fetchDetalleDelPartido, frescuraDe } from '../../lib/detalleDelPartido'

const RESULTADO = {
  G: { texto: 'G', color: '#2ED3B7', fondo: 'rgba(46,211,183,.14)' },
  E: { texto: 'E', color: '#E8B75A', fondo: 'rgba(232,183,90,.16)' },
  P: { texto: 'P', color: '#FF7A59', fondo: 'rgba(255,122,89,.14)' },
}

function Titulo ({ icono: Icono, children, extra }) {
  return (
    <div className="flex items-center justify-between gap-2 mb-2.5">
      <div className="flex items-center gap-1.5">
        <Icono size={13} className="text-accent" />
        <h3 className="font-bold font-['Archivo'] text-[12.5px] text-slate-900 dark:text-[#F3F1EA]">
          {children}
        </h3>
      </div>
      {extra}
    </div>
  )
}

const Tarjeta = ({ children }) => (
  <div className="rounded-2xl bg-white dark:bg-[#161616] border border-slate-200 dark:border-[#262626] p-4">
    {children}
  </div>
)

/* Barra comparativa: el ancho ES el dato, así que se lee de un vistazo sin
   tener que comparar dos números pequeños. */
function Comparativa ({ etiqueta, local, visita }) {
  const a = parseFloat(String(local).replace('%', '')) || 0
  const b = parseFloat(String(visita).replace('%', '')) || 0
  const total = a + b
  /* Con los dos en cero NO se dibuja un 50/50: una barra partida por la mitad
     se lee como «empatados en algo», y lo que pasa es que todavía no hay nada
     que medir. Queda gris entera. */
  const sinDatos = total === 0
  const pct = sinDatos ? 0 : (a / total) * 100
  return (
    <div className="mb-2.5 last:mb-0">
      <div className="flex items-center justify-between font-['JetBrains_Mono'] text-[11px] tabular-nums text-slate-900 dark:text-[#F3F1EA]">
        <span className="font-bold">{local}</span>
        <span className="font-['Archivo'] text-[10.5px] text-slate-600 dark:text-slate-300">{etiqueta}</span>
        <span className="font-bold">{visita}</span>
      </div>
      <div className="mt-1 h-1.5 rounded-full overflow-hidden flex bg-slate-200 dark:bg-[#0C0C0C]"
        role="presentation">
        {!sinDatos && (
          <>
            <div style={{ width: `${pct}%`, background: '#2ED3B7' }} />
            <div style={{ width: `${100 - pct}%`, background: '#8A8A8A' }} />
          </>
        )}
      </div>
    </div>
  )
}

function Once ({ equipo }) {
  const [verSuplentes, setVerSuplentes] = useState(false)
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 mb-2">
        <span className="font-bold font-['Archivo'] text-[12px] text-slate-900 dark:text-[#F3F1EA] truncate">
          {equipo.equipo}
        </span>
        {equipo.formacion && (
          <span className="shrink-0 rounded-md px-1.5 py-0.5 font-['JetBrains_Mono'] text-[10px] font-bold"
            style={{ background: 'rgba(46,211,183,.12)', color: '#2ED3B7' }}>
            {equipo.formacion}
          </span>
        )}
      </div>

      <ul className="space-y-1">
        {equipo.titulares.map((j) => (
          <li key={`${j.dorsal}-${j.nombre}`} className="flex items-center gap-2 min-w-0">
            <span className="w-5 shrink-0 text-right font-['JetBrains_Mono'] text-[10.5px] tabular-nums text-slate-500 dark:text-slate-400">
              {j.dorsal}
            </span>
            <span className="flex-1 min-w-0 truncate font-['Archivo'] text-[11.5px] text-slate-800 dark:text-[#F3F1EA]">
              {j.nombre}
            </span>
            {j.salio && <span title="Salió" className="shrink-0 text-[10px] text-[#FF7A59]">↓</span>}
          </li>
        ))}
      </ul>

      {equipo.suplentes?.length > 0 && (
        <>
          <button type="button" onClick={() => setVerSuplentes((v) => !v)}
            aria-expanded={verSuplentes}
            className="mt-2 flex items-center gap-1 text-[10.5px] text-slate-600 dark:text-slate-300">
            <ChevronDown size={11} className={verSuplentes ? 'rotate-180 transition-transform' : 'transition-transform'} />
            Suplentes ({equipo.suplentes.length})
          </button>
          {verSuplentes && (
            <ul className="mt-1.5 space-y-1">
              {equipo.suplentes.map((j) => (
                <li key={`${j.dorsal}-${j.nombre}`} className="flex items-center gap-2 min-w-0">
                  <span className="w-5 shrink-0 text-right font-['JetBrains_Mono'] text-[10.5px] tabular-nums text-slate-500 dark:text-slate-400">
                    {j.dorsal}
                  </span>
                  <span className="flex-1 min-w-0 truncate font-['Archivo'] text-[11.5px] text-slate-600 dark:text-slate-300">
                    {j.nombre}
                  </span>
                  {j.entro && <span title="Entró" className="shrink-0 text-[10px] text-accent">↑</span>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}

export default function DetalleDelPartido ({ matchId, status }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['detalle_partido', matchId],
    queryFn: () => fetchDetalleDelPartido(matchId),
    enabled: !!matchId,
    staleTime: frescuraDe(status),
    retry: 1,
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-6 text-[12px] text-slate-600 dark:text-slate-300">
        <Loader2 size={14} className="animate-spin" /> Buscando datos del partido…
      </div>
    )
  }

  /* El error se MUESTRA. Si se ocultara, un fallo de permisos o de red se
     vería igual que «este partido no tiene datos». */
  if (error) {
    return <p className="text-[11.5px] text-[#FF7A59] py-3">{error.message}</p>
  }

  if (!data?.disponible) {
    return data?.motivo
      ? <p className="text-[11.5px] text-slate-600 dark:text-slate-300 py-3">{data.motivo}</p>
      : null
  }

  const d = data.detalle || {}
  const stats = d.estadisticas
  const local = stats?.find((e) => e.esLocal)
  const visita = stats?.find((e) => !e.esLocal)

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-3 mt-4">
      {data.viejo && (
        <p className="text-[10.5px] text-[var(--text-muted,#8A8A8A)]">
          ESPN no respondió; estos datos son los últimos que se pudieron traer.
        </p>
      )}

      {d.alineaciones && (
        <Tarjeta>
          <Titulo icono={Users}>Alineaciones</Titulo>
          <div className="grid grid-cols-2 gap-4">
            {d.alineaciones.map((eq) => <Once key={eq.equipo} equipo={eq} />)}
          </div>
        </Tarjeta>
      )}

      {local && visita && (
        <Tarjeta>
          <Titulo icono={BarChart3}>Estadísticas</Titulo>
          {local.valores.map((v, i) => (
            <Comparativa key={v.etiqueta} etiqueta={v.etiqueta}
              local={v.valor} visita={visita.valores[i]?.valor ?? '0'} />
          ))}
        </Tarjeta>
      )}

      {d.forma && (
        <Tarjeta>
          <Titulo icono={TrendingUp}
            extra={<span className="text-[10px] text-[var(--text-muted,#8A8A8A)]">últimos 5</span>}>
            Cómo vienen
          </Titulo>
          <div className="space-y-2.5">
            {d.forma.map((eq) => (
              <div key={eq.equipo}>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="font-['Archivo'] text-[11.5px] text-slate-800 dark:text-[#F3F1EA] truncate">
                    {eq.equipo}
                  </span>
                  <div className="flex gap-1 shrink-0">
                    {eq.partidos.map((p, i) => {
                      const r = RESULTADO[p.resultado] || { texto: '·', color: '#8A8A8A', fondo: 'rgba(138,138,138,.14)' }
                      return (
                        <span key={i} title={`${p.fecha} · ${p.rival ?? ''} ${p.marcador ?? ''}`}
                          className="w-5 h-5 rounded-md grid place-items-center font-['JetBrains_Mono'] font-bold text-[10px]"
                          style={{ background: r.fondo, color: r.color }}>
                          {r.texto}
                        </span>
                      )
                    })}
                  </div>
                </div>
                <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                  {eq.partidos.map((p, i) => (
                    <span key={i} className="font-['JetBrains_Mono'] text-[9.5px] text-[var(--text-muted,#8A8A8A)]">
                      {p.rival} {p.marcador}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Tarjeta>
      )}

      {d.historial && (
        <Tarjeta>
          <Titulo icono={History}>Entre ellos</Titulo>
          {d.historial.resumen && (
            <p className="text-[11.5px] text-slate-800 dark:text-[#F3F1EA] mb-1.5">{d.historial.resumen}</p>
          )}
          <ul className="space-y-0.5">
            {d.historial.partidos.map((p, i) => (
              <li key={i} className="font-['JetBrains_Mono'] text-[10.5px] text-[var(--text-muted,#8A8A8A)]">
                {p.fecha} · {p.detalle}
              </li>
            ))}
          </ul>
        </Tarjeta>
      )}
    </motion.div>
  )
}
