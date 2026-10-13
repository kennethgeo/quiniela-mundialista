/* ¿Este partido puede terminar en penales? Decide si se pregunta «quién pasa».

   Antes bastaba con `phase !== 'groups'`, porque las únicas eliminatorias eran
   las del Mundial, a partido único. En la postemporada de la liga tica y en la
   Champions las series son de ida y vuelta, y la IDA llega también con
   `phase = 'knockout'`: a quien predecía un empate en una ida se le bloqueaba
   «Guardar» hasta elegir quién pasaba por penales. En una ida no hay tanda,
   esa elección no puntúa nunca (el motor solo suma el +1 con
   goes_to_penalties) y la persona podía creer que su ×2 dependía de eso.

   La pierna viene en `matches.stage`, después del « · » que agrega el sync:
   «Semifinal · Ida». Las filas escritas antes de traducir la nota de ESPN
   dicen «Semifinal · 1st Leg - …»: también cuentan como ida. Un partido sin
   pierna (una final única, o los del Mundial, con `stage` nulo) y la vuelta
   sí pueden ir a penales.

   Vive aparte para que la usen igual la tarjeta (MatchCard) y el lote de la
   jornada (PredecirJornada), y para poder probarla sin Supabase. */

export function esIda(match) {
  const stage = match?.stage || ''
  return /(^|·)\s*ida\b/i.test(stage) || /\b1st leg\b/i.test(stage)
}

export function puedeIrAPenales(match) {
  return !!match && match.phase !== 'groups' && !esIda(match)
}

/* Lo que se guarda en `penalties_winner_pred`: la elección solo vale si el
   partido puede ir a penales Y se predijo un empate. En cualquier otro caso,
   null — también si quedó una elección vieja de antes (una ida guardada
   cuando todavía se pedía). */
export function tandaQueSeGuarda(match, golesLocal, golesVisita, eleccion) {
  if (!puedeIrAPenales(match)) return null
  if (golesLocal == null || golesLocal !== golesVisita) return null
  return eleccion || null
}
