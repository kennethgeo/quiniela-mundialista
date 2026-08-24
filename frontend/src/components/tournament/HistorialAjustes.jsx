/* Bitácora de correcciones manuales sobre los partidos del torneo.
   Es una pieza de CONFIANZA, no de datos: corregir un partido mueve los puntos
   de todos, y hasta ahora eso pasaba sin que quedara rastro visible. Acá
   cualquier miembro puede ver qué se cambió, cuándo y quién.

   Solo aparecen las correcciones manuales — el sync corre con service_role y
   no queda registrado, si no cada gol en vivo llenaría la lista. */
import { useQuery } from '@tanstack/react-query'
import { ScrollText } from 'lucide-react'
import { supabase } from '../../lib/supabase'

const ETIQUETA = {
  marcador: 'Marcador',
  estado: 'Estado',
  penales: 'Penales',
  candado: 'Resultado fijado',
}

const COLOR = {
  marcador: '#E8B75A',
  estado: '#FF7A59',
  penales: '#E8B75A',
  candado: '#2ED3B7',
}

const cuando = (iso) => {
  const d = new Date(iso)
  return isNaN(d) ? '' : d.toLocaleDateString('es', { day: 'numeric', month: 'short' })
    + ' · ' + d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', hour12: false })
}

export default function HistorialAjustes({ tournamentId }) {
  const { data: filas = [], isLoading } = useQuery({
    queryKey: ['match_audit', tournamentId],
    enabled: !!tournamentId,
    staleTime: 1000 * 60 * 2,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('match_audit_log', {
        p_tournament_id: tournamentId, p_limite: 30,
      })
      if (error) throw error
      return data || []
    },
  })

  // Sin correcciones no se muestra nada: no tiene sentido ocupar espacio con
  // una sección vacía cuando lo normal es que no haya ninguna.
  if (isLoading || filas.length === 0) return null

  return (
    <div className="rounded-[14px] bg-white dark:bg-[#161616] border border-slate-200 dark:border-[#262626] p-4 mt-4">
      <div className="flex items-center gap-2 mb-1">
        <ScrollText size={15} className="text-accent" />
        <h3 className="font-bold font-['Archivo'] text-[13px] text-slate-900 dark:text-[#F3F1EA]">Historial de ajustes</h3>
        <span className="ml-auto font-['JetBrains_Mono'] text-[10px] text-[var(--text-muted,#8A8A8A)]">{filas.length}</span>
      </div>
      <p className="text-[11px] text-[var(--text-muted,#8A8A8A)] mb-3">
        Correcciones hechas a mano sobre los partidos. Los cambios automáticos del sync no se listan.
      </p>

      <div className="space-y-2">
        {filas.map((f) => (
          <div key={f.id} className="flex items-start gap-2.5 pb-2 border-b border-slate-100 dark:border-white/5 last:border-0 last:pb-0">
            <span className="shrink-0 mt-0.5 font-['JetBrains_Mono'] font-bold text-[8.5px] px-1.5 py-0.5 rounded-[20px] uppercase tracking-wide"
              style={{ color: COLOR[f.campo] || '#8A8A8A', background: `${COLOR[f.campo] || '#8A8A8A'}1f` }}>
              {ETIQUETA[f.campo] || f.campo}
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-['Archivo'] text-[12px] text-slate-800 dark:text-[#F3F1EA] truncate">
                {f.home_team} vs {f.away_team}
                {f.matchday ? <span className="text-[var(--text-muted,#8A8A8A)]"> · J{f.matchday}</span> : null}
              </p>
              <p className="font-['JetBrains_Mono'] text-[10.5px] mt-0.5">
                <span className="text-[var(--text-muted,#8A8A8A)] line-through">{f.valor_antes ?? '—'}</span>
                <span className="text-[var(--text-muted,#8A8A8A)] mx-1.5">→</span>
                <span className="text-slate-900 dark:text-[#F3F1EA] font-bold">{f.valor_despues ?? '—'}</span>
              </p>
              <p className="font-['JetBrains_Mono'] text-[9px] text-[var(--text-muted,#8A8A8A)] mt-0.5">
                {f.autor} · {cuando(f.changed_at)}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
