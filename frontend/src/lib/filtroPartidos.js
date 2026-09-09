import { matchStatus } from './matchStatus'
import { partidosDeHoy } from './partidosDelDia'

/* Filtrar la lista de partidos de una jornada.

   Por qué existe: en la fase de liga de la Champions una jornada trae 18
   partidos. Al abrir «Partidos» los primeros que se ven son los que YA se
   jugaron, así que para llegar a los de hoy —los únicos sobre los que se puede
   hacer algo— hay que bajar por toda la lista. Con 5 partidos de la liga tica
   no se nota; con 18 sí.

   EL FILTRO SE APLICA DENTRO DE LA JORNADA ELEGIDA, no sobre el torneo entero.
   Es a propósito: en la Champions hay 144 partidos y casi todos están abiertos
   —las 8 jornadas se publican de una— así que un «por predecir» de todo el
   torneo devolvería 126 partidos, o sea MÁS de los que ya hay que bajar. Lo
   que acota la lista es la jornada; el filtro la afina. Para cruzar jornadas
   está el chip «Todas», que también es una selección de jornada.

   Ninguna combinación puede dejar la lista vacía: un chip sin partidos no se
   dibuja, y si el filtro guardado en la URL se queda sin nada al cambiar de
   jornada, `filtroEfectivo` cae a «todos». Un filtro que devuelve una pantalla
   en blanco parece que la app se rompió. */

export const FILTRO_TODOS = 'todos'

/* En el orden en que se pintan. «Todos» va aparte porque siempre existe. */
export const FILTROS = [
  { id: 'pendientes', label: 'Por predecir' },
  { id: 'hoy', label: 'Hoy' },
  { id: 'porjugar', label: 'Por jugar' },
]

export const IDS_FILTRO = [FILTRO_TODOS, ...FILTROS.map((f) => f.id)]

/* Un partido «terminado» no vuelve a la lista de por jugar. Cancelado y
   pospuesto entran acá aunque no se hayan jugado: no hay nada que esperar de
   ellos —`void_cancelled_match` ya anuló lo que hubiera— y dejarlos arriba
   sería justo el ruido que este filtro viene a quitar. */
const TERMINADOS = ['finished', 'cancelled', 'canceled', 'postponed']

/* Predicho = hay fila Y tiene marcador. Una fila a medias no es una
   predicción: quien la tenga sigue debiendo ese partido. */
function yaPredicho(match, predicciones) {
  const p = predicciones.find((x) => x.match_id === match.id)
  return !!p && p.home_goals_pred != null && p.away_goals_pred != null
}

export function aplicarFiltro(filtro, matches = [], { predictions = [], now = new Date() } = {}) {
  switch (filtro) {
    /* Lo que de verdad falta hacer: abierto (mismo corte de 15 min que la
       tarjeta y que la base) y todavía sin marcador puesto. */
    case 'pendientes':
      return matches.filter((m) => matchStatus(m, now).canPredict && !yaPredicho(m, predictions))

    /* El día natural de Costa Rica, el mismo que usa el resumen de las 6 am y
       la tarjeta de arriba: así los dos dicen «hoy» sobre el mismo conjunto. */
    case 'hoy':
      return partidosDeHoy(matches, now)

    /* Todo lo que no terminó. Incluye los que están EN JUEGO: no se pueden
       predecir, pero son lo último que alguien quiere perder de vista. */
    case 'porjugar':
      return matches.filter((m) => !TERMINADOS.includes(String(m.status || '').toLowerCase()))

    default:
      return matches
  }
}

/* Cuántos partidos daría cada filtro. Va en el chip: un filtro que esconde
   cosas solo se entiende si se ve cuánto esconde y cuánto hay en total. */
export function contarFiltros(matches = [], opciones = {}) {
  const conteos = { [FILTRO_TODOS]: matches.length }
  for (const f of FILTROS) conteos[f.id] = aplicarFiltro(f.id, matches, opciones).length
  return conteos
}

/* El filtro que se aplica DE VERDAD. Se deriva, no se guarda: al cambiar de
   jornada el filtro elegido puede quedarse sin partidos (elegiste «Hoy» en la
   jornada 1 y te pasás a la 5), y ahí vale más enseñar la jornada entera que
   una lista vacía. */
export function filtroEfectivo(filtro, conteos = {}) {
  if (!filtro || !IDS_FILTRO.includes(filtro)) return FILTRO_TODOS
  if (filtro === FILTRO_TODOS) return FILTRO_TODOS
  return conteos[filtro] > 0 ? filtro : FILTRO_TODOS
}
