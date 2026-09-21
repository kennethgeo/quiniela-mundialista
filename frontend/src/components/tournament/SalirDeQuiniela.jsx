import { useState } from 'react'
import { motion } from 'motion/react'
import { AlertTriangle, DoorOpen, Loader2 } from 'lucide-react'
import { salirDeQuiniela } from '../../lib/groups'

/* SALIR DE UNA QUINIELA, por decisión propia.

   HASTA LA MIGRACIÓN 83 ESTO NO EXISTÍA. El único borrado de `league_members`
   de toda la base vivía en `expulsar_miembro`, que exige ser admin y además
   prohíbe expulsarse a uno mismo: para irte tenías que pedirle a alguien que
   te echara. Y el botón «No acepto · salir» de la puerta de reglas solo
   navegaba al inicio, así que quien creía haber rechazado las reglas seguía
   siendo miembro.

   LA ALERTA DICE LO QUE DE VERDAD SE PIERDE, con números, no «esta acción no se
   puede deshacer»:
     · las predicciones de partidos de esta quiniela;
     · las globales de esta quiniela (campeón, goleador, asistidor);
     · y el total GLOBAL puede bajar, porque cuenta cada partido una vez con el
       mejor puntaje entre tus quinielas (migración 62): si la mejor era esta,
       ese partido pasa a valer menos.
   Eso último es lo que nadie se espera, y es justo lo que hay que decir.

   Se pide escribir SALIR. Un segundo botón se pulsa por inercia; escribir una
   palabra no. */
export default function SalirDeQuiniela ({ group, prediccionesPropias = 0, onSalio, onCancel }) {
  const [texto, setTexto] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const confirmado = texto.trim().toUpperCase() === 'SALIR'

  const salir = async () => {
    if (!confirmado || busy) return
    try {
      setBusy(true); setError(null)
      const r = await salirDeQuiniela(group.id)
      onSalio?.(r)
    } catch (e) {
      // Una RPC que falla no puede quedar muda: si no, parece que salió.
      setError(e.message || 'No se pudo completar la salida.')
      setBusy(false)
    }
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      className="fixed inset-0 z-[140] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      {/* `role="dialog"` no es decorativo: sin él, un lector de pantalla anuncia
          el aviso como texto suelto de la página, y encima la prueba no puede
          distinguir este texto del de la tarjeta que abrió el diálogo. */}
      <motion.div role="dialog" aria-modal="true" aria-label={`Salir de ${group.name}`}
        initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 320, damping: 28 }}
        className="w-full max-w-[380px] bg-white dark:bg-[#0C0C0C] rounded-[20px] border border-slate-200 dark:border-[#262626] overflow-hidden">
        <div className="p-[22px] pb-3">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle size={18} className="text-[var(--forma-p,#B91C1C)] shrink-0" />
            <h3 className="font-['Unbounded'] font-bold text-[15px] text-slate-900 dark:text-[#F3F1EA]">
              Salir de {group.name}
            </h3>
          </div>

          <p className="text-[12.5px] text-slate-700 dark:text-slate-300 mb-3">
            Si salís, se borra tu participación en esta quiniela. <strong>No se puede deshacer</strong>:
            para volver tendrías que entrar otra vez con el código y empezar de cero.
          </p>

          <ul className="text-[12px] text-slate-700 dark:text-slate-300 space-y-1.5 mb-3 list-disc pl-4">
            <li>
              Se borran tus <strong>{prediccionesPropias} predicciones</strong> de esta quiniela
              {prediccionesPropias > 0 && ', con los puntos que te dieron'}.
            </li>
            <li>Se borran tu campeón, goleador y asistidor de esta quiniela.</li>
            <li>
              Tu <strong>total global puede bajar</strong>: cuenta cada partido una vez con tu mejor
              puntaje entre todas tus quinielas, así que si el mejor era de acá, ese partido pasa a
              valer menos.
            </li>
            <li>Dejás de contar para el pozo y para el reparto.</li>
          </ul>

          <p className="text-[11.5px] text-[var(--text-muted,#8A8A8A)] mb-3">
            Tus votos en propuestas ya emitidas se conservan: eran parte de una votación en curso.
          </p>

          <label className="block text-[11.5px] font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
            Escribí <strong>SALIR</strong> para confirmar
          </label>
          <input value={texto} onChange={(e) => setTexto(e.target.value)}
            autoCapitalize="characters" autoComplete="off" spellCheck={false}
            className="w-full rounded-xl px-3 py-2.5 text-[13px] bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-[#262626] text-slate-900 dark:text-[#F3F1EA]" />

          {error && (
            <p role="alert" className="mt-2 text-[11.5px] text-[var(--forma-p,#B91C1C)]">{error}</p>
          )}
        </div>

        <div className="p-[22px] pt-1 flex flex-col gap-2">
          <button onClick={salir} disabled={!confirmado || busy}
            className="w-full flex items-center justify-center gap-2 rounded-xl py-3 font-['Archivo'] font-bold text-[13px] text-white bg-[#B91C1C] disabled:opacity-40">
            {busy ? <Loader2 size={16} className="animate-spin" /> : <DoorOpen size={16} />}
            Salir de la quiniela
          </button>
          <button onClick={onCancel} disabled={busy}
            className="w-full text-center text-[12.5px] font-semibold text-[var(--text-muted,#8A8A8A)] py-2">
            Mejor me quedo
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}
