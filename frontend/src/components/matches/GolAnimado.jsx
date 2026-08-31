/* Un número de marcador que se anuncia cuando cambia.

   POR QUÉ: el marcador en vivo ya se actualizaba solo, pero lo hacía en
   silencio — el número simplemente era otro. Justo en el momento en que más
   gente tiene la app abierta, el gol pasaba desapercibido.

   La animación es corta y no se repite: llama la atención una vez y se quita.
   No anima en el primer render, porque si no toda la lista de partidos ya
   jugados "cantaría gol" al abrir la pantalla. */
import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'

export default function GolAnimado({ valor, enVivo, className = '', style }) {
  const anterior = useRef(valor)
  const [festeja, setFesteja] = useState(false)

  useEffect(() => {
    // Solo cuando SUBE y el partido está en curso. Una corrección del admin a
    // la baja, o un partido ya terminado, no son un gol.
    if (enVivo && typeof valor === 'number' && valor > anterior.current) {
      setFesteja(true)
      const t = setTimeout(() => setFesteja(false), 1600)
      anterior.current = valor
      return () => clearTimeout(t)
    }
    anterior.current = valor
  }, [valor, enVivo])

  return (
    <div className={`relative overflow-hidden ${className}`} style={style}>
      {/* El destello queda DETRÁS del número y desaparece solo. */}
      <AnimatePresence>
        {festeja && (
          <motion.span
            key="destello"
            initial={{ opacity: 0.85, scale: 0.4 }}
            animate={{ opacity: 0, scale: 2.4 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.1, ease: 'easeOut' }}
            className="absolute inset-0 rounded-lg pointer-events-none"
            style={{ background: 'radial-gradient(circle,#FF4D6D 0%,transparent 70%)' }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={valor}
          initial={{ y: '-70%', opacity: 0 }}
          animate={{ y: '0%', opacity: 1 }}
          exit={{ y: '70%', opacity: 0 }}
          transition={{ type: 'spring', stiffness: 520, damping: 32 }}
          className="relative block"
        >
          {valor ?? 0}
        </motion.span>
      </AnimatePresence>
    </div>
  )
}
