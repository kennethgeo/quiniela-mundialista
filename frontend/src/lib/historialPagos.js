/* Historial de pagos de una quiniela (migración 109).

   Hasta la 109 el pago eran columnas de `league_members`: «quitar» un pago lo
   dejaba en NULL sin rastro y expulsar a quien pagó borraba la fila entera.
   Ahora cada confirmación, cada «quitar» y cada borrado de un pago confirmado
   deja una fila en `historial_pagos`, que nadie puede editar ni borrar. Esto
   solo arma el texto: la base es la que anota. */

export const plata = (n, moneda) => {
  const v = Number(n || 0)
  const txt = v.toLocaleString('es-CR', { maximumFractionDigits: 0 })
  return moneda === 'USD' ? `$${txt}` : `₡${txt}`
}

const fecha = (iso) => {
  if (!iso) return ''
  // Costa Rica es UTC-6 todo el año: la fecha no depende de dónde esté el teléfono.
  return new Date(iso).toLocaleString('es-CR', {
    timeZone: 'America/Costa_Rica', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

/* `nombres` es un mapa user_id → display_name de la gente que hoy está en la
   quiniela. Quien ya no está (lo expulsaron) no figura: se dice así en vez de
   mostrar un id. `por` NULL es el backend o el panel de la base. */
export function describirMovimiento(fila, nombres = {}) {
  const persona = nombres[fila.user_id] || 'alguien que ya no está en la quiniela'
  const autor = fila.por ? (nombres[fila.por] || 'un admin que ya no está') : 'el sistema'
  const monto = fila.monto != null ? plata(fila.monto, fila.moneda) : null
  let texto
  if (fila.accion === 'confirmado') texto = `${autor} confirmó el pago de ${persona}`
  else if (fila.accion === 'quitado') texto = `${autor} quitó el pago confirmado de ${persona}`
  else if (fila.accion === 'borrado') texto = `${autor} sacó de la quiniela a ${persona}, que tenía el pago confirmado`
  else texto = `${persona}: ${fila.accion}`
  return {
    texto,
    monto,
    cuando: fecha(fila.created_at),
    nota: fila.sembrada ? 'confirmado antes de que existiera el historial' : null,
  }
}
