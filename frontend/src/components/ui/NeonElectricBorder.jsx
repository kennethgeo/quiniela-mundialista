// Borde eléctrico neón: overlay que se coloca dentro de una tarjeta (relative).
// El look "eléctrico" lo produce un filtro SVG (feTurbulence + feDisplacementMap)
// cuyo ruido se desplaza en el tiempo, ondulando el borde como electricidad.
import { useId } from 'react'

export default function NeonElectricBorder({ color = '#2ED3B7', radius = 14, thickness = 2, speed = 4 }) {
  const raw = useId().replace(/[:]/g, '')
  const fid = `eb-${raw}`
  return (
    <div className="eb-root" aria-hidden style={{ '--eb-color': color, '--eb-radius': `${radius}px`, '--eb-thickness': `${thickness}px`, borderRadius: radius }}>
      <svg className="eb-svg" aria-hidden focusable="false">
        <defs>
          <filter id={fid} colorInterpolationFilters="sRGB" x="-25%" y="-25%" width="150%" height="150%">
            <feTurbulence type="turbulence" baseFrequency="0.015" numOctaves="10" seed="3" result="noise" />
            <feOffset in="noise" dx="0" dy="0" result="off">
              <animate attributeName="dy" from="0" to="140" dur={`${speed}s`} repeatCount="indefinite" />
            </feOffset>
            <feDisplacementMap in="SourceGraphic" in2="off" scale="14" xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </defs>
      </svg>
      <div className="eb-stroke" style={{ filter: `url(#${fid})` }} />
      <div className="eb-glow-1" style={{ filter: `url(#${fid}) blur(1.2px)`, opacity: 0.7 }} />
      <div className="eb-glow-2" />
    </div>
  )
}
