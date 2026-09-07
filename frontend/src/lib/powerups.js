/* La llave de una "bolsa" de cupo del comodín ×2.

   TIENE QUE SER LA MISMA QUE LA DE LA BASE. El trigger `check_powerup_limit`
   cuenta los ×2 gastados dentro de una bolsa y `cupo_powerups` elige el número
   de esa misma bolsa (migración 73: `llave_cupo` = clave de fase + jornada).
   Si acá se agrupara distinto, la pantalla diría "quedan 2" y la base
   rechazaría el segundo, o al revés — y en una quiniela por plata eso se
   discute a gritos.

   POR QUÉ NO BASTA (phase, matchday), QUE ES LO QUE SE USABA. En la liga tica
   y en la Champions TODA la eliminatoria llega con phase='knockout' y jornada
   nula, así que semifinales, final y gran final caían en la misma bolsa. En el
   Mundial no se notaba porque ahí cada ronda trae su propia `phase`.

   La regla es idéntica a `clave_fase(text,text)` en Postgres. Está escrita dos
   veces —una en SQL, otra acá— porque el navegador no puede llamar a la
   función para cada partido de una pantalla. `powerups.test.js` fija los mismos
   casos que verifica la migración 73; si alguien cambia una, la otra chilla. */

/** Clave de fase de un partido. Espejo exacto de `clave_fase` en Postgres. */
export function claveDeFase(phase, stage) {
  const f = phase || 'groups'
  if (f === 'groups') return 'groups'
  // 'knockout' es el comodín que pone el sync cuando la ronda viene solo en el
  // texto: ahí manda `stage`, recortado en ' · ' porque el cupo es de la RONDA
  // y no de cada partido ('Octavos · Ida' -> 'Octavos').
  if (f === 'knockout') return String(stage || '').split(' · ')[0] || 'knockout'
  // Cualquier otra fase (round_of_16, semi_finals, final…) es su propia clave.
  return f
}

/** Llave de la bolsa de cupo: clave de fase + jornada. */
export function powerupKey(phase, matchday, stage) {
  return `${claveDeFase(phase, stage)}|${matchday || 0}`
}

/** Igual, pero desde un partido completo. Es la forma preferible: así no se
 *  olvida `stage`, que es justo lo que faltaba antes. */
export const llaveDeCupo = (m) => powerupKey(m?.phase, m?.matchday, m?.stage)
