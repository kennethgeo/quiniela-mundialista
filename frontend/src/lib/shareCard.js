/* Tarjeta compartible de una jornada, dibujada a mano en un canvas.
   El grupo vive en WhatsApp, así que la idea es que se pueda mandar la jornada
   sin recurrir a un screenshot recortado.

   POR QUÉ SE DIBUJA Y NO SE CAPTURA EL DOM: los escudos salen de dominios
   externos (flagcdn, ESPN) que no mandan cabeceras CORS. Dibujarlos en un
   canvas lo deja "tainted" y toBlob() falla con SecurityError. Además una
   captura de la interfaz se ve como una captura; esto es una pieza pensada
   para el chat. Por eso: cero imágenes externas, solo texto y color. */

const FONDO = '#0C0C0C'
const TARJETA = '#161616'
const BORDE = '#262626'
const TEXTO = '#F3F1EA'
const MUTED = '#8A8A8A'
const TEAL = '#2ED3B7'
const ORO = '#E8B75A'
const CORAL = '#FF7A59'

const ANCHO = 1080
const MARGEN = 40
const COL_NOMBRE = 336
const ALTO_FILA = 54
const ALTO_CABECERA = 104

// Abreviatura de equipo para la cabecera: sin acentos, 3 letras.
const abreviar = (nombre) =>
  (nombre || '?')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z ]/g, '')
    .trim().slice(0, 3).toUpperCase() || '?'

const recortar = (ctx, texto, maxAncho) => {
  let t = texto || ''
  if (ctx.measureText(t).width <= maxAncho) return t
  while (t.length > 1 && ctx.measureText(t + '…').width > maxAncho) t = t.slice(0, -1)
  return t + '…'
}

const rect = (ctx, x, y, w, h, r, fill) => {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
  ctx.fillStyle = fill
  ctx.fill()
}

// Las fuentes de la app vienen de Google Fonts: hay que esperar a que estén
// listas o el canvas dibuja con la de fallback sin avisar.
async function esperarFuentes() {
  if (!document.fonts) return
  try {
    await Promise.all([
      document.fonts.load("bold 56px 'Unbounded'"),
      document.fonts.load("600 26px 'Archivo'"),
      document.fonts.load("bold 24px 'JetBrains Mono'"),
    ])
    await document.fonts.ready
  } catch {
    // Si falla, se dibuja igual con las de sistema.
  }
}

/* Dibuja la jornada y devuelve un Blob PNG.
   filas: [{ display_name, total, celdas: [{ veredicto, pred, x2 }] }] */
