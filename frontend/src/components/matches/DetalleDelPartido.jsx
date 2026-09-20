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
import CanchaAlineacion from './CanchaAlineacion'

/* El COLOR va por tema (variables de index.css) y el fondo no.
   El acento de la app sobre su propio fondo al 14% da 1.7:1 en el tema claro:
   la G quedaba casi invisible sobre la tarjeta blanca, y el resumen «4G · 1P»
   sobre blanco puro, peor todavía (1.9:1). Es exactamente el fallo que este
   repo ya tenía anotado para el botón del aviso de notificaciones. */
const RESULTADO = {
  G: { texto: 'G', color: 'var(--forma-g)', fondo: 'rgba(46,211,183,.14)' },
  E: { texto: 'E', color: 'var(--forma-e)', fondo: 'rgba(232,183,90,.16)' },
  P: { texto: 'P', color: 'var(--forma-p)', fondo: 'rgba(255,122,89,.16)' },
}
const SIN_DATO = { texto: '·', color: 'var(--forma-nd)', fondo: 'rgba(120,113,108,.14)' }

// Para quien no ve el color: una G verde y una P naranja son el mismo carácter
// para un lector de pantalla si no se dice qué significan.
const LEIDO = { G: 'Ganó', E: 'Empató', P: 'Perdió' }
const LISTA_RACHA = ['G', 'E', 'P']
const PLURAL = {
  G: (n) => (n === 1 ? 'ganado' : 'ganados'),
  E: (n) => (n === 1 ? 'empatado' : 'empatados'),
  P: (n) => (n === 1 ? 'perdido' : 'perdidos'),
}

/* CÓMO VIENEN: el resultado, el marcador y el rival EN LA MISMA COLUMNA.

   Antes iban en dos filas separadas —las cinco letras a la derecha del nombre,
   los cinco marcadores en una línea suelta debajo— así que para saber contra
   quién fue la P había que contar posiciones en dos sitios y esperar que
   coincidieran. El dueño lo reportó como «es confusa».

   Y encima el marcador salía al revés en las derrotas: el `score` de ESPN es
   del GANADOR, no del equipo (ver `_forma` en el backend). Acá los goles ya
   vienen orientados y el propio va PRIMERO siempre, que es la única forma de
   que «1-2» debajo de una P se lea sin pensar.

   Se dice también de local o de visita: en esta liga no es un detalle. */
