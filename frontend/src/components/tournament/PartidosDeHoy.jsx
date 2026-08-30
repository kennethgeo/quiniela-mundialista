/* Los partidos de hoy, con un botón para mandarlos al grupo de WhatsApp.

   El texto lo arma lib/partidosDelDia.js (puro y con tests) porque el formato
   es lo que la gente lee en el chat: una hora mal convertida se nota enseguida.
   Las horas van en hora de Costa Rica FIJA, no en la del dispositivo — si no,
   alguien de viaje mandaría horas distintas al resto del grupo.

   Se comparte como IMAGEN, con el texto de pie de foto para que el enlace a
   la app siga viajando: en un grupo de WhatsApp una tarjeta se ve de un
   vistazo y un bloque de texto se pierde entre mensajes. Si el canvas falla
   —fuentes, memoria en un celular viejo— se cae al texto de siempre: mejor
   mandar algo que dejar el botón sin hacer nada.

   No incluye predicciones ni marcadores a propósito: esto circula por WhatsApp
   antes de que se juegue nada y no debería filtrar justo lo que la app protege
   con RLS. */
import { useState, useMemo } from 'react'
import { motion } from 'motion/react'
import { CalendarClock, Share2, Copy, Check, Loader2 } from 'lucide-react'
import { partidosDeHoy, horaCostaRica, textoParaWhatsApp } from '../../lib/partidosDelDia'
import { renderPartidosDeHoyCard, compartirImagen } from '../../lib/shareCard'

export default function PartidosDeHoy({ matches = [], nombreQuiniela = '' }) {
  const [copiado, setCopiado] = useState(false)
  const [generando, setGenerando] = useState(false)
  const hoy = useMemo(() => partidosDeHoy(matches), [matches])

  // Sin partidos hoy no se ocupa la tarjeta: el hub ya está bastante cargado.
  if (hoy.length === 0) return null

  const texto = textoParaWhatsApp({
    matches, nombreQuiniela, url: window.location.origin,
  })

  // Respaldo de siempre: mandar el texto. navigator.share abre el selector del
  // sistema, donde WhatsApp aparece primero en un móvil. En escritorio casi
  // nunca existe, así que se cae al portapapeles en vez de no hacer nada.
  const compartirTexto = async () => {
    try {
      if (navigator.share) {
        await navigator.share({ text: texto })
        return
      }
    } catch {
      /* El usuario canceló el selector: no es un error. */
      return
    }
    try {
      await navigator.clipboard.writeText(texto)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2500)
    } catch {
      /* Sin permiso de portapapeles no queda nada por hacer. */
    }
  }

  const compartir = async () => {
    if (generando) return
    setGenerando(true)
    try {
      const blob = await renderPartidosDeHoyCard({
        nombreQuiniela, partidos: hoy, horaDe: horaCostaRica,
      })
      // El texto va de pie de foto: la imagen no puede llevar un enlace.
      const como = await compartirImagen(
        blob, 'partidos-de-hoy.png', `${nombreQuiniela} · Partidos de hoy`, texto,
      )
      // En escritorio no se puede compartir archivos: se descarga. Avisamos
      // reusando el mismo cartelito, si no parece que el botón no hizo nada.
      if (como === 'descargado') {
        setCopiado(true)
        setTimeout(() => setCopiado(false), 2500)
      }
    } catch {
      /* Dibujar el canvas falló. Mejor el texto que un botón muerto. */
      await compartirTexto()
    } finally {
      setGenerando(false)
    }
  }

  return (
    <div className="rounded-[14px] bg-white dark:bg-[#161616] border border-slate-200 dark:border-[#262626] p-4 mb-3">
      <div className="flex items-center gap-2 mb-2.5">
        <CalendarClock size={15} className="text-accent" />
        <h3 className="font-bold font-['Archivo'] text-[13px] text-slate-900 dark:text-[#F3F1EA]">
          {hoy.length === 1 ? 'Hoy se juega' : `Hoy se juegan ${hoy.length}`}
        </h3>
        <motion.button whileTap={{ scale: 0.94 }} onClick={compartir} disabled={generando}
          className="ml-auto flex items-center gap-1 font-['JetBrains_Mono'] font-bold text-[9px] px-2 py-1 rounded-[20px] text-accent disabled:opacity-60"
          style={{ background: 'rgba(46,211,183,.12)' }}
          title="Mandar la imagen de los partidos de hoy al grupo">
          {generando ? <Loader2 size={10} className="animate-spin" />
            : copiado ? <Check size={10} />
            : navigator.share ? <Share2 size={10} /> : <Copy size={10} />}
          {generando ? 'ARMANDO' : copiado ? 'LISTO' : 'COMPARTIR'}
        </motion.button>
      </div>

      <div className="space-y-0.5">
        {hoy.map((m) => (
          <div key={m.id} className="flex items-center gap-2 py-1">
            <span className="font-['JetBrains_Mono'] text-[10.5px] text-[var(--text-muted,#8A8A8A)] w-[62px] shrink-0">
              {horaCostaRica(m.kickoff_at)}
            </span>
            <span className="flex-1 min-w-0 font-['Archivo'] text-[12px] text-slate-800 dark:text-[#F3F1EA] truncate">
              {m.home_team} <span className="text-[var(--text-muted,#8A8A8A)]">vs</span> {m.away_team}
            </span>
          </div>
        ))}
      </div>

      <p className="text-[10px] text-[var(--text-muted,#8A8A8A)] mt-2">
        Cada partido cierra 15 min antes del saque.
      </p>
    </div>
  )
}