export async function renderJornadaCard({ nombreQuiniela, jornadaLabel, partidos, filas }) {
  await esperarFuentes()

  const n = partidos.length
  const anchoCeldas = ANCHO - MARGEN * 2 - COL_NOMBRE
  const anchoCol = anchoCeldas / Math.max(n, 1)

  const yTabla = 212
  const alto = yTabla + ALTO_CABECERA + filas.length * ALTO_FILA + 110

  const canvas = document.createElement('canvas')
  // 2x para que no se vea pixelado al abrirlo en el celular.
  const escala = 2
  canvas.width = ANCHO * escala
  canvas.height = alto * escala
  const ctx = canvas.getContext('2d')
  ctx.scale(escala, escala)

  ctx.fillStyle = FONDO
  ctx.fillRect(0, 0, ANCHO, alto)

  // ── Encabezado ──
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = MUTED
  ctx.font = "bold 24px 'JetBrains Mono', monospace"
  ctx.letterSpacing = '4px'
  ctx.fillText((nombreQuiniela || '').toUpperCase(), MARGEN, 74)
  ctx.letterSpacing = '0px'

  ctx.fillStyle = TEXTO
  ctx.font = "bold 56px 'Unbounded', sans-serif"
  ctx.fillText(jornadaLabel || '', MARGEN, 140)

  ctx.fillStyle = MUTED
  ctx.font = "22px 'Archivo', sans-serif"
  const plural = (k, s, p) => `${k} ${k === 1 ? s : p}`
  ctx.fillText(`${plural(n, 'partido', 'partidos')} · ${plural(filas.length, 'jugador', 'jugadores')}`, MARGEN, 178)

  // ── Cabecera de la tabla: los partidos con su marcador real ──
  const x0 = MARGEN + COL_NOMBRE
  ctx.textAlign = 'center'
  partidos.forEach((m, i) => {
    const cx = x0 + anchoCol * i + anchoCol / 2
    ctx.fillStyle = MUTED
    ctx.font = "bold 20px 'JetBrains Mono', monospace"
    ctx.fillText(`${abreviar(m.home_team)}-${abreviar(m.away_team)}`, cx, yTabla + 34)

    const anulado = m.status === 'cancelled' || m.status === 'postponed'
    ctx.fillStyle = anulado ? CORAL : TEXTO
    ctx.font = "bold 30px 'JetBrains Mono', monospace"
    const marcador = anulado
      ? '—'
      : `${m.home_goals_actual ?? '·'}-${m.away_goals_actual ?? '·'}`
    ctx.fillText(marcador, cx, yTabla + 74)
  })

  ctx.strokeStyle = BORDE
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(MARGEN, yTabla + ALTO_CABECERA - 8)
  ctx.lineTo(ANCHO - MARGEN, yTabla + ALTO_CABECERA - 8)
  ctx.stroke()

  // ── Filas ──
  filas.forEach((f, i) => {
    const y = yTabla + ALTO_CABECERA + i * ALTO_FILA

    if (i % 2 === 0) rect(ctx, MARGEN, y, ANCHO - MARGEN * 2, ALTO_FILA - 6, 10, 'rgba(255,255,255,.03)')

    // Puesto y nombre
    ctx.textAlign = 'left'
    ctx.fillStyle = i === 0 ? ORO : MUTED
    ctx.font = "bold 22px 'JetBrains Mono', monospace"
    ctx.fillText(String(i + 1), MARGEN + 12, y + 36)

    ctx.fillStyle = TEXTO
    ctx.font = "600 25px 'Archivo', sans-serif"
    ctx.fillText(recortar(ctx, f.display_name, COL_NOMBRE - 104), MARGEN + 52, y + 36)

    // Puntos de la jornada
    ctx.textAlign = 'right'
    ctx.fillStyle = f.total > 0 ? TEAL : MUTED
    ctx.font = "bold 26px 'JetBrains Mono', monospace"
    ctx.fillText(String(f.total), MARGEN + COL_NOMBRE - 16, y + 36)

    // Celdas
    ctx.textAlign = 'center'
    f.celdas.forEach((c, j) => {
      const cx = x0 + anchoCol * j
      const w = anchoCol - 8
      const v = c.veredicto
      const fondo = v === 'exacto' ? 'rgba(46,211,183,.22)'
        : v === 'acierto' ? 'rgba(232,183,90,.18)'
        : v === 'anulado' ? 'rgba(255,122,89,.12)'
        : (v === 'fallo' && c.x2) ? 'rgba(255,90,90,.10)'
        : 'transparent'
      if (fondo !== 'transparent') rect(ctx, cx + 4, y, w, ALTO_FILA - 6, 8, fondo)

      const color = v === 'exacto' ? TEAL
        : v === 'acierto' ? ORO
        : v === 'anulado' ? CORAL
        : (v === 'fallo' && c.x2) ? '#FF8A8A'
        : MUTED
      ctx.fillStyle = color
      ctx.font = "bold 24px 'JetBrains Mono', monospace"
      const txt = c.pred ? `${c.pred.home_goals_pred}-${c.pred.away_goals_pred}` : '·'
      // El rayo del ×2 va antes del marcador, del color del resultado.
      ctx.fillText(c.x2 ? `⚡${txt}` : txt, cx + 4 + w / 2, y + 36)
    })
  })

  // ── Pie ──
  const yPie = alto - 44
  ctx.textAlign = 'left'
  ctx.fillStyle = MUTED
  ctx.font = "20px 'Archivo', sans-serif"
  ctx.fillText('Tico Games', MARGEN, yPie)

  ctx.textAlign = 'right'
  ctx.font = "bold 20px 'JetBrains Mono', monospace"
  ctx.fillStyle = TEAL
  ctx.fillText('exacto', ANCHO - MARGEN - 210, yPie)
  ctx.fillStyle = ORO
  ctx.fillText('acierto', ANCHO - MARGEN - 100, yPie)
  ctx.fillStyle = MUTED
  ctx.fillText('fallo', ANCHO - MARGEN, yPie)

  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo generar la imagen'))), 'image/png')
  })
}

/* Comparte el blob: en celular usa la hoja nativa (WhatsApp aparece ahí);
   en escritorio, o si el navegador no soporta compartir archivos, lo descarga. */
export async function compartirImagen(blob, nombreArchivo, titulo) {
  const file = new File([blob], nombreArchivo, { type: 'image/png' })

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: titulo })
      return 'compartido'
    } catch (err) {
      // El usuario canceló la hoja de compartir: no es un error que mostrar.
      if (err?.name === 'AbortError') return 'cancelado'
    }
  }

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nombreArchivo
  a.click()
  URL.revokeObjectURL(url)
  return 'descargado'
}
