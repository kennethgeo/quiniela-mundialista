// Identidad Tico Games (nuevo diseño) — logo + estilos compartidos de auth.

// Logo: bola teal con brillo + aro coral en órbita (cruza por delante y por detrás).
export function TicoLogo({ size = 100 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ filter: 'drop-shadow(0 0 16px rgba(46,211,183,.5))' }}
    >
      <defs>
        <radialGradient id="tg-ball" cx="38%" cy="34%" r="78%">
          <stop offset="0%" stopColor="#6FEED6" />
          <stop offset="52%" stopColor="#2ED3B7" />
          <stop offset="100%" stopColor="#12907a" />
        </radialGradient>
      </defs>

      {/* Aro — mitad de atrás (detrás de la bola) */}
      <path d="M 5 50 A 45 17 0 0 1 95 50" transform="rotate(-18 50 50)"
        stroke="#FF7A59" strokeWidth="3.4" strokeLinecap="round" fill="none" opacity="0.95" />

      {/* Bola */}
      <circle cx="50" cy="50" r="27" fill="url(#tg-ball)" />
      {/* Punto de luz */}
      <circle cx="41" cy="41" r="7" fill="#ffffff" />

      {/* Aro — mitad de adelante (por delante de la bola) */}
      <path d="M 5 50 A 45 17 0 0 0 95 50" transform="rotate(-18 50 50)"
        stroke="#FF7A59" strokeWidth="3.4" strokeLinecap="round" fill="none" />
    </svg>
  )
}

// Wordmark + tagline
export function TicoWordmark() {
  return (
    <div className="flex flex-col items-center">
      <div className="text-[#F3F1EA] tracking-[-.02em] font-['Unbounded'] font-bold text-[36px] leading-none">Tico Games</div>
      <div className="font-['JetBrains_Mono'] font-semibold text-[12px] tracking-[0.26em] text-[#2ED3B7] mt-3.5">
        PREDECÍ · COMPETÍ · PURA VIDA
      </div>
    </div>
  )
}

// Clases reutilizables del nuevo look de auth
export const AUTH_INPUT =
  "w-full bg-[#1a1a1a] border border-[#2c2c2c] text-[#F3F1EA] rounded-2xl px-5 py-[17px] font-['Archivo'] font-medium text-[16px] placeholder-[#7c7c7c] outline-none focus:border-[#2ED3B7] transition-colors"

export const AUTH_BTN =
  "w-full bg-gradient-to-r from-[#2ED3B7] to-[#26bfa5] text-[#06231d] rounded-2xl py-[17px] font-['Archivo'] font-bold text-[16px] text-center transition-transform active:scale-[0.98] disabled:opacity-60 flex items-center justify-center gap-2"
