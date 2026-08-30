/* Fotos de fondo por estadio, para la tarjeta de los partidos del día.

   POR QUÉ UN MAPA A MANO Y NO UN CAMPO EN LA BASE: ESPN da el NOMBRE del
   estadio, nunca una foto. Las fotos hay que conseguirlas y alojarlas
   nosotros, y son un puñado que casi no cambia — un archivo en el repo se
   entiende de un vistazo y no necesita migración ni panel de admin.

   CÓMO AGREGAR UNA:
   1. Poné la imagen en `frontend/public/estadios/` (jpg, ~1200px de ancho,
      comprimida: entra en un PNG que va por WhatsApp, no hace falta más).
   2. Agregá la entrada acá abajo con el nombre normalizado como llave.
   3. Usá solo fotos que tengas derecho a usar. Esto se manda a un grupo y
      queda en los teléfonos de la gente.

   Mientras un estadio no esté acá, su fila se dibuja con el fondo sólido de
   siempre. Eso es a propósito: la tarjeta nunca depende de tener la foto. */

const FOTOS = {
  // 'estadio ricardo saprissa ayma': '/estadios/saprissa.jpg',
  // 'estadio alejandro morera soto': '/estadios/morera-soto.jpg',
  // 'estadio jose rafael fello meza': '/estadios/fello-meza.jpg',
}

/* Normaliza para que "Estadio Ricardo Saprissa Aymá" y
   "ESTADIO RICARDO SAPRISSA AYMA" den la misma llave: quita tildes, baja a
   minúsculas y colapsa espacios. Las fuentes escriben el mismo estadio de
   varias formas y sin esto no encontraríamos ninguna foto. */
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
  return FOTOS[normalizarEstadio(nombre)] ?? null
}
