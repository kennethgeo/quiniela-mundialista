// Identidad Tico Games — transcripción exacta de "Tico Games - Auth y Bracket.dc.html"
// (marco de 320px del diseño, escalado ~1.22× para llenar el ancho del teléfono).

// Logo: aro coral en órbita (detrás) + bola teal con punto blanco. Mismas proporciones
// que el diseño: aro 70×32, bola 42, punto 15, sobre un contenedor de 56 (× escala).
export function TicoLogo({ size = 68 }) {
  const ball = size * 0.75      // 42/56
  const dot = size * 0.268      // 15/56
  const ringW = size * 1.25     // 70/56
  const ringH = size * 0.571    // 32/56
  return (
    <div style={{ width: size, height: size }} className="relative grid place-items-center">
      <div
        className="absolute rounded-full"
        style={{ width: ringW, height: ringH, border: `${Math.max(1.8, size * 0.032)}px solid #FF7A59`, transform: 'rotate(-24deg)', opacity: 0.75 }}
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

// Wordmark + tagline — diseño: Unbounded 700 22px + JetBrains Mono 600 9px .24em (× escala)
export function TicoWordmark() {
  return (
    <div className="flex flex-col items-center">
      <div className="text-[#F3F1EA] tracking-[-.02em] font-['Unbounded'] font-bold text-[27px] leading-none">Tico Games</div>
      <div className="font-['JetBrains_Mono'] font-semibold text-[11px] tracking-[0.24em] text-[#2ED3B7] mt-2.5 text-center">
        PREDECÍ · COMPETÍ · PURA VIDA
      </div>
    </div>
  )
}

// Inputs y botón — diseño: input 600 14px / pad 13-14 / radio 11 / #161616 borde 1.5px #262626;
// botón gradiente / radio 12 / pad 13 / 700 13.5px #06231d  (todo × ~1.22).
export const AUTH_INPUT =
  "w-full bg-[#161616] border-[1.5px] border-[#262626] text-[#F3F1EA] rounded-[13px] px-[17px] py-[16px] font-['Archivo'] font-semibold text-[17px] placeholder-[#7c7c7c] outline-none focus:border-[#2ED3B7] transition-colors"

export const AUTH_BTN =
  "w-full bg-gradient-to-r from-[#2ED3B7] to-[#26bfa5] text-[#06231d] rounded-[15px] py-[16px] font-['Archivo'] font-bold text-[16.5px] text-center transition-transform active:scale-[0.98] disabled:opacity-60 flex items-center justify-center gap-2"
