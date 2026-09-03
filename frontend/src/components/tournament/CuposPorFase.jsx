/* Cupo de comodines ×2 por fase.

   POR QUÉ HACE FALTA: un solo número no sirve para formatos distintos. La fase
   de liga de la Champions son 18 partidos por jornada, los octavos son 8 en dos
   series y la final es 1. Con un cupo fijo de 5, la final queda sin límite real.

   SOLO SE MUESTRAN LAS FASES QUE EXISTEN en el torneo, no una lista inventada:
   la liga tica no tiene octavos y la Champions no tiene tercer puesto.

   Una fase que se deje vacía usa el número fijo de la quiniela, NO cero. Eso
   importa: cuando ESPN publique una fase nueva —los octavos de la Champions
   aparecen en enero— nadie se queda sin comodines por no haberla configurado
   todavía. */
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'motion/react'
import { Loader2, Check, Zap } from 'lucide-react'
import { fetchFasesDelTorneo, setPowerupLimits } from '../../lib/groups'

const NOMBRES = {
  groups: 'Jornadas regulares',
  knockout: 'Eliminatoria (sin fase definida)',
}
const bonito = (clave) => NOMBRES[clave] || clave

export default function CuposPorFase({ leagueId, limiteFijo, valores = {}, bloqueado, onGuardado }) {
  const { data: fases = [], isLoading, error } = useQuery({
    queryKey: ['fases_torneo', leagueId],
    queryFn: () => fetchFasesDelTorneo(leagueId),
    enabled: !!leagueId,
  })
  const [cfg, setCfg] = useState({})
  const [guardando, setGuardando] = useState(false)
  const [listo, setListo] = useState(false)
  const [fallo, setFallo] = useState(null)

  // Los valores guardados llegan por props; se copian al estado editable una
  // vez que se sabe qué fases existen.
  useEffect(() => {
    const inicial = {}
    for (const f of fases) inicial[f.clave] = valores[f.clave] ?? ''
    setCfg(inicial)
  }, [fases, valores])

  const guardar = async () => {
    if (guardando) return
    setGuardando(true); setFallo(null)
    try {
      // Solo van las que tienen número. Las vacías se quitan del objeto para
      // que caigan al número fijo.
      const limpio = {}
      for (const [k, v] of Object.entries(cfg)) {
        const n = parseInt(v, 10)
        if (Number.isFinite(n) && String(v).trim() !== '') limpio[k] = Math.max(0, Math.min(99, n))
      }
      await setPowerupLimits(leagueId, limpio)
      setListo(true); setTimeout(() => setListo(false), 2500)
      onGuardado?.()
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
  if (fases.length <= 1) return null   // con una sola fase no aporta nada

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
        se juega igual que una final.
      </p>

      <div className="space-y-1.5">
        {fases.map((f) => (
          <div key={f.clave} className="flex items-center gap-2">
            <span className="flex-1 min-w-0 font-['Archivo'] text-[12px] text-slate-800 dark:text-[#F3F1EA] truncate">
              {bonito(f.clave)}
              <span className="text-[10px] text-[var(--text-muted,#8A8A8A)] ml-1.5">
                {f.jornadas > 1 ? `${f.jornadas} jornadas` : `${f.partidos} partido${f.partidos === 1 ? '' : 's'}`}
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

      {fallo && <p className="text-[11px] text-[#FF7A59] mt-2">{fallo}</p>}

      {!bloqueado && (
        <motion.button whileTap={{ scale: 0.98 }} onClick={guardar} disabled={guardando}
          className="w-full mt-3 rounded-xl py-2 font-['Archivo'] font-bold text-[12px] flex items-center justify-center gap-1.5 disabled:opacity-50"
          style={{ background: 'rgba(46,211,183,.12)', color: '#2ED3B7' }}>
          {guardando ? <Loader2 size={13} className="animate-spin" /> : listo ? <Check size={13} /> : null}
          {guardando ? 'Guardando…' : listo ? 'Guardado' : 'Guardar cupos por fase'}
        </motion.button>
      )}
    </div>
  )
}
