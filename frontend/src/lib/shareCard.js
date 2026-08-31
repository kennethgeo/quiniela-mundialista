/* Tarjeta compartible de una jornada, dibujada a mano en un canvas.
   El grupo vive en WhatsApp, así que la idea es que se pueda mandar la jornada
   sin recurrir a un screenshot recortado.

   POR QUÉ SE DIBUJA Y NO SE CAPTURA EL DOM: una captura de la interfaz se ve
   como una captura; esto es una pieza pensada para el chat.

   SOBRE LOS ESCUDOS: acá decía que no se podían dibujar porque flagcdn y ESPN
   no mandaban cabeceras CORS y el canvas quedaba "tainted". Se comprobó y hoy
   ambos responden `access-control-allow-origin: *`, así que con
   crossOrigin='anonymous' se pueden dibujar sin contaminar el canvas. Aun así
   NADA es obligatorio: si una imagen no llega a tiempo, la tarjeta se dibuja
   sin ella. Un escudo que tarda no puede dejar al grupo sin su tarjeta. */

import { fotoDeEstadio } from './estadios'

const FONDO = '#0C0C0C'
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

const PLAZO_IMAGEN_MS = 4000

/* Carga una imagen para el canvas. NUNCA rechaza: devuelve null si no llega,
   si falla o si tarda demasiado, y quien dibuja sigue sin ella. */
function cargarImagen(url, plazoMs = PLAZO_IMAGEN_MS) {
  if (!url) return Promise.resolve(null)
  return new Promise((resolve) => {
    const img = new Image()
    // Sin esto el canvas queda "tainted" y toBlob() revienta con SecurityError.
    img.crossOrigin = 'anonymous'
    const plazo = setTimeout(() => resolve(null), plazoMs)
    img.onload = () => { clearTimeout(plazo); resolve(img) }
    img.onerror = () => { clearTimeout(plazo); resolve(null) }
    img.src = url
  })
}

/* Dibuja la imagen cubriendo el rectángulo, recortando lo que sobre y sin
   deformarla (como background-size: cover). Una foto de estadio estirada se
   nota enseguida. */
function dibujarCubriendo(ctx, img, x, y, ancho, alto) {
  const escala = Math.max(ancho / img.width, alto / img.height)
  const a = img.width * escala
  const b = img.height * escala
  ctx.drawImage(img, x + (ancho - a) / 2, y + (alto - b) / 2, a, b)
}

/* Dibuja el escudo dentro de un cuadrado, entero y sin deformar (como
   object-fit: contain): los escudos no son cuadrados y recortarlos les corta
   la punta. */
