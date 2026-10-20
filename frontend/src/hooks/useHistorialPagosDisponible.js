import { useConsultaDelUsuario } from './useConsultaDelUsuario'
import { supabase } from '../lib/supabase'

// No inferir la 109 a partir de los abonos (110): el historial puede existir
// antes. Un error de red/permisos tampoco demuestra que falte la tabla.
export function useHistorialPagosDisponible(leagueId, enabled = true) {
  return useConsultaDelUsuario({
    queryKey: ['historial_pagos_disponible', leagueId],
    enabled: !!leagueId && enabled,
    retry: false,
    staleTime: 60_000,
    queryFn: async ({ signal }) => {
      const { error } = await supabase.from('historial_pagos')
        .select('id').eq('league_id', leagueId).limit(1).abortSignal(signal)
      if (error?.code === 'PGRST205' || error?.code === '42P01') return false
      if (error) throw error
      return true
    },
  })
}