function FormaDeEquipo ({ equipo }) {
  const cuenta = { G: 0, E: 0, P: 0 }
  for (const p of equipo.partidos) if (cuenta[p.resultado] !== undefined) cuenta[p.resultado]++

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 mb-1.5">
        <span className="font-['Archivo'] text-[11.5px] text-slate-800 dark:text-[#F3F1EA] truncate">
          {equipo.equipo}
        </span>
        {/* «4G · 1P» es legible de un vistazo y opaco para un lector de
            pantalla, que leería «cuatro ge». El resumen va en el aria-label y
            lo visible queda oculto para la asistencia. */}
        <span className="font-['JetBrains_Mono'] text-[10px] shrink-0 whitespace-nowrap"
          aria-label={`${equipo.equipo} en estos 5: ${LISTA_RACHA.map((k) => `${cuenta[k]} ${PLURAL[k](cuenta[k])}`).join(', ')}`}>
          <span aria-hidden="true">
            {LISTA_RACHA.filter((k) => cuenta[k]).map((k, i) => (
              <span key={k}>
                {i > 0 && <span className="text-[var(--text-muted,#8A8A8A)]"> · </span>}
                <span style={{ color: RESULTADO[k].color }}>{cuenta[k]}{k}</span>
              </span>
            ))}
          </span>
        </span>
      </div>

      <div className="grid grid-cols-5 gap-1">
        {equipo.partidos.map((p, i) => {
          const r = RESULTADO[p.resultado] || SIN_DATO
          /* Sin goles orientados no se inventa un marcador: puede ser una
             respuesta vieja de la caché (el campo es nuevo) o un evento sin
             `atVs`. Se dibuja el resultado y el rival, que sí son ciertos. */
          const hayMarcador = p.goles != null && p.goles_rival != null
          const donde = p.de_local == null ? '' : (p.de_local ? 'vs' : '@')
          const comoLeerlo = [
            LEIDO[p.resultado] || 'Sin dato',
            hayMarcador ? `${p.goles} a ${p.goles_rival}` : null,
            p.de_local == null ? null : (p.de_local ? 'de local' : 'de visita'),
            `contra ${p.rival_nombre || p.rival || 'rival desconocido'}`,
            p.fecha || null,
          ].filter(Boolean).join(' ')

          return (
            <div key={i} className="text-center" title={comoLeerlo} aria-label={comoLeerlo}>
              <div className="h-[22px] rounded-md grid place-items-center font-['JetBrains_Mono'] font-bold text-[11px]"
                style={{ background: r.fondo, color: r.color }}>
                {r.texto}
              </div>
              <div className="mt-0.5 font-['JetBrains_Mono'] text-[11px] text-slate-800 dark:text-[#F3F1EA]">
                {hayMarcador ? `${p.goles}-${p.goles_rival}` : '–'}
              </div>
              <div className="font-['JetBrains_Mono'] text-[9.5px] text-[var(--text-muted,#8A8A8A)] truncate">
                {donde} {p.rival}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
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

/* Pestañas por equipo. Dos canchas lado a lado en un celular dejan fichas de
   30 px con el nombre ilegible; una a la vez se lee y además hace más obvio de
   quién es la formación que estás mirando. */
function Alineaciones ({ equipos }) {
  const [activo, setActivo] = useState(0)
  const eq = equipos[activo] || equipos[0]
  return (
    <Tarjeta>
      <Titulo icono={Users}>Alineaciones</Titulo>

      <div role="tablist" aria-label="Equipo" className="flex gap-1.5 mb-3">
        {equipos.map((e, i) => (
          <button key={e.equipo} role="tab" type="button"
            aria-selected={i === activo}
            onClick={() => setActivo(i)}
            className={`flex-1 min-w-0 rounded-lg px-2 py-1.5 font-['Archivo'] text-[11.5px] font-bold truncate transition-colors ${
              i === activo
                ? 'bg-accent/10 text-teal-700 dark:text-accent'
                : 'bg-slate-100 dark:bg-[#0C0C0C] text-slate-600 dark:text-slate-300'
            }`}>
            {e.equipo}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between mb-2">
        <span className="font-['Archivo'] text-[11px] text-slate-600 dark:text-slate-300">
          {eq.esLocal ? 'Local' : 'Visitante'}
        </span>
        {eq.formacion && (
          <span className="rounded-md px-1.5 py-0.5 font-['JetBrains_Mono'] text-[10px] font-bold bg-accent/10 text-teal-700 dark:text-accent">
            {eq.formacion}
          </span>
        )}
      </div>

      <CanchaAlineacion equipo={eq} />
      <Suplentes equipo={eq} />
    </Tarjeta>
  )
}

function Suplentes ({ equipo }) {
  const [abierto, setAbierto] = useState(false)
  if (!equipo.suplentes?.length) return null
  return (
    <>
      <button type="button" onClick={() => setAbierto((v) => !v)} aria-expanded={abierto}
        className="mt-3 flex items-center gap-1 text-[11px] text-slate-600 dark:text-slate-300">
        <ChevronDown size={12} className={abierto ? 'rotate-180 transition-transform' : 'transition-transform'} />
        Suplentes ({equipo.suplentes.length})
      </button>
      {abierto && (
        <ul className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1">
          {equipo.suplentes.map((j) => (
            <li key={`${j.dorsal}-${j.nombre}`} className="flex items-center gap-2 min-w-0">
              <span className="w-5 shrink-0 text-right font-['JetBrains_Mono'] text-[10.5px] tabular-nums text-slate-500 dark:text-slate-400">
                {j.dorsal}
              </span>
              <span className="flex-1 min-w-0 truncate font-['Archivo'] text-[11px] text-slate-600 dark:text-slate-300">
                {j.nombre}
              </span>
              {j.entro && <span title="Entró" className="shrink-0 text-[10px] text-accent">↑</span>}
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

/* Cuando todavía no hay once, se DICE por qué y cuándo. Una tarjeta ausente se
   lee como «esta app no tiene alineaciones»; el dato es que aún no salieron.

   Y NO TODAS LAS LIGAS LO PUBLICAN A LA MISMA HORA, así que no se puede decir
   con la misma frase. En Champions o LaLiga el once sale alrededor de una hora
   antes, a tiempo para corregir la predicción. En la liga tica la fuente lo
   publica AL ARRANCAR el partido (medido: a 25 minutos del saque venía vacío y
   a un minuto de empezado estaban los 22), así que ahí decir «en cuanto salgan
   aparecen acá» deja a alguien recargando la pantalla hasta el saque para algo
   que no va a llegar a tiempo. El backend manda `alineaciones_cuando`; si no
   viene —liga desconocida, o una respuesta guardada de antes— se dice lo de
   siempre. */
function SinAlineacion ({ status, cuando }) {
  const alSaque = cuando === 'al-saque'
  if (['finished', 'cancelled', 'postponed'].includes(status)) return null
  return (
    <Tarjeta>
      <Titulo icono={Users}>Alineaciones</Titulo>
      <p className="text-[11.5px] text-slate-600 dark:text-slate-300">
        {alSaque
          ? 'En este torneo las alineaciones se publican al arrancar el partido, no antes: aparecen acá con el pitazo inicial.'
          : 'Todavía no se publicaron. Los equipos suelen anunciarse alrededor de una hora antes del saque; en cuanto salgan aparecen acá.'}
      </p>
    </Tarjeta>
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

      {d.alineaciones
        ? <Alineaciones equipos={d.alineaciones} />
        : <SinAlineacion status={status} cuando={d.alineaciones_cuando} />}

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
          <div className="space-y-3">
            {d.forma.map((eq) => <FormaDeEquipo key={eq.equipo} equipo={eq} />)}
          </div>
          {/* El orden hay que DECIRLO. «Últimos 5» no dice por qué punta
              empieza, y con la racha de un equipo eso cambia la lectura
              entera: G G P G G se lee distinto si la P fue anteayer o hace
              cinco fechas. */}
          {/* A la IZQUIERDA: el botón flotante del chat vive pegado abajo a la
              derecha y tapaba justo esta línea (se vio en la captura). */}
          <p className="mt-2.5 text-[9.5px] text-[var(--text-muted,#8A8A8A)]">
            ← más viejo · más reciente →
          </p>
        </Tarjeta>
      )}

      {/* Sin historial la tarjeta DESAPARECÍA, y una tarjeta que falta se lee
          como «esta app perdió el historial» — el mismo malentendido que ya se
          resolvió con las alineaciones. El dato real es que no hay
          enfrentamientos previos: ESPN no manda `seasonseries` para un cruce
          que nunca ocurrió (comprobado el 10 sep 2026 con Fenerbahçe–Roma,
          donde la sección viene ausente del JSON, no vacía).

          Se dice «no hay registrados» y no «nunca se enfrentaron» a propósito:
          desde acá no se distingue un cruce inédito de un hueco de la fuente,
          y afirmar lo segundo sería inventar. */}
      {!d.historial && (
        <Tarjeta>
          <Titulo icono={History}>Entre ellos</Titulo>
          <p className="text-[11.5px] text-slate-600 dark:text-slate-300">
            No hay enfrentamientos previos registrados entre estos dos equipos.
          </p>
        </Tarjeta>
      )}

      {d.historial && (
        <Tarjeta>
          <Titulo icono={History}>Entre ellos</Titulo>
          {/* ESTO SALÍA EN INGLÉS: «CAR leads series 4-0-1», tal cual lo manda
              ESPN, desde que se quitó `lang=es` de la petición. `_forma` ya
              traducía `gameResult` por ese mismo motivo; a este campo nadie lo
              miró. Ahora el balance lo cuenta el backend sobre los partidos
              que se muestran acá abajo, así que además no puede contradecir a
              la lista. Una respuesta vieja de la caché no trae `balance` y se
              queda sin la línea — mejor que volver a enseñar la inglesa. */}
          {d.historial.balance && (
            <p className="text-[11.5px] text-slate-800 dark:text-[#F3F1EA] mb-1.5">
              De estos {d.historial.balance.de}:{' '}
              {d.historial.balance.equipos.map((e) => `${e.equipo} ${e.ganados}`).join(' · ')}
              {d.historial.balance.empates > 0 && ` · empates ${d.historial.balance.empates}`}
            </p>
          )}
          <ul className="space-y-1">
            {d.historial.partidos.map((p, i) => (
              <li key={i} className="flex items-center gap-2 font-['JetBrains_Mono'] text-[10.5px]">
                <span className="text-[var(--text-muted,#8A8A8A)] shrink-0">{p.fecha}</span>
                <span className="flex-1 min-w-0 truncate text-slate-800 dark:text-[#F3F1EA]">
                  {p.equipos.map((e, j) => (
                    <span key={j}>
                      {j > 0 && <span className="text-[var(--text-muted,#8A8A8A)]"> – </span>}
                      <span className={e.gano ? 'font-bold text-accent' : ''}>
                        {e.equipo} {e.goles}
                      </span>
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </Tarjeta>
      )}
    </motion.div>
  )
}
