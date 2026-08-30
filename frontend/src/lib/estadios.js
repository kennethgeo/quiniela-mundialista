/* Fotos de fondo por estadio, para la tarjeta de los partidos del día.

   POR QUÉ UN ARCHIVO A MANO Y NO UN CAMPO EN LA BASE: ESPN da el NOMBRE del
   estadio, nunca una foto. Las fotos hay que conseguirlas y alojarlas
   nosotros, y son un puñado que casi no cambia — un archivo en el repo se
   entiende de un vistazo y no necesita migración ni panel de admin.

   SE EMPAREJA POR TROZO DEL NOMBRE, NO POR NOMBRE COMPLETO. La fuente escribe
   el mismo estadio de muchas formas ("Estadio Ricardo Saprissa Aymá",
   "Ricardo Saprissa", "Estadio Ricardo Saprissa Ayma") y encima puede
   cambiarlas sin avisar. Exigir el nombre exacto significaría quedarnos sin
   foto por una tilde. Las claves son trozos distintivos: 'saprissa' no aparece
   en el nombre de ningún otro estadio del país.

   CÓMO AGREGAR UNA:
   1. Poné la imagen en `frontend/public/estadios/` (jpg, ~1200px de ancho).
   2. Agregá la entrada acá abajo con una o más claves distintivas.
   3. Anotá autor y licencia en `public/estadios/CREDITOS.md`. Usá solo fotos
      que tengas derecho a usar: esto se manda a un grupo y queda en los
      teléfonos de la gente.

   Mientras un estadio no esté acá, su fila se dibuja con el fondo sólido de
   siempre. Eso es a propósito: la tarjeta nunca depende de tener la foto. */

const ESTADIOS = [
  { claves: ['saprissa'],                    foto: '/estadios/saprissa.jpg' },
  { claves: ['morera soto'],                 foto: '/estadios/morera-soto.jpg' },
  { claves: ['fello meza', 'rafael meza'],   foto: '/estadios/fello-meza.jpg' },
  { claves: ['rosabal cordero'],             foto: '/estadios/rosabal.jpg' },
  { claves: ['carlos ugalde'],               foto: '/estadios/carlos-ugalde.jpg' },
  { claves: ['baltodano'],                   foto: '/estadios/baltodano.jpg' },
  { claves: ['lito perez', 'miguel angel perez'], foto: '/estadios/lito-perez.jpg' },
  { claves: ['perez zeledon'],               foto: '/estadios/perez-zeledon.jpg' },
  { claves: ['nacional'],                    foto: '/estadios/nacional.jpg' },
  { claves: ['allen riggioni', 'grecia'],    foto: '/estadios/grecia.jpg' },
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
