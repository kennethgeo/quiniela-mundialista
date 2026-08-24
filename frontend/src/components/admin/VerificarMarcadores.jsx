/* Admin: cruza nuestros marcadores contra los de UNAFUT.

   ESPN ya se contradijo consigo misma en este torneo, y con una sola fuente un
   dato malo se descubre cuando alguien reclama por WhatsApp. Esto NO corrige
   nada: reporta para que el admin decida. Corregir solo haría que dos fuentes
   en desacuerdo se pisen entre ellas en cada pasada. */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ShieldCheck, Loader2, AlertTriangle, Check } from 'lucide-react'
import { supabase } from '../../lib/supabase'

/* Se muestra un bloque por cada torneo que tenga la fuente de UNAFUT
   configurada. Sin selector: hoy es uno solo y un desplegable de un elemento
   es puro ruido. */
export default function VerificarMarcadores() {
  const { data: torneos = [] } = useQuery({
    queryKey: ['torneos_con_unafut'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tournaments').select('id, name, unafut_league_slug')
        .not('unafut_league_slug', 'is', null)
      if (error) throw error
      return data || []
    },
  })

  if (torneos.length === 0) return null
  return (
    <div className="space-y-3">
      {torneos.map((t) => (
        <BloqueTorneo key={t.id} tournamentId={t.id} nombreTorneo={t.name} />
      ))}
    </div>
  )
}

function BloqueTorneo({ tournamentId, nombreTorneo }) {
  const [cargando, setCargando] = useState(false)
  const [res, setRes] = useState(null)
  const [error, setError] = useState(null)

  const verificar = async () => {
    try {
      setCargando(true); setError(null); setRes(null)
      const { data: { session } } = await supabase.auth.getSession()
      const r = await fetch(`/_backend/api/matches/verify-scores?tournament_id=${tournamentId}`, {
        headers: { Authorization: `Bearer ${session?.access_token}` },
      })
      const json = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(json.detail || `Error ${r.status}`)
      setRes(json)
    } catch (e) {
      setError(e.message)
    } finally {
      setCargando(false)
    }
  }

  // Las diferencias en partidos fijados a mano son esperadas (sanción,
  // walkover): se separan para que no compitan con las que sí hay que mirar.
  const reales = (res?.discrepancias || []).filter((d) => !d.esperado)
  const esperadas = (res?.discrepancias || []).filter((d) => d.esperado)

  return (
    <div className="glass-card p-4">
      <div className="flex items-center gap-2 mb-1">
        <ShieldCheck size={16} className="text-accent" />
        <h3 className="font-bold text-[13px] text-slate-900 dark:text-white">Verificar marcadores</h3>
      </div>
      <p className="text-[11px] text-slate-500 mb-3">
        Compara los marcadores de <strong>{nombreTorneo}</strong> contra los de UNAFUT.
        No cambia nada: solo reporta las diferencias.
      </p>

      <button onClick={verificar} disabled={cargando}
        className="w-full px-3 py-2 rounded-xl bg-accent/15 text-accent font-bold text-xs flex items-center justify-center gap-1.5 disabled:opacity-50">
        {cargando ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
        {cargando ? 'Comparando…' : 'Comparar con UNAFUT'}
      </button>

      {error && <p className="text-[11px] text-rose-500 mt-2">{error}</p>}

      {res && !res.fuente && (
        <p className="text-[11px] text-slate-500 mt-3">{res.mensaje}</p>
      )}

      {res?.fuente && (
        <div className="mt-3 space-y-2">
          <p className="font-['JetBrains_Mono'] text-[10px] text-slate-500">
            {res.comparados} partidos comparados
            {res.sin_pareja?.length ? ` · ${res.sin_pareja.length} sin pareja` : ''}
          </p>

          {reales.length === 0 ? (
            <div className="flex items-center gap-2 rounded-xl p-2.5" style={{ background: 'rgba(46,211,183,.10)' }}>
              <Check size={14} className="text-accent shrink-0" />
              <span className="text-[11.5px] font-semibold text-slate-700 dark:text-slate-200">
                Todo coincide con la fuente oficial.
              </span>
            </div>
          ) : (
            <div className="space-y-1.5">
              {reales.map((d) => (
                <div key={d.match_id} className="rounded-xl p-2.5 border" style={{ background: 'rgba(255,90,90,.08)', borderColor: 'rgba(255,90,90,.3)' }}>
                  <div className="flex items-start gap-2">
                    <AlertTriangle size={13} className="text-rose-500 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <p className="text-[12px] font-semibold text-slate-800 dark:text-[#F3F1EA] truncate">
                        {d.partido}{d.jornada ? ` · J${d.jornada}` : ''}
                      </p>
                      <p className="font-['JetBrains_Mono'] text-[11px] mt-0.5">
                        <span className="text-slate-500">nosotros</span>{' '}
                        <strong className="text-slate-900 dark:text-white">{d.nuestro}</strong>
                        <span className="text-slate-400 mx-2">·</span>
                        <span className="text-slate-500">UNAFUT</span>{' '}
                        <strong className="text-rose-500">{d.unafut}</strong>
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {esperadas.length > 0 && (
            <details className="rounded-xl bg-slate-100 dark:bg-black/20 p-2.5">
              <summary className="text-[11px] text-slate-500 cursor-pointer">
                {esperadas.length} {esperadas.length === 1 ? 'diferencia esperada' : 'diferencias esperadas'} (partidos fijados a mano)
              </summary>
              <div className="mt-2 space-y-1">
                {esperadas.map((d) => (
                  <p key={d.match_id} className="font-['JetBrains_Mono'] text-[10.5px] text-slate-500">
                    {d.partido}: {d.nuestro} vs {d.unafut} en UNAFUT
                  </p>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  )
}
