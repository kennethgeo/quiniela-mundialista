/* El pozo de una quiniela: qué estado tiene cada quien y qué montos ofrecer.

   La CUENTA la hace la base (`league_pozo`, migración 110): cuánto lleva cada
   persona, cuánto le falta, si está al día y los totales. Acá solo se arma lo
   que se muestra y lo que se ofrece tocar. Recalcular el pozo en el navegador
   sería la fórmula escrita dos veces, que es justo lo que este repo aprendió a
   no hacer.

   ANTES DE LA 110 el servidor no trae `al_dia`, `monto` ni `falta`: todo cae a
   lo de antes (pagó / avisó / pendiente, sin montos parciales), para que la
   pantalla no se rompa si el frontend llega antes que la migración. */
import { plata } from './historialPagos'

/** ¿El servidor ya sabe de abonos parciales? */
export const conAbonos = (pozo) => pozo != null && pozo.al_dia !== undefined

/** 'pagado' | 'parcial' | 'pendiente'. */
export function estadoDe (g) {
  if (g?.estado) return g.estado
  return g?.confirmado ? 'pagado' : 'pendiente'
}

/** Cuánto le falta a esta persona para la cuota. */
export function faltaDe (g, cuota) {
  if (g?.falta != null) return Number(g.falta)
  return estadoDe(g) === 'pagado' ? 0 : Number(cuota || 0)
}

/** Lo que lleva confirmado (0 si nada). */
export const montoDe = (g) => (g?.confirmado ? Number(g?.monto ?? 0) : 0)

/** El monto de un aviso: el que la persona escribió, o «lo que falta» si
 *  avisó con el botón de siempre (sin monto). */
export function montoDelAviso (g, cuota) {
  if (g?.aviso_monto != null) return Number(g.aviso_monto)
  return faltaDe(g, cuota)
}

/** Totales del encabezado, con o sin la 110. */
export function resumen (pozo) {
  const miembros = Number(pozo?.miembros || 0)
  const alDia = Number(pozo?.al_dia ?? pozo?.pagados ?? 0)
  const total = Number(pozo?.pozo_total || 0)
  const recaudado = Number(pozo?.recaudado || 0)
  const faltan = pozo?.faltan != null ? Number(pozo.faltan) : Math.max(total - recaudado, 0)
  const avance = total > 0 ? Math.min(recaudado / total, 1) : 0
  return { miembros, alDia, total, recaudado, faltan, avance }
}

/** Montos para elegir con un toque: todo lo que falta y, si cabe, la mitad
 *  de la cuota. Nunca más de lo que falta (la base lo rechazaría). */
export function opcionesDeMonto ({ cuota, falta }) {
  const c = Number(cuota || 0)
  const f = Number(falta || 0)
  if (f <= 0) return []
  const opciones = [{ clave: 'todo', etiqueta: f >= c ? 'La cuota completa' : 'Lo que falta', monto: f }]
  const mitad = Math.round(c * 50) / 100
  if (mitad > 0 && mitad < f) opciones.push({ clave: 'mitad', etiqueta: 'La mitad', monto: mitad })
  return opciones
}

/** Lee un monto escrito a mano. Devuelve { monto } o { error } con el texto
 *  que se le muestra a la persona. */
export function validarMonto (texto, falta, moneda) {
  const limpio = String(texto ?? '').trim()
  if (!limpio) return { error: 'Escribí cuánto se pagó' }
  const n = Number(limpio)
  if (!Number.isFinite(n) || n <= 0) return { error: 'Escribí un monto mayor que cero' }
  const redondo = Math.round(n * 100) / 100
  if (redondo > Number(falta || 0)) {
    return { error: `Falta ${plata(falta, moneda)}: no se puede poner más que eso` }
  }
  return { monto: redondo }
}

/** Texto corto de la etiqueta de estado, a la derecha del nombre. */
export function etiquetaDe (g, moneda) {
  const estado = estadoDe(g)
  if (estado === 'pagado') return { tipo: 'pagado', texto: 'pagó' }
  if (estado === 'parcial') return { tipo: 'parcial', texto: plata(montoDe(g), moneda) }
  if (g?.aviso) return { tipo: 'aviso', texto: 'avisó' }
  return { tipo: 'pendiente', texto: 'pendiente' }
}

/** La línea debajo del nombre: lo que no entra en la etiqueta. */
export function detalleDe (g, cuota, moneda) {
  const partes = []
  const estado = estadoDe(g)
  if (estado === 'parcial') {
    partes.push(`${plata(montoDe(g), moneda)} de ${plata(cuota, moneda)} · falta ${plata(faltaDe(g, cuota), moneda)}`)
  }
  if (g?.aviso && estado !== 'pagado') {
    partes.push(`avisó ${plata(montoDelAviso(g, cuota), moneda)} · falta confirmar`)
  }
  return partes.join(' · ')
}

