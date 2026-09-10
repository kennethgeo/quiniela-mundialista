/* La caja de un documento legal: privacidad y condiciones.

   No usa MainLayout ni ProtectedRoute a propósito — estas páginas tienen que
   abrirse SIN sesión, porque las revisa Google y las lee quien todavía no
   tiene cuenta. */
import { Link } from 'react-router-dom'

export function Seccion({ titulo, children }) {
  return (
    <section style={{ marginTop: 26 }}>
      <h2 style={{ font: "700 15px 'Archivo',sans-serif", color: '#F3F1EA', margin: '0 0 8px' }}>{titulo}</h2>
      {children}
    </section>
  )
}

export default function DocumentoLegal({ titulo, actualizado, children }) {
  return (
    <div style={{ minHeight: '100dvh', background: '#0C0C0C', color: '#C9C6BD', fontFamily: "'Archivo',sans-serif" }}>
      <div style={{ maxWidth: 680, margin: '0 auto', padding: '32px 20px 64px', font: "400 14px/1.65 'Archivo',sans-serif" }}>
        <Link to="/auth" style={{ color: '#2ED3B7', fontWeight: 700, fontSize: 13, textDecoration: 'none' }}>← Tico Games</Link>
        <h1 style={{ font: "700 25px 'Archivo',sans-serif", color: '#F3F1EA', margin: '18px 0 4px' }}>{titulo}</h1>
        <p style={{ color: '#8A8A8A', fontSize: 12.5, margin: '0 0 22px' }}>Última actualización: {actualizado}</p>
        {children}
      </div>
    </div>
  )
}
