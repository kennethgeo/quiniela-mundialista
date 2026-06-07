import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { Save, AlertCircle } from 'lucide-react'

export default function BracketAdmin() {
  const [matches, setMatches] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [bracketMatches, setBracketMatches] = useState([])

  // Fetch only knockout matches
  useEffect(() => {
    fetchKnockouts()
  }, [])

  const fetchKnockouts = async () => {
    try {
      setLoading(true)
      const { data, error } = await supabase
        .from('matches')
        .select('*')
        .neq('phase', 'groups')
        .order('id', { ascending: true })

      if (error) throw error
      setMatches(data || [])
      
      // Initialize form state
      const initialForm = data.map(m => ({
        id: m.id,
        home_team: m.home_team,
        away_team: m.away_team,
        home_team_code: m.home_team_code,
        away_team_code: m.away_team_code,
        phase: m.phase
      }))
      setBracketMatches(initialForm)
    } catch (err) {
      console.error('Error fetching knockouts:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleChange = (id, field, value) => {
    setBracketMatches(prev => prev.map(m => 
      m.id === id ? { ...m, [field]: value } : m
    ))
  }

  const handleSave = async (id) => {
    try {
      setSaving(true)
      const matchToUpdate = bracketMatches.find(m => m.id === id)
      
      const { error } = await supabase
        .from('matches')
        .update({
          home_team: matchToUpdate.home_team,
          away_team: matchToUpdate.away_team,
          home_team_code: matchToUpdate.home_team_code,
          away_team_code: matchToUpdate.away_team_code
        })
        .eq('id', id)

      if (error) throw error
      alert('Partido actualizado con éxito')
      await fetchKnockouts()
    } catch (err) {
      console.error('Error updating knockout match:', err)
      alert('Error al guardar: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="text-center py-10 text-slate-400">Cargando llaves...</div>
  }

  return (
    <div className="space-y-6">
      <div className="glass-card p-4 bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400">
        <div className="flex gap-3">
          <AlertCircle className="shrink-0 mt-0.5" size={20} />
          <div className="text-sm">
            <p className="font-bold mb-1">Configuración Manual de Eliminatorias</p>
            <p>Debido a que la FIFA no ha publicado el cuadro oficial de asignación de los mejores terceros, puedes usar esta herramienta para asignar manualmente qué país juega en cada llave de Dieciseisavos (y fases posteriores) una vez que termine la Fase de Grupos.</p>
          </div>
        </div>
      </div>

      <div className="space-y-8">
        {['round_of_32', 'round_of_16', 'quarter_finals', 'semi_finals', 'third_place', 'final'].map(phase => {
          const phaseMatches = bracketMatches.filter(m => m.phase === phase)
          if (phaseMatches.length === 0) return null

          const phaseNames = {
            'round_of_32': 'Dieciseisavos de Final',
            'round_of_16': 'Octavos de Final',
            'quarter_finals': 'Cuartos de Final',
            'semi_finals': 'Semifinales',
            'third_place': 'Tercer Puesto',
            'final': 'Final'
          }

          return (
            <div key={phase} className="space-y-3">
              <h3 className="font-bold text-slate-900 dark:text-white border-b border-slate-200 dark:border-white/10 pb-2">
                {phaseNames[phase]}
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {phaseMatches.map(match => (
                  <div key={match.id} className="glass-card p-4">
                    <p className="text-[10px] text-slate-500 font-bold mb-3 uppercase">Partido #{match.id}</p>
                    
                    {/* Home */}
                    <div className="flex gap-2 mb-3">
                      <div className="flex-1">
                        <label className="text-[10px] text-slate-400 uppercase">Local (Ej. Argentina)</label>
                        <input
                          type="text"
                          value={match.home_team}
                          onChange={(e) => handleChange(match.id, 'home_team', e.target.value)}
                          className="w-full bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 rounded-md px-2 py-1.5 text-sm font-semibold text-slate-900 dark:text-white"
                        />
                      </div>
                      <div className="w-16">
                        <label className="text-[10px] text-slate-400 uppercase">Cód (ar)</label>
                        <input
                          type="text"
                          value={match.home_team_code}
                          onChange={(e) => handleChange(match.id, 'home_team_code', e.target.value)}
                          className="w-full bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 rounded-md px-2 py-1.5 text-sm font-semibold text-slate-900 dark:text-white"
                        />
                      </div>
                    </div>

                    {/* Away */}
                    <div className="flex gap-2 mb-4">
                      <div className="flex-1">
                        <label className="text-[10px] text-slate-400 uppercase">Visitante (Ej. México)</label>
                        <input
                          type="text"
                          value={match.away_team}
                          onChange={(e) => handleChange(match.id, 'away_team', e.target.value)}
                          className="w-full bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 rounded-md px-2 py-1.5 text-sm font-semibold text-slate-900 dark:text-white"
                        />
                      </div>
                      <div className="w-16">
                        <label className="text-[10px] text-slate-400 uppercase">Cód (mx)</label>
                        <input
                          type="text"
                          value={match.away_team_code}
                          onChange={(e) => handleChange(match.id, 'away_team_code', e.target.value)}
                          className="w-full bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 rounded-md px-2 py-1.5 text-sm font-semibold text-slate-900 dark:text-white"
                        />
                      </div>
                    </div>

                    <button
                      onClick={() => handleSave(match.id)}
                      disabled={saving}
                      className="w-full py-2 bg-accent hover:bg-accent/90 text-slate-900 font-bold text-xs rounded-md flex items-center justify-center gap-2"
                    >
                      <Save size={14} /> {saving ? 'Guardando...' : 'Guardar Equipos'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
