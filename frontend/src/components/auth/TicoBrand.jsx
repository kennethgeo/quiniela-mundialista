// Identidad Tico Games — copia VERBATIM de "Tico Games - Auth y Bracket.dc.html".
// Todos los valores son los exactos del diseño (marco de 320px). AuthPage escala
// el bloque completo al ancho del teléfono con transform:scale, así queda idéntico.

// Logo: emblema Tico Games (imagen con fondo transparente).
export function TicoLogo({ size = 60, style = {} }) {
  return (
    <img
      src="/tico-logo.png"
      alt="Tico Games"
      width={size}
      height={size}
      draggable={false}
      style={{ display: 'block', width: size, height: size, objectFit: 'contain', marginBottom: 14, ...style }}
    />
  )
}

export function TicoWordmark() {
  return (
    <>
      <div style={{ fontFamily: "'Unbounded',sans-serif", fontWeight: 700, fontSize: 22, letterSpacing: '-.02em' }}>Tico Games</div>
      <div style={{ font: "600 9px 'JetBrains Mono',monospace", letterSpacing: '.24em', color: '#2ED3B7', marginTop: 8 }}>PREDECÍ · COMPETÍ · PURA VIDA</div>
    </>
  )
}

// Estilos inline exactos del .dc.html
export const authStyles = {
  header: { position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 34 },
  form: { position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', gap: 12 },
  input: { background: '#161616', border: '1.5px solid #262626', color: '#F3F1EA', font: "600 14px 'Archivo',sans-serif", padding: '13px 14px', borderRadius: 11, outline: 'none', width: '100%' },
  forgot: { textAlign: 'right', font: "600 11px 'Archivo',sans-serif", color: '#8A8A8A', cursor: 'pointer', background: 'none', border: 'none', padding: 0 },
  button: { background: 'linear-gradient(90deg,#2ED3B7,#26bfa5)', borderRadius: 12, padding: 13, textAlign: 'center', fontWeight: 700, fontSize: 13.5, color: '#06231d', cursor: 'pointer', marginTop: 4, border: 'none', width: '100%', fontFamily: "'Archivo',sans-serif" },
  sub: { textAlign: 'center', font: "600 12px 'Archivo',sans-serif", color: '#8A8A8A', marginTop: 6 },
  link: { color: '#2ED3B7', fontWeight: 700, cursor: 'pointer', background: 'none', border: 'none', padding: 0, font: 'inherit' },
  title: { fontFamily: "'Unbounded',sans-serif", fontWeight: 700, fontSize: 19, marginBottom: 8 },
  subtitle: { font: "500 12px 'Archivo',sans-serif", color: '#8A8A8A', marginBottom: 24, lineHeight: 1.5 },
  errorBox: { font: "600 11.5px 'Archivo',sans-serif", color: '#FF7A59', background: 'rgba(255,122,89,.1)', border: '1px solid rgba(255,122,89,.25)', borderRadius: 9, padding: '9px 11px' },
  okBox: { font: "600 11.5px 'Archivo',sans-serif", color: '#2ED3B7', background: 'rgba(46,211,183,.1)', border: '1px solid rgba(46,211,183,.25)', borderRadius: 9, padding: '9px 11px' },
}
