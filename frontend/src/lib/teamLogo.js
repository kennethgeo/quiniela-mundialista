// Escudo de reemplazo (iniciales) para equipos sin logo en ESPN
// (p. ej. clubes chicos de la liga tica). Devuelve un data-URI SVG.
export function initialsDataUri(name = '?', size = 64) {
  const parts = String(name || '?').trim().split(/\s+/).filter(Boolean)
  const initials = ((parts[0]?.[0] || '?') + (parts[1]?.[0] || '')).toUpperCase()
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" rx="14" fill="#1f2a30"/>` +
    `<text x="32" y="33" font-family="Arial,Helvetica,sans-serif" font-size="24" font-weight="700" ` +
    `fill="#8fd6c9" text-anchor="middle" dominant-baseline="central">${initials}</text></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

// Handler onError para <img>: cambia a las iniciales si el logo/bandera falla.
export function crestOnError(name) {
  return (e) => { e.target.onerror = null; e.target.src = initialsDataUri(name) }
}