/** El reparto de premios, listo para mostrar.
 *
 *  Puede venir en MONTOS fijos (lo que el grupo acordó de antemano, pedido del
 *  dueño del 13 oct 2026) o en PORCENTAJES sobre el pozo completo (lo de
 *  antes). La base no deja mezclarlos (migración 110). Un porcentaje se pasa
 *  a plata con el pozo completo; un monto se muestra tal cual.
 *
 *  `excede`: los montos suman más que el pozo completo. La base no lo impide
 *  —el pozo cambia con cada persona que entra o sale—, así que se avisa. */
export function repartoDe (pozo) {
  const total = Number(pozo?.pozo_total || 0)
  const crudo = Array.isArray(pozo?.reparto) ? pozo.reparto : []
  const modo = crudo.some((x) => x?.monto != null) ? 'montos' : 'porcentajes'
  const filas = crudo
    .map((x) => {
      const puesto = Number(x?.puesto)
      if (modo === 'montos') return { puesto, monto: Number(x?.monto || 0), porcentaje: null }
      const porcentaje = Number(x?.porcentaje || 0)
      return { puesto, monto: total * porcentaje / 100, porcentaje }
    })
    .filter((x) => x.puesto > 0 && x.monto > 0)
    .sort((a, b) => a.puesto - b.puesto)
  const suma = filas.reduce((s, x) => s + x.monto, 0)
  return { modo, filas, suma, total, excede: modo === 'montos' && total > 0 && suma > total }
}

/** Del editor a lo que guarda `set_league_pozo`. `valores` son los textos de
 *  cada fila, en orden: la fila i es el puesto i+1 (así no quedan puestos
 *  repetidos ni saltos al quitar uno). Las filas vacías del final se ignoran;
 *  una vacía en el medio es un error, porque dejaría un puesto sin premio
 *  entre dos que sí tienen. Devuelve { reparto } (null = sin reparto) o
 *  { error }. */
export function repartoParaGuardar (valores, modo) {
  const nums = (valores || []).map((v) => {
    const t = String(v ?? '').trim()
    return t === '' ? 0 : Number(t)
  })
  if (nums.some((n) => !Number.isFinite(n) || n < 0)) return { error: 'Cada puesto lleva un número mayor que cero' }
  let ultimo = nums.length - 1
  while (ultimo >= 0 && nums[ultimo] === 0) ultimo--
  const usados = nums.slice(0, ultimo + 1)
  const hueco = usados.findIndex((n) => n === 0)
  if (hueco !== -1) return { error: `El ${hueco + 1}º quedó sin ${modo === 'montos' ? 'monto' : 'porcentaje'}: completalo o quitalo` }
  if (!usados.length) return { reparto: null }
  if (modo === 'montos') {
    const montos = usados.map((n) => Math.round(n * 100) / 100)
    if (montos.some((m) => m <= 0 || m > 100000000)) return { error: 'Un monto está fuera de rango' }
    return { reparto: montos.map((monto, i) => ({ puesto: i + 1, monto })) }
  }
  if (usados.some((p) => p > 100)) return { error: 'Un porcentaje no puede pasar de 100' }
  const suma = usados.reduce((s, p) => s + p, 0)
  // 0.2 + 83.9 + 15.9 puede dar 100.00000000000001 en JavaScript.
  // El JSON conserva los valores originales; PostgreSQL los suma en numeric.
  if (suma - 100 > Number.EPSILON * 100 * usados.length) return { error: 'Los porcentajes suman más de 100' }
  return { reparto: usados.map((porcentaje, i) => ({ puesto: i + 1, porcentaje })) }
}

/** Al cambiar de montos a porcentajes (o al revés) en el editor, los valores
 *  se pasan a su equivalente con el pozo completo, para que el admin parta de
 *  lo que el grupo ya veía. Sin pozo (cuota 0) quedan vacíos. */
export function convertirReparto (valores, haciaModo, total) {
  const t = Number(total || 0)
  return (valores || []).map((v) => {
    const n = Number(String(v ?? '').trim())
    if (!t || !Number.isFinite(n) || n <= 0) return ''
    return haciaModo === 'montos'
      ? String(Math.round(t * n) / 100)
      : String(Math.round(n / t * 1000) / 10)
  })
}

/** Pie de foto de la imagen compartida: viaja con el enlace a la pestaña. */
export function textoParaCompartir (pozo, nombreQuiniela, url) {
  const r = resumen(pozo)
  const base = `Pozo de ${nombreQuiniela}: ${plata(r.recaudado, pozo?.moneda)} de ${plata(r.total, pozo?.moneda)}` +
    ` · ${r.alDia} de ${r.miembros} al día`
  return url ? `${base}\n${url}` : base
}