function dibujarEscudo(ctx, img, x, y, lado) {
  const escala = Math.min(lado / img.width, lado / img.height)
  const a = img.width * escala
  const b = img.height * escala
  ctx.drawImage(img, x + (lado - a) / 2, y + (lado - b) / 2, a, b)
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
/* Tarjeta de los partidos de HOY, para mandar al grupo por la mañana.

   Cada fila lleva los escudos de los dos equipos y, si tenemos foto de ese
   estadio (lib/estadios.js), la foto de fondo bajo un velo oscuro. Todo eso es
   OPCIONAL: si no hay foto, o un escudo no llega, la fila se dibuja igual.

   Cero predicciones y cero marcadores — esto circula por WhatsApp antes de que
   se juegue nada, así que incluirlos filtraría justo lo que la app protege
   con RLS.

   partidos: [{ home_team, away_team, kickoff_at, home_flag_url, away_flag_url,
   venue }] ya filtrados y ordenados. */
export async function renderPartidosDeHoyCard({ nombreQuiniela, partidos = [], horaDe }) {
  await esperarFuentes()

  /* Todas las imágenes en paralelo y con plazo: en serie, tres partidos con el
     CDN lento sumarían doce segundos antes de ver nada. */
  const recursos = await Promise.all(partidos.map(async (p) => ({
    local: await cargarImagen(p.home_flag_url),
    visita: await cargarImagen(p.away_flag_url),
    estadio: await cargarImagen(fotoDeEstadio(p.venue)),
  })))

  const ALTO_ITEM = 96
  const alto = ALTO_CABECERA + 30 + partidos.length * ALTO_ITEM + 96
  const escala = 2
  const canvas = document.createElement('canvas')
  canvas.width = ANCHO * escala
  canvas.height = alto * escala
  const ctx = canvas.getContext('2d')
  ctx.scale(escala, escala)

  ctx.fillStyle = FONDO
  ctx.fillRect(0, 0, ANCHO, alto)

  // Cabecera
  ctx.fillStyle = TEXTO
  ctx.font = "bold 46px 'Unbounded', system-ui, sans-serif"
  ctx.textBaseline = 'alphabetic'
  ctx.fillText('Partidos de hoy', MARGEN, 66)

  ctx.fillStyle = TEAL
  ctx.font = "600 26px 'Archivo', system-ui, sans-serif"
  ctx.fillText(recortar(ctx, nombreQuiniela || '', ANCHO - MARGEN * 2), MARGEN, 100)

  const fecha = new Date().toLocaleDateString('es-CR', {
    weekday: 'long', day: 'numeric', month: 'long',
  })
  ctx.fillStyle = MUTED
  ctx.font = "500 22px 'Archivo', system-ui, sans-serif"
  const anchoFecha = ctx.measureText(fecha).width
  ctx.fillText(fecha, ANCHO - MARGEN - anchoFecha, 66)

  let y = ALTO_CABECERA + 24

  if (partidos.length === 0) {
    ctx.fillStyle = MUTED
    ctx.font = "600 30px 'Archivo', system-ui, sans-serif"
    ctx.fillText('Hoy no se juega nada', MARGEN, y + 44)
  }

  const ALTO_FILA = ALTO_ITEM - 12
  const ANCHO_FILA = ANCHO - MARGEN * 2
  const LADO_ESCUDO = 38

  partidos.forEach((p, i) => {
    const { local, visita, estadio } = recursos[i]

    // Fondo de la fila, recortado a las esquinas redondeadas.
    ctx.save()
    ctx.beginPath()
    ctx.roundRect(MARGEN, y, ANCHO_FILA, ALTO_FILA, 16)
    ctx.clip()
    ctx.fillStyle = '#161616'
    ctx.fillRect(MARGEN, y, ANCHO_FILA, ALTO_FILA)
    if (estadio) {
      dibujarCubriendo(ctx, estadio, MARGEN, y, ANCHO_FILA, ALTO_FILA)
      /* Velo oscuro EN DEGRADADO, no plano. Un velo parejo obliga a elegir
         entre que se lea el texto o que se vea la foto: al 78% las fotos
         diurnas o con reflectores dejaban el nombre de los equipos en blanco
         sobre verde claro, casi ilegible — comprobado dibujando la tarjeta.
         Así va bien oscuro sobre la mitad izquierda, que es donde vive el
         texto, y se abre hacia la derecha, donde la foto se ve sin estorbar.
         Importa de verdad: WhatsApp comprime la imagen y mucha gente la ve
         primero como miniatura. */
      const velo = ctx.createLinearGradient(MARGEN, 0, MARGEN + ANCHO_FILA, 0)
      velo.addColorStop(0, 'rgba(12,12,12,.93)')
      velo.addColorStop(0.62, 'rgba(12,12,12,.86)')
      velo.addColorStop(1, 'rgba(12,12,12,.60)')
      ctx.fillStyle = velo
      ctx.fillRect(MARGEN, y, ANCHO_FILA, ALTO_FILA)
    }
    ctx.restore()

    ctx.strokeStyle = BORDE
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.roundRect(MARGEN, y, ANCHO_FILA, ALTO_FILA, 16)
    ctx.stroke()

    const medio = y + ALTO_FILA / 2

    // La hora, en su propia pastilla para que se lea de un vistazo.
    const hora = horaDe ? horaDe(p.kickoff_at) : ''
    ctx.font = "bold 24px 'JetBrains Mono', monospace"
    const anchoHora = ctx.measureText(hora).width
    rect(ctx, MARGEN + 20, medio - 19, anchoHora + 28, 38, 12, 'rgba(46,211,183,.14)')
    ctx.fillStyle = TEAL
    ctx.fillText(hora, MARGEN + 34, medio + 8)

    // Equipos: [escudo] Local  vs  [escudo] Visita
    let x = MARGEN + 20 + anchoHora + 28 + 24
    const finEquipos = ANCHO - MARGEN - 20

    ctx.font = "600 28px 'Archivo', system-ui, sans-serif"
    const anchoVs = ctx.measureText('vs').width
    /* El espacio sobrante se reparte entre los dos nombres. Los escudos ocupan
       lugar aunque falten, para que las filas queden alineadas entre sí
       tenga foto o no. */
    const fijo = (LADO_ESCUDO + 10) * 2 + anchoVs + 36
    const porNombre = Math.max(60, (finEquipos - x - fijo) / 2)

    const equipo = (nombre, escudo) => {
      if (escudo) dibujarEscudo(ctx, escudo, x, medio - LADO_ESCUDO / 2, LADO_ESCUDO)
      x += LADO_ESCUDO + 10
      ctx.fillStyle = TEXTO
      ctx.font = "600 28px 'Archivo', system-ui, sans-serif"
      const texto = recortar(ctx, nombre || '?', porNombre)
      ctx.fillText(texto, x, medio + 9)
      x += ctx.measureText(texto).width
    }

    equipo(p.home_team, local)
    x += 18
    ctx.fillStyle = MUTED
    ctx.font = "600 28px 'Archivo', system-ui, sans-serif"
    ctx.fillText('vs', x, medio + 9)
    x += anchoVs + 18
    equipo(p.away_team, visita)

    y += ALTO_ITEM
  })

  // Pie
  ctx.fillStyle = MUTED
  ctx.font = "500 22px 'Archivo', system-ui, sans-serif"
  ctx.fillText('Cada partido cierra 15 min antes del saque', MARGEN, alto - 40)

  ctx.fillStyle = ORO
  ctx.font = "bold 22px 'JetBrains Mono', monospace"
  const marca = 'TICO GAMES'
  ctx.fillText(marca, ANCHO - MARGEN - ctx.measureText(marca).width, alto - 40)

  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo generar la imagen'))), 'image/png')
  })
}

