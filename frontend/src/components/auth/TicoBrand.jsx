// Identidad Tico Games (nuevo diseño) — logo + estilos compartidos de auth.

// Logo: aro coral en órbita + bola teal con punto blanco.
export function TicoLogo({ size = 56 }) {
  const s = size
  const ball = Math.round(size * 0.75)
  const dot = Math.round(size * 0.27)
  const ringW = Math.round(size * 1.25)
  const ringH = Math.round(size * 0.57)
  return (
    <div style={{ width: s, height: s }} className="relative grid place-items-center">
      <div
        className="absolute rounded-full"
        style={{ width: ringW, height: ringH, border: '1.8px solid #FF7A59', transform: 'rotate(-24deg)', opacity: 0.75 }}
      />
      <div
        className="rounded-full grid place-items-center"
        style={{ width: ball, height: ball, background: 'linear-gradient(135deg,#2ED3B7,#1a8f7c)', boxShadow: '0 0 22px -2px rgba(46,211,183,.6)' }}
      >
        <div className="rounded-full bg-white" style={{ width: dot, height: dot }} />
      </div>
    </div>
  )
}

// Wordmark + tagline
export function TicoWordmark() {
  return (
    <div className="flex flex-col items-center">
      <div className="text-[#F3F1EA] tracking-[-.02em] font-['Unbounded'] font-bold text-[22px]">Tico Games</div>
      <div className="font-['JetBrains_Mono'] font-semibold text-[9px] tracking-[0.24em] text-[#2ED3B7] mt-2">
        PREDECÍ · COMPETÍ · PURA VIDA
      </div>
    </div>
  )
}

// Clases reutilizables del nuevo look de auth
export const AUTH_INPUT =
  "w-full bg-[#161616] border-[1.5px] border-[#262626] text-[#F3F1EA] rounded-[11px] px-3.5 py-3 font-['Archivo'] font-semibold text-sm placeholder-[#6c6c6c] outline-none focus:border-[#2ED3B7] transition-colors"

export const AUTH_BTN =
  "w-full bg-gradient-to-r from-[#2ED3B7] to-[#26bfa5] text-[#06231d] rounded-xl py-3.5 font-['Archivo'] font-bold text-[13.5px] text-center transition-transform active:scale-[0.98] disabled:opacity-60 flex items-center justify-center gap-2"
