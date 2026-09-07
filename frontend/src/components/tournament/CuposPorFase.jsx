/* Cupo de comodines ×2 por fase.

   POR QUÉ HACE FALTA: un solo número no sirve para formatos distintos. La fase
   de liga de la Champions son 18 partidos por jornada, los octavos son 8 en dos
   series y la final es 1. Con un cupo fijo de 5, la final queda sin límite real.

   SE MUESTRAN LAS FASES QUE EXISTEN **Y** SE PUEDEN AGREGAR LAS QUE NO.
   Antes solo salían las que ya estaban en `matches`, y eso dejaba el editor
   inservible justo cuando hace falta: ESPN publica los octavos de la Champions
   en enero y las finales de la liga tica al final del torneo, así que hasta
   entonces la única fase existente era `groups` — una sola fila, y el editor
   ni siquiera se dibujaba. El cupo hay que poder decidirlo ANTES de que la
   fase empiece; después ya es cambiar las reglas en marcha.

   Una fase que se deje vacía usa el número fijo de la quiniela, NO cero. Eso
   importa: cuando ESPN publique una fase nueva —los octavos de la Champions
   aparecen en enero— nadie se queda sin comodines por no haberla configurado
   todavía.

   EL CANDADO ES POR FASE, NO POR TORNEO (migración 74). Antes se apagaba el
   editor entero en cuanto el torneo empezaba, y eso lo dejaba inútil: la liga
   tica arrancó en julio y sus semifinales son en diciembre. Fijar el cupo de
   una fase que NO empezó no es cambiar las reglas en marcha —nadie predijo
   nada ahí y ninguna predicción cambia de valor—, así que se permite. Tocar
   el de una fase ya empezada sigue prohibido, y lo comprueba la RPC: la
   pantalla solo pinta lo que el servidor ya decide. */
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'motion/react'
import { Loader2, Check, Zap } from 'lucide-react'
import { fetchFasesDelTorneo, setPowerupLimits, proposeRuleChange } from '../../lib/groups'
/* Los nombres viven en lib/fasesDeTorneo porque tienen que coincidir EXACTO
   con lo que el sync escribe en matches.stage: es la clave del cupo, no una
   etiqueta. Ahí está el porqué y la prueba que lo sujeta. */
import { SUGERENCIAS, sugerenciasPara, formatoConocido, nombreDeFase } from '../../lib/fasesDeTorneo'

/* `bloqueado` apaga el editor entero. HOY NADIE LO PASA —GroupPage dejó de
   hacerlo en la 74— y se conserva solo como cierre de emergencia; el candado
   normal es por fila (`f.empezo`). Si algún día vuelve a pasarse, que sea por
   una razón escrita, no por copiar el patrón viejo. */
