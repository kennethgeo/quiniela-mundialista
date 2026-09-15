/* Qué posiciones clasifican en cada torneo.

   POR QUÉ UN MAPA Y NO UN NÚMERO: el corte no es el mismo en ningún lado. En
   la liga tica pasan CUATRO (se juegan dos semifinales); en la fase de liga de
   la Champions los ocho primeros van directo a octavos y del 9 al 24 juegan un
   repechaje; en un grupo del Mundial pasan dos y el tercero depende de cómo
   queden los demás grupos. Pintar «los 4 primeros» en todos sería mentir en
   tres de cada cuatro pantallas.

   UN TORNEO QUE NO ESTÁ ACÁ NO RECIBE NINGUNA LÍNEA. Es a propósito: una liga
   como LaLiga o la Premier no tiene liguilla, y sus cupos europeos cambian de
   temporada en temporada y dependen de la copa. Inventar un corte donde no lo
   hay es peor que no dibujarlo — alguien lo leería como que su equipo está
   clasificando.

   De dónde salen los números:
     · crc.1          -> `…---playoff-semifinals` trae DOS series (comprobado
                         en backend/tests/test_fases_reales.py), o sea 4 equipos.
     · uefa.champions -> la fase de liga son 36 equipos; los slugs que publica
                         ESPN son `knockout-round-playoffs` y `round-of-16`,
                         que es el formato 8 directos + 16 al repechaje.
     · fifa.world     -> dos por grupo, más los mejores terceros, que es justo
                         lo que resuelve `bracketResolver.js`. */

export const ZONAS_POR_TORNEO = {
  'crc.1': [
    { hasta: 4, etiqueta: 'Liguilla', tono: 'clasifica' },
  ],
  'uefa.champions': [
    { hasta: 8, etiqueta: 'Octavos', tono: 'clasifica' },
    { hasta: 24, etiqueta: 'Repechaje', tono: 'repesca' },
  ],
  'fifa.world': [
    { hasta: 2, etiqueta: 'Clasifica', tono: 'clasifica' },
    { hasta: 3, etiqueta: 'Mejor tercero', tono: 'repesca' },
  ],
}

/** La zona de una posición, o null si ese torneo no tiene corte conocido. */
export function zonaDe (torneoRef, posicion) {
  const zonas = ZONAS_POR_TORNEO[torneoRef]
  if (!zonas || !posicion) return null
  return zonas.find((z) => posicion <= z.hasta) || null
}

/** Las zonas de un torneo, para dibujar la leyenda. Vacío si no hay corte. */
export function zonasDe (torneoRef) {
  return ZONAS_POR_TORNEO[torneoRef] || []
}

/** ¿Esta fila es la última de su zona? Es donde va la línea de corte.
 *
 *  Se compara contra el TOTAL de equipos: en un grupo del Mundial de 4, el
 *  corte del «mejor tercero» cae en el 3, pero dibujar una línea debajo del
 *  último equipo sería una raya al aire. */
export function esFinDeZona (torneoRef, posicion, totalEquipos) {
  const zona = zonaDe(torneoRef, posicion)
  if (!zona || posicion >= totalEquipos) return false
  return zonaDe(torneoRef, posicion + 1)?.etiqueta !== zona.etiqueta
}
