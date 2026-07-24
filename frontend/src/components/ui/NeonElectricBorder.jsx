// Neon Electric Border — variante "comet-trail pulse + soft sparks".
// Implementación de referencia provista por el usuario (NeonElectricBorder.example.jsx),
// adaptada a un OVERLAY absoluto: se coloca dentro de una tarjeta `relative` y mide su
// propio tamaño, sin envolver el contenido. Se usa cuando el comodín ×2 está activo.
import { useEffect, useRef, useState } from 'react'

function pointOnRect(t, w, h) {
  const per = 2 * (w + h)
  let d = (((t % 1) + 1) % 1) * per
  if (d < w) return { x: d, y: 0 }
  d -= w
  if (d < h) return { x: w, y: d }
  d -= h
  if (d < w) return { x: w - d, y: h }
  d -= w
  return { x: 0, y: h - d }
}

function buildRing(progress, W, H, radius) {
  const cometCount = 3, speedLoops = 2
  const P = 2 * (W + H)
  const len = (P / cometCount) * 0.35
  const gap = P / cometCount - len
  const dash = `${len} ${gap}`
  const offset = -progress * speedLoops * P
  const pulse = 0.55 + 0.45 * Math.sin(2 * Math.PI * 2 * progress)
  const common = { x: 2, y: 2, width: W - 4, height: H - 4, rx: radius, fill: 'none', strokeDasharray: dash, strokeDashoffset: offset, strokeLinecap: 'round' }
  return (
    <svg width={W} height={H} style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }}>
      <rect {...common} stroke="#22d3ee" strokeWidth={16} opacity={0.4 * pulse} style={{ filter: 'blur(12px)' }} />
      <rect {...common} stroke="#2dd4bf" strokeWidth={6} opacity={0.85 * pulse} style={{ filter: 'blur(2.5px)' }} />
      <rect {...common} stroke="#ecfeff" strokeWidth={2} opacity={0.95 * pulse} />
      <rect x={2} y={2} width={W - 4} height={H - 4} rx={radius} fill="none" stroke="#2dd4bf" strokeWidth={1.5} opacity={0.4}
        style={{ filter: `drop-shadow(0 0 ${7 * pulse}px #2dd4bf)` }} />
    </svg>
  )
}

function buildSparks(progress, W, H) {
  const count = 8, intensity = 0.55
  const items = []
  for (let i = 0; i < count; i++) {
    const baseT = i / count + 0.13
    const p = pointOnRect(baseT, W, H)
    const k = 5 + (i % 5)
    const phase = i * 2.399963
    const raw = Math.sin(2 * Math.PI * k * progress + phase)
    const flash = Math.pow(Math.max(0, raw), 16) * intensity
    if (flash < 0.03) continue
    items.push(
      <div key={i} style={{
        position: 'absolute', left: p.x, top: p.y, width: 9, height: 9,
        transform: 'translate(-50%,-50%)', borderRadius: 999,
        background: '#e0fbff', boxShadow: `0 0 ${16 * flash}px ${7 * flash}px #22d3ee`,
        opacity: flash, pointerEvents: 'none',
      }} />,
    )
  }
  return <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>{items}</div>
}

export default function NeonElectricBorder({ radius = 14 }) {
  const ref = useRef(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [t, setT] = useState(0)

  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setSize({ w: width, h: height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) return
    const start = performance.now()
    let raf
    const loop = () => {
      setT((performance.now() - start) / 1000)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  const progress = (t % 4.5) / 4.5

  return (
    <div ref={ref} aria-hidden style={{ position: 'absolute', inset: 0, pointerEvents: 'none', borderRadius: radius }}>
      {size.w > 0 && buildRing(progress, size.w, size.h, radius)}
      {size.w > 0 && buildSparks(progress, size.w, size.h)}
    </div>
  )
}
