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
   'groups' — la fila que la pantalla ya muestra sola. */
export const SUGERENCIAS = [
  'Octavos', 'Cuartos', 'Semifinal', 'Tercer puesto', 'Final',
  'Liguilla', 'Repechaje', 'Eliminatoria',
]

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
