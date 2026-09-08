/* La alineación dibujada sobre una cancha.

   POR QUÉ UNA CANCHA Y NO UNA LISTA: una formación es información espacial.
   «4-2-3-1» en una lista son cuatro números; sobre el campo se ve de un
   vistazo si el rival juega con tres delanteros o se encierra — que es lo que
   ayuda a decidir la predicción.

   EL 3D ES CSS, NO UNA LIBRERÍA. `perspective` + `rotateX` bastan para dar
   profundidad, y meter un motor 3D por esto significaría cargar cientos de
   kilobytes en una pantalla que se abre desde el celular con datos móviles.
   Además el CSP solo permite scripts propios: una librería por CDN la
   bloquearía el navegador.

   Las fichas NO se inclinan con el campo: van derechas (`rotateX` inverso)
   para que los nombres se lean. Un jugador tumbado sobre el césped se ve
   bonito en una captura y no se entiende en la mano. */
import { useMemo } from 'react'
import { motion } from 'motion/react'

/* De «4-2-3-1» a las líneas del campo, arquero incluido: [1,4,2,3,1].
   Una formación rara o ausente cae en 4-4-2, que es la más común y evita que
   la cancha quede vacía por un dato que no vino. */
function lineasDe (formacion, cuantos = 11) {
  const partes = String(formacion || '').split('-').map((n) => parseInt(n, 10))
  const validas = partes.filter((n) => Number.isFinite(n) && n > 0)
  const suma = validas.reduce((a, b) => a + b, 0)
  const lineas = suma === cuantos - 1 ? validas : [4, 4, 2]
  return [1, ...lineas]
}

/* Reparte a los once en sus líneas. Se respeta el orden en que vienen: ESPN
   los manda por `formationPlace`, o sea arquero primero y delanteros al final. */
function porLineas (titulares, formacion) {
  const lineas = lineasDe(formacion, titulares.length)
  const salida = []
  let i = 0
  for (const cuantos of lineas) {
    salida.push(titulares.slice(i, i + cuantos))
    i += cuantos
  }
  // Si sobró alguien (formación que no cuadra con la lista), va a la última
  // línea en vez de desaparecer.
  if (i < titulares.length) salida[salida.length - 1].push(...titulares.slice(i))
  return salida.filter((l) => l.length)
}

const apellido = (nombre) => {
  const partes = String(nombre || '').trim().split(/\s+/)
  return partes.length > 1 ? partes[partes.length - 1] : partes[0] || ''
}

function Ficha ({ jugador, indice }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14, scale: 0.7 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay: 0.04 * indice, type: 'spring', stiffness: 320, damping: 22 }}
      className="flex flex-col items-center gap-1 min-w-0"
      /* Se endereza contra la inclinación del campo para que se lea. */
      style={{ transform: 'rotateX(-14deg)', transformStyle: 'preserve-3d' }}
    >
      <div
        className="w-7 h-7 rounded-full grid place-items-center font-['JetBrains_Mono'] font-bold text-[10.5px] tabular-nums shadow-lg"
        style={{
          background: 'linear-gradient(160deg,#2ED3B7,#137f6d)',
          color: '#06231d',
          boxShadow: '0 4px 10px rgba(0,0,0,.45)',
        }}
      >
        {jugador.dorsal ?? '·'}
      </div>
      <span className="max-w-[62px] truncate text-center font-['Archivo'] text-[9.5px] leading-tight text-white/90"
        style={{ textShadow: '0 1px 3px rgba(0,0,0,.9)' }}>
        {apellido(jugador.nombre)}
      </span>
    </motion.div>
  )
}

export default function CanchaAlineacion ({ equipo }) {
  const lineas = useMemo(
    () => porLineas(equipo?.titulares || [], equipo?.formacion),
    [equipo])

  if (!lineas.length) return null

  return (
    <div className="[perspective:900px]">
      <motion.div
        initial={{ opacity: 0, rotateX: 26 }}
        animate={{ opacity: 1, rotateX: 14 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className="relative rounded-2xl overflow-hidden border border-white/10"
        style={{
          transformStyle: 'preserve-3d',
          background: 'linear-gradient(180deg,#0d2f28 0%,#0a231e 55%,#071a16 100%)',
          aspectRatio: '3 / 4',
        }}
      >
        {/* Líneas del campo. Van en SVG y no en divs para que escalen solas y
            no se deformen con la perspectiva. */}
        <svg viewBox="0 0 300 400" className="absolute inset-0 w-full h-full" aria-hidden="true">
          <g fill="none" stroke="rgba(255,255,255,.16)" strokeWidth="1.4">
            <rect x="10" y="10" width="280" height="380" rx="4" />
            <line x1="10" y1="200" x2="290" y2="200" />
            <circle cx="150" cy="200" r="42" />
            <rect x="80" y="10" width="140" height="52" />
            <rect x="118" y="10" width="64" height="22" />
            <rect x="80" y="338" width="140" height="52" />
            <rect x="118" y="368" width="64" height="22" />
          </g>
          {/* Rayas del césped: dan la profundidad sin cargar una textura. */}
          <g fill="rgba(255,255,255,.022)">
            {[0, 1, 2, 3, 4].map((i) => (
              <rect key={i} x="10" y={10 + i * 76} width="280" height="38" />
            ))}
          </g>
        </svg>

        {/* Los once, del arquero (abajo) a los delanteros (arriba). */}
        <div className="relative h-full flex flex-col-reverse justify-between py-4 px-2"
          style={{ transformStyle: 'preserve-3d' }}>
          {lineas.map((linea, i) => (
            <div key={i} className="flex items-center justify-evenly gap-1">
              {linea.map((j, k) => (
                <Ficha key={`${j.dorsal}-${j.nombre}`} jugador={j}
                  indice={lineas.slice(0, i).reduce((a, l) => a + l.length, 0) + k} />
              ))}
            </div>
          ))}
        </div>
      </motion.div>
    </div>
  )
}