/* Tarjeta de la TABLA de la quiniela, para mandar al grupo.

   Es la que más se pantallea: en una quiniela por plata, la tabla es el
   marcador. Por eso el top 3 va en podio —con la foto de cada quien— y el
   resto en filas compactas: quien la abre en el chat quiere ver primero quién
   va ganando, no leer una lista de 17.

   filas: las mismas que pinta StandingsTab, tal cual salen de league_table
   ({ pos, display_name, avatar_url, points, exactos, aciertos }). */
export async function renderTablaCard({ nombreQuiniela, filas = [], subtitulo }) {
  await esperarFuentes()

  const podio = filas.slice(0, 3)
  const resto = filas.slice(3)
  /* Dónde empieza el podio. Tiene que dejar sitio para la foto del primero,
     que sobresale por encima de su pilar: con menos, se montaba encima del
     subtítulo. */
  const Y_PODIO = 236
  const ALTO_PODIO = 296
  const ALTO_R = 56
  const alto = Y_PODIO + ALTO_PODIO + resto.length * ALTO_R + 96

  const escala = 2
  const canvas = document.createElement('canvas')
  canvas.width = ANCHO * escala
  canvas.height = alto * escala
  const ctx = canvas.getContext('2d')
  ctx.scale(escala, escala)
  ctx.fillStyle = FONDO
  ctx.fillRect(0, 0, ANCHO, alto)

  // Las fotos de perfil, todas a la vez y sin que ninguna sea obligatoria.
  const caras = await Promise.all(filas.slice(0, 3).map((f) => cargarImagen(f.avatar_url)))

  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  ctx.fillStyle = MUTED
  ctx.font = "bold 24px 'JetBrains Mono', monospace"
  ctx.letterSpacing = '4px'
  ctx.fillText((nombreQuiniela || '').toUpperCase(), MARGEN, 74)
  ctx.letterSpacing = '0px'

  ctx.fillStyle = TEXTO
  ctx.font = "bold 56px 'Unbounded', sans-serif"
  ctx.fillText('Tabla', MARGEN, 140)

  if (subtitulo) {
    ctx.fillStyle = MUTED
    ctx.font = "22px 'Archivo', sans-serif"
    ctx.fillText(subtitulo, MARGEN, 176)
  }

  // ── Podio ──
  const COLORES = [ORO, '#C7CDD6', CORAL]
  // Alturas distintas para que el primero se lea de un vistazo: el orden se
  // entiende por la forma antes que por el número.
  const ALTURAS = [150, 118, 96]
  const ORDEN = [1, 0, 2]           // plata, oro, bronce: el oro al centro
  const anchoP = (ANCHO - MARGEN * 2 - 24) / 3
  const yBase = Y_PODIO + ALTO_PODIO - 44

  ORDEN.forEach((idx, col) => {
    const f = podio[idx]
    if (!f) return
    const x = MARGEN + col * (anchoP + 12)
    const h = ALTURAS[idx]
    const color = COLORES[idx]

    // Foto (o inicial) sobre el pilar.
    const lado = 76
    const cx = x + anchoP / 2
    const cy = yBase - h - lado / 2 - 46
    ctx.save()
    ctx.beginPath()
    ctx.arc(cx, cy, lado / 2, 0, Math.PI * 2)
    ctx.clip()
    if (caras[idx]) {
      dibujarCubriendo(ctx, caras[idx], cx - lado / 2, cy - lado / 2, lado, lado)
    } else {
      ctx.fillStyle = '#2a2a2a'
      ctx.fillRect(cx - lado / 2, cy - lado / 2, lado, lado)
      ctx.fillStyle = TEXTO
      ctx.font = "bold 32px 'Archivo', sans-serif"
      ctx.textAlign = 'center'
      ctx.fillText((f.display_name?.[0] || '?').toUpperCase(), cx, cy + 11)
    }
    ctx.restore()
    ctx.strokeStyle = color
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(cx, cy, lado / 2, 0, Math.PI * 2)
    ctx.stroke()

    ctx.textAlign = 'center'
    ctx.fillStyle = TEXTO
    ctx.font = "700 24px 'Archivo', sans-serif"
    ctx.fillText(recortar(ctx, f.display_name || '', anchoP - 8), cx, yBase - h - 16)

    rect(ctx, x, yBase - h, anchoP, h, 12, 'rgba(255,255,255,.05)')
    ctx.fillStyle = color
    ctx.font = "bold 44px 'JetBrains Mono', monospace"
    ctx.fillText(String(f.points ?? 0), cx, yBase - h + 54)
    ctx.fillStyle = MUTED
    ctx.font = "bold 20px 'JetBrains Mono', monospace"
    ctx.fillText(`${idx + 1}°`, cx, yBase - 18)
  })

  // ── Resto ──
  let y = Y_PODIO + ALTO_PODIO + 8
  resto.forEach((f, i) => {
    if (i % 2 === 0) rect(ctx, MARGEN, y, ANCHO - MARGEN * 2, ALTO_R - 6, 10, 'rgba(255,255,255,.03)')
    ctx.textAlign = 'left'
    ctx.fillStyle = MUTED
    ctx.font = "bold 22px 'JetBrains Mono', monospace"
    ctx.fillText(String(f.pos ?? i + 4), MARGEN + 14, y + 34)

    ctx.fillStyle = TEXTO
    ctx.font = "600 25px 'Archivo', sans-serif"
    ctx.fillText(recortar(ctx, f.display_name || '', 520), MARGEN + 70, y + 34)

    // Exactos y aciertos: es el desempate oficial, y explica por qué alguien
    // con los mismos puntos está más arriba.
    ctx.textAlign = 'right'
    ctx.fillStyle = MUTED
    ctx.font = "20px 'JetBrains Mono', monospace"
    ctx.fillText(`${f.exactos ?? 0} ex · ${f.aciertos ?? 0} ac`, ANCHO - MARGEN - 110, y + 34)

    ctx.fillStyle = TEAL
    ctx.font = "bold 28px 'JetBrains Mono', monospace"
    ctx.fillText(String(f.points ?? 0), ANCHO - MARGEN - 16, y + 34)
    y += ALTO_R
  })

  ctx.textAlign = 'left'
  ctx.fillStyle = MUTED
  ctx.font = "500 22px 'Archivo', sans-serif"
  ctx.fillText(`${filas.length} jugador${filas.length === 1 ? '' : 'es'}`, MARGEN, alto - 40)

  ctx.textAlign = 'right'
  ctx.fillStyle = ORO
  ctx.font = "bold 22px 'JetBrains Mono', monospace"
  ctx.fillText('TICO GAMES', ANCHO - MARGEN, alto - 40)

  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo generar la imagen'))), 'image/png')
  })
}