export default function CuposPorFase({ leagueId, limiteFijo, valores = {}, bloqueado,
                                       torneoRef, hasOpenProposal, onGuardado,
                                       onProposed, showToast }) {
  const { data: fases = [], isLoading, error } = useQuery({
    queryKey: ['fases_torneo', leagueId],
    queryFn: () => fetchFasesDelTorneo(leagueId),
    enabled: !!leagueId,
  })
  const [cfg, setCfg] = useState({})
  const [extras, setExtras] = useState([])   // fases agregadas a mano, aún sin partidos
  const [nueva, setNueva] = useState('')
  const [verTodas, setVerTodas] = useState(false)
  const [nota, setNota] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [listo, setListo] = useState(false)
  const [fallo, setFallo] = useState(null)

  // Los valores guardados llegan por props; se copian al estado editable una
  // vez que se sabe qué fases existen.
  useEffect(() => {
    const inicial = {}
    for (const f of fases) inicial[f.clave] = valores[f.clave] ?? ''
    // Un cupo guardado para una fase que la RPC no devuelva no se pierde.
    for (const [k, v] of Object.entries(valores)) if (!(k in inicial)) inicial[k] = String(v)
    setCfg(inicial)
  }, [fases, valores])

  const existentes = [...fases.map((f) => f.clave), ...extras.map((e) => e.clave)]

  /* Agregar es solo local: la fase no se guarda hasta que se pulse Guardar y
     tenga un número. Así no se ensucia la configuración con filas vacías. */
  const agregar = (nombre) => {
    const clave = String(nombre || '').trim().slice(0, 40)
    if (!clave || existentes.includes(clave)) { setNueva(''); return }
    setExtras((prev) => [...prev, { clave, partidos: 0, jornadas: 0, existe: false }])
    setCfg((prev) => ({ ...prev, [clave]: prev[clave] ?? '' }))
    setNueva('')
  }

  /* Solo van las que tienen número. Las vacías se quitan del objeto para que
     caigan al número fijo. */
  const limpiar = () => {
    const limpio = {}
    for (const [k, v] of Object.entries(cfg)) {
      const n = parseInt(v, 10)
      if (Number.isFinite(n) && String(v).trim() !== '') limpio[k] = Math.max(0, Math.min(99, n))
    }
    return limpio
  }

  /* ¿Se está tocando el cupo de una fase QUE YA EMPEZÓ? Eso no lo cambia un
     admin solo: va a votación del grupo (migraciones 74 y 75). Se compara con
     lo guardado, así que reenviar el mismo valor no cuenta como cambio.
     La comprobación de verdad está en la base; esto solo elige el botón. */
  const tocaFaseEmpezada = () => {
    const limpio = limpiar()
    const claves = new Set([...Object.keys(valores), ...Object.keys(limpio)])
    for (const k of claves) {
      const antes = valores[k] ?? null
      const ahora = limpio[k] ?? null
      if (antes === ahora) continue
      if (fases.some((f) => f.clave === k && f.empezo)) return true
    }
    return false
  }

  /* Se calcula en el render para que el BOTÓN lo diga antes de pulsarlo. */
  const aVotacion = tocaFaseEmpezada()

  const guardar = async () => {
    if (guardando) return
    setGuardando(true); setFallo(null)
    try {
      const limpio = limpiar()
      if (aVotacion) {
        await proposeRuleChange(leagueId, 'scoring', { powerup_limits: limpio }, nota)
        setNota('')
        showToast?.('Propuesta de cupos enviada a votación del grupo.', 'success', 5000)
        onProposed?.()
      } else {
        await setPowerupLimits(leagueId, limpio)
        setListo(true); setTimeout(() => setListo(false), 2500)
        onGuardado?.()
      }
    } catch (e) {
      // Se muestra el error: un permiso que falta no debe verse como "no pasó nada".
      setFallo(e?.message || 'No se pudo guardar')
    } finally {
      setGuardando(false)
    }
  }

  if (isLoading) return null
  if (error) {
    return (
      <p className="text-[11px] text-[#FF7A59] mt-2">
        No se pudieron cargar las fases: {error.message}
      </p>
    )
  }

  return (
    <div className="mt-4 pt-4 border-t border-slate-200 dark:border-[#262626]">
      <div className="flex items-center gap-1.5 mb-1">
        <Zap size={12} className="text-accent" />
        <h4 className="font-bold font-['Archivo'] text-[12px] text-slate-900 dark:text-[#F3F1EA]">
          Comodines ×2 por fase
        </h4>
      </div>
      <p className="text-[10.5px] text-[var(--text-muted,#8A8A8A)] mb-3">
        Vacío usa el cupo general ({limiteFijo}). Una jornada de 18 partidos no
        se juega igual que una final. Una fase que ya empezó no se puede
        cambiar; las que faltan, sí.
      </p>

      <div className="space-y-1.5">
        {[...fases, ...extras.filter((e) => !fases.some((f) => f.clave === e.clave))].map((f) => (
          <div key={f.clave} className="flex items-center gap-2">
            <span className="flex-1 min-w-0 font-['Archivo'] text-[12px] text-slate-800 dark:text-[#F3F1EA] truncate">
              {nombreDeFase(f.clave)}
              <span className="text-[10px] text-[var(--text-muted,#8A8A8A)] ml-1.5">
                {f.existe === false || f.partidos === 0
                  ? 'aún sin partidos'
                  : f.jornadas > 1 ? `${f.jornadas} jornadas` : `${f.partidos} partido${f.partidos === 1 ? '' : 's'}`}
                {f.empezo && ' · ya empezó, requiere votación'}
              </span>
            </span>
            <input
              type="number" min="0" max="99" inputMode="numeric"
              value={cfg[f.clave] ?? ''}
              disabled={bloqueado}
              placeholder={String(limiteFijo)}
              onChange={(e) => setCfg({ ...cfg, [f.clave]: e.target.value })}
              className="w-14 text-center rounded-lg px-2 py-1.5 font-['JetBrains_Mono'] font-bold text-[12px] bg-slate-100 dark:bg-[#0C0C0C] border border-slate-200 dark:border-[#262626] text-slate-900 dark:text-[#F3F1EA] disabled:opacity-50"
            />
          </div>
        ))}
      </div>

      {!bloqueado && (
        <div className="mt-3 pt-3 border-t border-dashed border-slate-200 dark:border-[#262626]">
          <label htmlFor="fase-nueva" className="block text-[10.5px] text-[var(--text-muted,#8A8A8A)] mb-1.5">
            ¿Falta una fase? Agregala aunque todavía no tenga partidos.
          </label>
          <div className="flex items-center gap-2">
            <input
              id="fase-nueva" type="text" value={nueva} maxLength={40}
              placeholder="Octavos, Semis, Final…"
              onChange={(e) => setNueva(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); agregar(nueva) } }}
              className="flex-1 min-w-0 rounded-lg px-2.5 py-1.5 font-['Archivo'] text-[12px] bg-slate-100 dark:bg-[#0C0C0C] border border-slate-200 dark:border-[#262626] text-slate-900 dark:text-[#F3F1EA]"
            />
            <button type="button" onClick={() => agregar(nueva)} disabled={!nueva.trim()}
              className="shrink-0 rounded-lg px-3 py-1.5 font-['Archivo'] font-bold text-[12px] disabled:opacity-40"
              style={{ background: 'rgba(46,211,183,.12)', color: '#2ED3B7' }}>
              Agregar
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {(verTodas ? SUGERENCIAS : sugerenciasPara(torneoRef))
              .filter((x) => !existentes.includes(x)).map((x) => (
                <button key={x} type="button" onClick={() => agregar(x)}
                  className="rounded-full px-2.5 py-1 text-[10.5px] font-['Archivo'] bg-slate-100 dark:bg-[#0C0C0C] border border-slate-200 dark:border-[#262626] text-slate-700 dark:text-slate-300">
                  + {x}
                </button>
              ))}
          </div>

          {/* La lista por torneo evita ofrecer rondas que ahí no existen, pero
              NO puede dejar a nadie sin configurar la suya: un formato cambia y
              el campo de texto ya acepta cualquier nombre. Esto es el atajo. */}
          {formatoConocido(torneoRef) && !verTodas && (
            <button type="button" onClick={() => setVerTodas(true)}
              className="mt-2 text-[10.5px] underline text-[var(--text-muted,#8A8A8A)]">
              ¿Tu torneo juega otra ronda? Ver todas
            </button>
          )}
        </div>
      )}

      {fallo && <p className="text-[11px] text-[#FF7A59] mt-2">{fallo}</p>}

      {/* El botón cambia solo cuando lo que se tocó es una fase YA EMPEZADA:
          ahí no se guarda, se propone. Así el admin ve ANTES de pulsar que eso
          va a votación, en vez de descubrirlo con un error de la base. */}
      {!bloqueado && aVotacion && (
        <textarea value={nota} onChange={(e) => setNota(e.target.value)} rows={2}
          placeholder="¿Por qué? (opcional, lo lee el grupo al votar)"
          className="w-full mt-3 rounded-xl px-3 py-2 font-['Archivo'] text-[12px] bg-slate-100 dark:bg-[#0C0C0C] border border-slate-200 dark:border-[#262626] text-slate-900 dark:text-[#F3F1EA]" />
      )}

      {!bloqueado && aVotacion && hasOpenProposal && (
        <p className="text-[11px] text-[var(--text-muted,#8A8A8A)] mt-2">
          Ya hay una propuesta abierta en esta quiniela: hay que cerrarla antes
          de mandar otra.
        </p>
      )}

      {!bloqueado && (
        <motion.button whileTap={{ scale: 0.98 }} onClick={guardar}
          disabled={guardando || (aVotacion && hasOpenProposal)}
          className="w-full mt-3 rounded-xl py-2 font-['Archivo'] font-bold text-[12px] flex items-center justify-center gap-1.5 disabled:opacity-50"
          style={{ background: 'rgba(46,211,183,.12)', color: '#2ED3B7' }}>
          {guardando ? <Loader2 size={13} className="animate-spin" /> : listo ? <Check size={13} /> : null}
          {guardando ? (aVotacion ? 'Enviando…' : 'Guardando…')
            : listo ? 'Guardado'
              : aVotacion ? 'Proponer cambio al grupo' : 'Guardar cupos por fase'}
        </motion.button>
      )}
    </div>
  )
}
