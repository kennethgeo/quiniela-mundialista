/* Aviso para activar las notificaciones, en el Hub.

   POR QUÉ EXISTE, MEDIDO: solo 9 de 22 jugadores tenían push activado. El
   interruptor vivía —y sigue viviendo— en el Perfil, una pantalla a la que
   casi nadie entra. El resumen de las 6 am y el recordatorio antes del saque
   funcionan, pero a más de la mitad del grupo no le llegaban.

   VA EN EL HUB Y NO EN UN MODAL: es donde se ve «Me falta predecir», que es
   justo lo que el aviso sirve para no olvidar. Un modal al entrar se cierra
   por reflejo.

   NO INSISTE: se puede posponer, y no vuelve en dos semanas. Un aviso que
   reaparece siempre es el que hace que la gente apague TODAS las
   notificaciones, y ahí se pierden también las que importan. */
import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Bell, X, Loader2, Check } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import {
  activarPush, estadoPermiso, tieneSuscripcion, necesitaInstalarPrimero,
} from '../../lib/notificaciones'
import { posponerAviso, avisoPospuesto, debeOfrecerse } from '../../lib/avisoPush'

export default function AvisoNotificaciones () {
  const { profile } = useAuth()
  const [visible, setVisible] = useState(false)
  const [permiso, setPermiso] = useState(null)
  const [activando, setActivando] = useState(false)
  const [listo, setListo] = useState(false)
  const [fallo, setFallo] = useState(null)

  useEffect(() => {
    let vigente = true
    const decidir = async () => {
      const p = estadoPermiso()
      const suscrito = p === 'granted' ? await tieneSuscripcion() : false
      if (!vigente) return
      setPermiso(p)
      setVisible(debeOfrecerse({ permiso: p, suscrito, pospuesto: avisoPospuesto() }))
    }
    decidir()
    return () => { vigente = false }
  }, [profile?.id])

  const activar = async () => {
    setActivando(true); setFallo(null)
    try {
      await activarPush(profile?.id)
      setListo(true)
      // Se deja ver la confirmación antes de retirarlo: si desaparece de golpe
      // no queda claro si funcionó.
      setTimeout(() => setVisible(false), 2000)
    } catch (e) {
      setFallo(e?.message || 'No se pudo activar')
      setPermiso(estadoPermiso())
    } finally {
      setActivando(false)
    }
  }

  const posponer = () => { posponerAviso(); setVisible(false) }

  if (!visible) return null

  /* Tres situaciones distintas, y confundirlas deja a alguien pulsando un
     botón que no puede funcionar:
       · denegado  -> el navegador NO volverá a preguntar; hay que ir a los
                      ajustes del sitio, así que no se ofrece un botón muerto.
       · iOS sin instalar -> primero hay que agregarla a la pantalla de inicio.
       · el resto  -> se puede activar acá mismo. */
  const denegado = permiso === 'denied'
  const faltaInstalar = necesitaInstalarPrimero()

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
        className="rounded-2xl border border-slate-200 dark:border-[#262626] bg-white dark:bg-[#161616] p-4 mb-4"
      >
        <div className="flex items-start gap-3">
          <div className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center"
               style={{ background: 'rgba(46,211,183,.12)', color: '#2ED3B7' }}>
            {listo ? <Check size={16} /> : <Bell size={16} />}
          </div>

          <div className="flex-1 min-w-0">
            <p className="font-bold font-['Archivo'] text-[13px] text-slate-900 dark:text-[#F3F1EA]">
              {listo ? 'Listo, ya te vamos a avisar' : 'Que no se te pase una predicción'}
            </p>

            {/* El gris tenue del resto de la app da 3.45:1, por debajo del 4.5:1
                que pide AA para texto de este tamaño. Acá el texto es lo que
                convence de activar, así que se usa uno legible. */}
            {!listo && (
              <p className="text-[11.5px] text-slate-600 dark:text-slate-300 mt-0.5">
                {denegado
                  ? 'Tenés las notificaciones bloqueadas para este sitio. Se activan desde los ajustes del navegador, en los permisos de esta página.'
                  : faltaInstalar
                    ? 'En iPhone hay que agregar la app a la pantalla de inicio (Compartir → Agregar a inicio) y después activar los avisos desde acá.'
                    : 'Activá las notificaciones y te mandamos los partidos del día y un recordatorio antes del saque.'}
              </p>
            )}

            {fallo && <p className="text-[11px] text-[#FF7A59] mt-1.5">{fallo}</p>}

            {!listo && (
              <div className="flex items-center gap-2 mt-2.5">
                {/* MEDIDO, no supuesto: el acento #2ED3B7 sobre su propio fondo
                    al 12% da 1.74:1 en claro, o sea ilegible. En claro va
                    teal-700 y en oscuro el acento, igual que se resolvió en el
                    sidebar. */}
                {!denegado && !faltaInstalar && (
                  <button type="button" onClick={activar} disabled={activando}
                    className="rounded-lg px-3 py-1.5 font-['Archivo'] font-bold text-[12px] flex items-center gap-1.5 disabled:opacity-50 bg-accent/10 text-teal-700 dark:text-accent">
                    {activando && <Loader2 size={12} className="animate-spin" />}
                    {activando ? 'Activando…' : 'Activar avisos'}
                  </button>
                )}
                <button type="button" onClick={posponer}
                  className="rounded-lg px-3 py-1.5 font-['Archivo'] text-[12px] text-slate-600 dark:text-slate-300">
                  Ahora no
                </button>
              </div>
            )}
          </div>

          <button type="button" onClick={posponer} aria-label="Cerrar aviso"
            className="shrink-0 text-slate-500 dark:text-slate-400 p-1">
            <X size={14} />
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
