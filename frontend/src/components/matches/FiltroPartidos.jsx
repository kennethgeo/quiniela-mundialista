/* La fila de filtros de la pestaña Partidos.

   Afinar la jornada elegida: «Por predecir», «Hoy», «Por jugar». Con 18
   partidos por jornada —la fase de liga de la Champions— llegar a los de hoy
   obliga a pasar por todos los que ya se jugaron.

   Un chip SIN PARTIDOS no se dibuja. Un filtro que lleva a una lista vacía no
   es un filtro, es un callejón: la pantalla parece rota y no hay pista de por
   qué. Por lo mismo cada chip lleva su cuenta, para que se vea qué esconde. */
import { FILTRO_TODOS, FILTROS } from '../../lib/filtroPartidos'

export default function FiltroPartidos({ valor, conteos = {}, onChange }) {
  // Con una sola opción real no hay nada que elegir: la fila sería decorado.
  const disponibles = FILTROS.filter((f) => (conteos[f.id] || 0) > 0)
  if (disponibles.length === 0) return null

  return (
    <div role="group" aria-label="Filtrar partidos"
      className="flex gap-1.5 mb-2.5 overflow-x-auto scrollbar-hide">
      <Chip id={FILTRO_TODOS} label="Todos" cuenta={conteos[FILTRO_TODOS]}
        activo={valor === FILTRO_TODOS} onChange={onChange} />
      {disponibles.map((f) => (
        <Chip key={f.id} id={f.id} label={f.label} cuenta={conteos[f.id]}
          activo={valor === f.id} onChange={onChange} />
      ))}
    </div>
  )
}

function Chip({ id, label, cuenta, activo, onChange }) {
  return (
    <button type="button" aria-pressed={activo} onClick={() => onChange(id)}
      className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] font-['JetBrains_Mono'] font-bold text-[10px] uppercase tracking-[0.08em] whitespace-nowrap transition-all ${
        activo
          ? 'bg-accent text-[#06231d]'
          : 'bg-white dark:bg-[#161616] text-[var(--text-muted,#8A8A8A)] border border-slate-200 dark:border-[#262626]'}`}>
      {label}
      <span className={activo ? 'opacity-70' : 'opacity-60'}>{cuenta}</span>
    </button>
  )
}
