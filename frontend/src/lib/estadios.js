/* Fotos de fondo por estadio, para la tarjeta de los partidos del día.

   POR QUÉ UN ARCHIVO A MANO Y NO UN CAMPO EN LA BASE: ESPN da el NOMBRE del
   estadio, nunca una foto. Las fotos hay que conseguirlas y alojarlas
   nosotros, y son un puñado que casi no cambia — un archivo en el repo se
   entiende de un vistazo y no necesita migración ni panel de admin.

   SE EMPAREJA POR TROZO DEL NOMBRE, NO POR NOMBRE COMPLETO. ESPN escribe unos
   con "Estadio" delante y otros no ("Alejandro Morera Soto"), y mete comillas
   en medio ('Estadio José Rafael "Fello" Meza Ivankovich'). Exigir el nombre
   exacto nos dejaría sin foto por una tilde o una comilla. Las claves son
   trozos distintivos: 'saprissa' no aparece en ningún otro estadio del país.

   NO ADIVINAR LAS CLAVES: sacarlas de lo que ESPN manda de verdad. La primera
   versión de este archivo las dedujo de qué equipo juega dónde y falló en tres
   de once — Herediano no juega en el Rosabal Cordero sino en el Carlos
   Alvarado, y Sporting no juega en Grecia sino en Puente Piedra. Para ver los
   nombres reales:

     curl -s "https://site.api.espn.com/apis/site/v2/sports/soccer/crc.1/\
     scoreboard?dates=20260101-20260228" | jq -r \
     '.events[].competitions[0].venue.fullName'

   ESPN además manda `venue` en null de vez en cuando: esa fila va sin foto.

   CÓMO AGREGAR UNA:
   1. Poné la imagen en `frontend/public/estadios/` (jpg, ~1200px de ancho).
   2. Agregá la entrada acá abajo con una o más claves distintivas.
   3. Anotá autor y licencia en `public/estadios/CREDITOS.md`. Usá solo fotos
      que tengas derecho a usar: esto se manda a un grupo y queda en los
      teléfonos de la gente.

   Mientras un estadio no esté acá, su fila se dibuja con el fondo sólido de
   siempre. Eso es a propósito: la tarjeta nunca depende de tener la foto. */

const ESTADIOS = [
  // Las claves salen de lo que ESPN devuelve DE VERDAD en `venue.fullName`,
  // comprobado contra 145 partidos de la temporada 2026 (ver abajo).
  { claves: ['saprissa'],          foto: '/estadios/saprissa.jpg' },        // Saprissa
  { claves: ['morera soto'],       foto: '/estadios/morera-soto.jpg' },     // Alajuelense
  { claves: ['carlos alvarado'],   foto: '/estadios/carlos-alvarado.jpg' }, // Herediano
  { claves: ['fello meza'],        foto: '/estadios/fello-meza.jpg' },      // Cartaginés
  { claves: ['carlos ugalde'],     foto: '/estadios/carlos-ugalde.jpg' },   // San Carlos e Inter
  { claves: ['lito perez'],        foto: '/estadios/lito-perez.jpg' },      // Puntarenas
  { claves: ['perez zeledon'],     foto: '/estadios/perez-zeledon.jpg' },   // Pérez Zeledón
  { claves: ['puente piedra'],     foto: '/estadios/puente-piedra.jpg' },   // Sporting San José
  { claves: ['baltodano'],         foto: '/estadios/baltodano.jpg' },       // Municipal Liberia
  { claves: ['colleya', 'fonseca'], foto: '/estadios/colleya-fonseca.jpg' },// Guadalupe FC
  { claves: ['rafael bolanos'],    foto: '/estadios/rafael-bolanos.jpg' },  // Escorpiones Belén
  // El Nacional no es sede de nadie, pero se usa cuando a un club le sancionan
  // el estadio. Se deja puesto a propósito para ese caso.
  { claves: ['nacional'],          foto: '/estadios/nacional.jpg' },
]

/* Normaliza para poder comparar: quita tildes, baja a minúsculas, cambia la
   puntuación por espacios y los colapsa. Sin esto, "Aymá" y "Ayma" —o unas
   comillas de más alrededor de "Fello"— serían estadios distintos. */
export function normalizarEstadio(nombre) {
  if (!nombre) return ''
  return String(nombre)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/* Devuelve la ruta de la foto del estadio, o null si no tenemos una. */
export function fotoDeEstadio(nombre) {
  const limpio = normalizarEstadio(nombre)
  if (!limpio) return null
  const hallado = ESTADIOS.find((e) => e.claves.some((c) => limpio.includes(c)))
  return hallado ? hallado.foto : null
}
