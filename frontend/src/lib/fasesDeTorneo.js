/* Los nombres de las fases, en un solo lugar.

   NO SON ETIQUETAS DECORATIVAS. En la liga tica y en la Champions las
   eliminatorias llegan con la fase genérica y la clave del cupo de ×2 ES LA
   ETIQUETA: `clave_fase` (migración 72) toma `matches.stage` y lo recorta en
   ' · ' ('Octavos · Ida' -> 'Octavos'). Si el nombre que guarda el admin no
   coincide EXACTO con el que escribe el sync, el cupo se guarda, la pantalla
   dice «listo» y el trigger sigue usando el número fijo. Nadie se entera
   hasta que alguien cuenta sus comodines en mitad de una final — el mismo
   fallo silencioso por el que se quitó la tabla `powerup_limits` en la
   migración 48.

   Ya pasó: se sugerían «Semis» y «Play-offs»; el sync escribe «Semifinal» y
   «Repechaje». `fasesDeTorneo.test.js` lee `_STAGE_KEYS` del sync y falla si
   las dos listas se separan. */

/* Etiquetas literales de `_STAGE_KEYS`
   (`backend/app/services/espn_tournament_sync.py`), sin las regulares:
   «Fase de grupos» y «Fase de liga» van a `phase = 'groups'`, y su clave es
   'groups' — la fila que la pantalla ya muestra sola.
   Van en orden de avance del torneo, no alfabético: es como las piensa
   quien configura («primero el repechaje, al final la final»). */
export const SUGERENCIAS = [
  'Repechaje', 'Dieciseisavos', 'Octavos', 'Cuartos', 'Semifinal',
  'Tercer puesto', 'Final', 'Gran final', 'Liguilla', 'Eliminatoria',
]

/* LAS RONDAS QUE JUEGA CADA TORNEO, por su `external_ref` de ESPN.

   POR QUÉ NO SE OFRECEN TODAS SIEMPRE: la liga tica no tiene octavos ni
   dieciseisavos, y la Champions no tiene gran final ni liguilla. Ofrecerlas
   invita a configurar un cupo que nunca se va a aplicar — y eso no da error,
   simplemente no pasa nada, que es el peor modo de fallo de esta pantalla.

   EL ORDEN ES EL DEL TORNEO, no alfabético: es como lo piensa quien configura.

   Los formatos salen del reglamento y están comprobados contra lo que ESPN
   publica de verdad (`backend/tests/test_fases_reales.py`):
     · crc.1          10 equipos, 18 jornadas, luego semis (1-4, 2-3), final
                      y gran final SOLO si el líder no gana la final.
     · uefa.champions 36 equipos, 8 jornadas de fase de liga; los 8 primeros
                      pasan directo a octavos y del 9º al 24º juegan repechaje.
     · esp.1/eng.1    liga pura: no hay eliminatoria, así que no hay nada que
                      sugerir.
     · fifa.world     el Mundial trae la ronda en la propia `phase`, así que
                      sus filas salen solas y no hace falta agregarlas a mano.

   NO ES UNA LISTA CERRADA: `SUGERENCIAS` sigue disponible detrás de «ver
   todas», y el campo de texto acepta cualquier nombre. Un formato que cambie
   —pasa— no puede dejar a nadie sin poder configurar su torneo. */
export const FASES_POR_TORNEO = {
  'crc.1': ['Semifinal', 'Final', 'Gran final'],
  'uefa.champions': ['Repechaje', 'Octavos', 'Cuartos', 'Semifinal', 'Final'],
  'esp.1': [],
  'eng.1': [],
  'fifa.world': [],
}

/** Rondas a sugerir para un torneo. Un torneo desconocido recibe la lista
 *  completa: es preferible ofrecer de más que dejar a alguien sin su ronda. */
export function sugerenciasPara (ref) {
  const propias = FASES_POR_TORNEO[ref]
  return propias === undefined ? SUGERENCIAS : propias
}

/** ¿Sabemos qué juega este torneo? Sirve para decidir si vale la pena ofrecer
 *  el «ver todas»: en un torneo desconocido ya se están viendo todas. */
export const formatoConocido = (ref) => FASES_POR_TORNEO[ref] !== undefined

/* Fases del sync que NO son eliminatoria. Su clave de cupo es 'groups'. */
export const FASES_REGULARES = ['Fase de grupos', 'Fase de liga']

/* Claves que no son etiquetas sino `phase` a secas: el Mundial trae la ronda
   en la propia fase, así que su clave es 'round_of_16' y no un texto. */
const NOMBRES = {
  groups: 'Jornadas regulares',
  knockout: 'Eliminatoria (sin fase definida)',
  round_of_32: 'Dieciseisavos',
  round_of_16: 'Octavos',
  quarter_finals: 'Cuartos',
  semi_finals: 'Semifinales',
  third_place: 'Tercer puesto',
  final: 'Final',
}

/** Nombre legible de una clave de cupo. Una clave desconocida se muestra tal
 *  cual: es lo que el admin escribió y lo que la base va a comparar. */
export const nombreDeFase = (clave) => NOMBRES[clave] || clave