/* Tarjeta personal: "mi temporada" en esta quiniela.

   Pensada para que cada quien la mande al grupo. Por eso muestra los números
   de los que uno presume —puesto, exactos, jornadas ganadas, el mejor
   partido— y no un volcado de todo lo que sabemos de la persona.

   p: lo que devuelve perfil_en_quiniela(), tal cual. */
export async function renderMiTemporadaCard({ nombreQuiniela, p }) {
  await esperarFuentes()

  const conMejor = Boolean(p?.mejor_partido)
  const conRacha = (p?.racha_actual ?? 0) >= 2 || (p?.mejor_racha ?? 0) >= 2
  /* El alto sale del contenido, no de un número fijo: a quien no tiene racha
     ni mejor partido —alguien que acaba de entrar— le quedaba media tarjeta
     en negro. */
  const alto = 418 + (conRacha ? 86 : 0) + (conMejor ? 128 : 0) + 72
  const escala = 2
  const canvas = document.createElement('canvas')
  canvas.width = ANCHO * escala
  canvas.height = alto * escala
  const ctx = canvas.getContext('2d')
  ctx.scale(escala, escala)
  ctx.fillStyle = FONDO
  ctx.fillRect(0, 0, ANCHO, alto)

  const cara = await cargarImagen(p?.avatar_url)

  // ── Cabecera: foto, nombre y puesto ──
  const lado = 120
  const cx = MARGEN + lado / 2
  const cy = 116
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, lado / 2, 0, Math.PI * 2)
  ctx.clip()
  if (cara) {
    dibujarCubriendo(ctx, cara, cx - lado / 2, cy - lado / 2, lado, lado)
  } else {
    ctx.fillStyle = '#2a2a2a'
    ctx.fillRect(cx - lado / 2, cy - lado / 2, lado, lado)
    ctx.fillStyle = TEXTO
    ctx.font = "bold 52px 'Archivo', sans-serif"
    ctx.textAlign = 'center'
    ctx.fillText((p?.display_name?.[0] || '?').toUpperCase(), cx, cy + 18)
  }
  ctx.restore()
  ctx.strokeStyle = TEAL
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.arc(cx, cy, lado / 2, 0, Math.PI * 2)
  ctx.stroke()

  const xTexto = MARGEN + lado + 28
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = MUTED
  ctx.font = "bold 20px 'JetBrains Mono', monospace"
  ctx.letterSpacing = '3px'
  ctx.fillText((nombreQuiniela || '').toUpperCase(), xTexto, 78)
  ctx.letterSpacing = '0px'

  ctx.fillStyle = TEXTO
  ctx.font = "bold 46px 'Unbounded', sans-serif"
  ctx.fillText(recortar(ctx, p?.display_name || '', ANCHO - xTexto - MARGEN), xTexto, 132)

  ctx.fillStyle = MUTED
  ctx.font = "24px 'Archivo', sans-serif"
  ctx.fillText(`${p?.pos ?? '?'}º de ${p?.miembros ?? '?'}`, xTexto, 168)

  // ── Los cuatro números ──
  const datos = [
    ['PUNTOS', String(p?.puntos ?? 0), TEAL],
    ['EXACTOS', String(p?.exactos ?? 0), TEXTO],
    ['ACIERTOS', String(p?.aciertos ?? 0), TEXTO],
    ['JORNADAS', String(p?.jornadas_ganadas ?? 0), ORO],
  ]
  const anchoD = (ANCHO - MARGEN * 2 - 36) / 4
  const yD = 228
  datos.forEach(([etiqueta, valor, color], i) => {
    const x = MARGEN + i * (anchoD + 12)
    rect(ctx, x, yD, anchoD, 148, 14, 'rgba(255,255,255,.04)')
    ctx.textAlign = 'center'
    ctx.fillStyle = color
    ctx.font = "bold 58px 'JetBrains Mono', monospace"
    ctx.fillText(valor, x + anchoD / 2, yD + 88)
    ctx.fillStyle = MUTED
    ctx.font = "bold 17px 'JetBrains Mono', monospace"
    ctx.letterSpacing = '2px'
    ctx.fillText(etiqueta, x + anchoD / 2, yD + 122)
    ctx.letterSpacing = '0px'
  })

  // ── Racha, solo si hay algo que contar ──
  let y = yD + 190
  ctx.textAlign = 'left'
  if (p?.racha_actual >= 2) {
    rect(ctx, MARGEN, y, ANCHO - MARGEN * 2, 66, 14, 'rgba(46,211,183,.10)')
    ctx.fillStyle = TEAL
    ctx.font = "600 28px 'Archivo', sans-serif"
    ctx.fillText(`En racha: ${p.racha_actual} jornadas seguidas puntuando`, MARGEN + 24, y + 42)
    y += 86
  } else if (p?.mejor_racha >= 2) {
    rect(ctx, MARGEN, y, ANCHO - MARGEN * 2, 66, 14, 'rgba(255,255,255,.04)')
    ctx.fillStyle = MUTED
    ctx.font = "600 28px 'Archivo', sans-serif"
    ctx.fillText(`Mejor racha: ${p.mejor_racha} jornadas`, MARGEN + 24, y + 42)
    y += 86
  }

  // ── El mejor partido ──
  if (conMejor) {
    const m = p.mejor_partido
    rect(ctx, MARGEN, y, ANCHO - MARGEN * 2, 128, 14, 'rgba(232,183,90,.09)')
    ctx.fillStyle = ORO
    ctx.font = "bold 18px 'JetBrains Mono', monospace"
    ctx.letterSpacing = '2px'
    ctx.fillText('SU MEJOR PARTIDO', MARGEN + 24, y + 34)
    ctx.letterSpacing = '0px'

    ctx.fillStyle = TEXTO
    ctx.font = "600 30px 'Archivo', sans-serif"
    ctx.fillText(recortar(ctx, `${m.local} vs ${m.visita}`, ANCHO - MARGEN * 2 - 200), MARGEN + 24, y + 76)

    ctx.fillStyle = MUTED
    ctx.font = "24px 'Archivo', sans-serif"
    ctx.fillText(`predijo ${m.prediccion} · quedó ${m.marcador}`, MARGEN + 24, y + 110)

    ctx.textAlign = 'right'
    ctx.fillStyle = ORO
    ctx.font = "bold 52px 'JetBrains Mono', monospace"
    ctx.fillText(`+${m.puntos}`, ANCHO - MARGEN - 24, y + 88)
  }

  ctx.textAlign = 'right'
  ctx.fillStyle = ORO
  ctx.font = "bold 22px 'JetBrains Mono', monospace"
  ctx.fillText('TICO GAMES', ANCHO - MARGEN, alto - 36)

  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo generar la imagen'))), 'image/png')
  })
}

export async function compartirImagen(blob, nombreArchivo, titulo, texto) {
  const file = new File([blob], nombreArchivo, { type: 'image/png' })

  /* Se intenta primero con texto de acompañante: WhatsApp lo pone de pie de
     foto, y ahí viaja el enlace a la app — que una imagen sola no puede
     llevar, porque nadie va a teclear una URL que ve en una foto.
     No todos los navegadores aceptan archivo + texto en la misma llamada, así
     que si rechazan esa forma se manda solo la imagen antes de rendirse. */
  const intentos = texto
    ? [{ files: [file], title: titulo, text: texto }, { files: [file], title: titulo }]
    : [{ files: [file], title: titulo }]

  for (const carga of intentos) {
    if (!navigator.canShare?.(carga)) continue
    try {
      await navigator.share(carga)
      return 'compartido'
    } catch (err) {
      // El usuario canceló la hoja de compartir: no es un error que mostrar.
      if (err?.name === 'AbortError') return 'cancelado'
      // Otro fallo: probar la forma siguiente y, si no queda, descargar.
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
