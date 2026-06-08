import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { User, Activity, Trophy, Clock, Search, History, Target, Zap, CheckCircle2, XCircle, PieChart } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import PushNotificationToggle from '../components/ui/PushNotificationToggle'

export default function ProfilePage() {
  const { profile } = useAuth()
  const [activeTab, setActiveTab] = useState('predictions')
  
  const [predictions, setPredictions] = useState([])
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  
  const [stats, setStats] = useState({
    exact: 0,
    correct: 0,
    miss: 0,
    powerups: 0,
    totalFinished: 0,
    predictedCount: 0
  })

  const [badges, setBadges] = useState(null)
  const [advancedStats, setAdvancedStats] = useState(null)

  useEffect(() => {
    if (profile?.id) {
      fetchData()
    }
  }, [profile?.id])

  const fetchData = async () => {
    try {
      setLoading(true)
      
      // 1. Obtener predicciones + partidos (mediante un join implícito usando foreign key, pero como no lo tenemos en la definicion de PostgREST, haremos 2 queries o usaremos eq)
      // Lo mejor es traer todos los matches y cruzar
      const { data: matchesData } = await supabase.from('matches').select('*')
      const { data: predsData } = await supabase.from('predictions').select('*').eq('user_id', profile.id)
      
      if (matchesData && predsData) {
        const enrichedPreds = predsData.map(p => ({
          ...p,
          match: matchesData.find(m => m.id === p.match_id)
        })).filter(p => p.match)
        
        // Ordenar por fecha del partido (descendente: los más recientes/futuros primero)
        enrichedPreds.sort((a,b) => new Date(b.match.kickoff_at) - new Date(a.match.kickoff_at))
        setPredictions(enrichedPreds)

        // Calcular estadísticas
        let exact = 0, correct = 0, miss = 0, powerups = 0, totalFinished = 0
        enrichedPreds.forEach(pred => {
          if (pred.use_powerup_x2) powerups++
          if (pred.match.status === 'finished') {
            totalFinished++
            const pts = pred.points_earned || 0
            if (pts >= 6) exact++
            else if (pts >= 3) correct++
            else miss++
          }
        })
        setStats({
          exact,
          correct,
          miss,
          powerups,
          totalFinished,
          predictedCount: enrichedPreds.length
        })
      }

      // 2. Obtener logs
      const { data: logsData } = await supabase
        .from('prediction_logs')
        .select('*')
        .eq('user_id', profile.id)
        .order('changed_at', { ascending: false })
        .limit(50)

      if (logsData && matchesData) {
        const enrichedLogs = logsData.map(l => ({
          ...l,
          match: matchesData.find(m => m.id === l.match_id)
        })).filter(l => l.match)
        setLogs(enrichedLogs)
      }

      // 3. Obtener Gamification Stats
      const { data: bData } = await supabase.from('user_badges_view').select('*').eq('user_id', profile.id).maybeSingle()
      const { data: sData } = await supabase.from('user_stats_view').select('*').eq('user_id', profile.id).maybeSingle()
      
      if (bData) setBadges(bData)
      if (sData) setAdvancedStats(sData)

    } catch (err) {
      console.error('Error fetching profile data', err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="px-4 py-5 bg-world-cup h-full min-h-screen md:min-h-0 relative">
      <motion.div
        initial={{ opacity: 0, y: -15 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-6 relative z-10"
      >
        <div className="flex items-center gap-3 mb-1.5">
          <div className="w-10 h-10 rounded-2xl bg-accent/20 flex items-center justify-center border border-accent/30">
            <User size={20} className="text-accent" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">Mi Perfil</h1>
            <p className="text-xs text-slate-500">{profile?.display_name || 'Jugador'} · {profile?.total_points || 0} pts totales</p>
          </div>
        </div>
        
        {/* Métricas / Dashboard */}
        {!loading && (
          <motion.div 
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
            className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-6"
          >
            {/* Tasa de Efectividad */}
            <div className="glass-card p-4 flex flex-col items-center justify-center relative overflow-hidden group">
              <div className="absolute -right-4 -top-4 w-16 h-16 bg-accent/10 rounded-full blur-xl group-hover:bg-accent/20 transition-colors" />
              <PieChart size={20} className="text-accent mb-2" />
              <span className="text-2xl font-black text-slate-900 dark:text-white">
                {stats.totalFinished > 0 ? Math.round(((stats.exact + stats.correct) / stats.totalFinished) * 100) : 0}%
              </span>
              <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider text-center">Efectividad</span>
            </div>

            {/* Plenos */}
            <div className="glass-card p-4 flex flex-col items-center justify-center relative overflow-hidden group">
              <div className="absolute -right-4 -top-4 w-16 h-16 bg-amber-500/10 rounded-full blur-xl group-hover:bg-amber-500/20 transition-colors" />
              <Target size={20} className="text-amber-500 mb-2" />
              <span className="text-2xl font-black text-slate-900 dark:text-white">{stats.exact}</span>
              <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider text-center">Marcador Exacto</span>
            </div>

            {/* Aciertos */}
            <div className="glass-card p-4 flex flex-col items-center justify-center relative overflow-hidden group">
              <div className="absolute -right-4 -top-4 w-16 h-16 bg-emerald-500/10 rounded-full blur-xl group-hover:bg-emerald-500/20 transition-colors" />
              <CheckCircle2 size={20} className="text-emerald-500 mb-2" />
              <span className="text-2xl font-black text-slate-900 dark:text-white">{stats.correct}</span>
              <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider text-center">Acierto Ganador</span>
            </div>

            {/* Desaciertos */}
            <div className="glass-card p-4 flex flex-col items-center justify-center relative overflow-hidden group">
              <div className="absolute -right-4 -top-4 w-16 h-16 bg-rose-500/10 rounded-full blur-xl group-hover:bg-rose-500/20 transition-colors" />
              <XCircle size={20} className="text-rose-500 mb-2" />
              <span className="text-2xl font-black text-slate-900 dark:text-white">{stats.miss}</span>
              <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider text-center">Desaciertos</span>
            </div>

            {/* Barra Inferior de Métricas Secundarias e Históricas */}
            <div className="glass-card p-3 col-span-2 md:col-span-4 flex flex-col sm:flex-row flex-wrap justify-between items-center gap-4">
              <div className="flex w-full sm:w-auto justify-around flex-1 gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center text-amber-500">
                    <Zap size={16} fill="currentColor" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-900 dark:text-white">{stats.powerups}</p>
                    <p className="text-[10px] text-slate-500 uppercase font-bold">Comodines Usados</p>
                  </div>
                </div>
                <div className="w-px h-8 bg-slate-200 dark:bg-white/10" />
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-500">
                    <Activity size={16} />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-900 dark:text-white">{stats.predictedCount} <span className="text-slate-400 font-normal">/ 104</span></p>
                    <p className="text-[10px] text-slate-500 uppercase font-bold">Partidos Pronosticados</p>
                  </div>
                </div>
              </div>

              {advancedStats && (advancedStats.talisman_team || advancedStats.maldito_team) && (
                <>
                  <div className="hidden sm:block w-px h-8 bg-slate-200 dark:bg-white/10" />
                  <div className="flex w-full sm:w-auto justify-around flex-1 gap-4 pt-3 sm:pt-0 border-t border-slate-200 dark:border-white/10 sm:border-t-0">
                    {advancedStats.talisman_team && (
                      <div className="flex items-center gap-2">
                        <img src={`https://flagcdn.com/w20/${advancedStats.talisman_team.substring(0,2).toLowerCase()}.png`} alt="Talisman" className="w-5 h-5 rounded-full object-cover" onError={(e) => { e.target.style.display = 'none' }} />
                        <div>
                          <p className="text-xs font-bold text-emerald-600 dark:text-emerald-400">{advancedStats.talisman_team}</p>
                          <p className="text-[9px] text-slate-500 uppercase font-bold">Tu Talismán</p>
                        </div>
                      </div>
                    )}
                    {advancedStats.maldito_team && (
                      <div className="flex items-center gap-2">
                        <img src={`https://flagcdn.com/w20/${advancedStats.maldito_team.substring(0,2).toLowerCase()}.png`} alt="Maldito" className="w-5 h-5 rounded-full object-cover" onError={(e) => { e.target.style.display = 'none' }} />
                        <div>
                          <p className="text-xs font-bold text-rose-600 dark:text-rose-400">{advancedStats.maldito_team}</p>
                          <p className="text-[9px] text-slate-500 uppercase font-bold">Tu Maldición</p>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </motion.div>
        )}

        {/* Medallas (Badges) */}
        {badges && (
          <motion.div 
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
            className="mt-6 glass-card p-4 flex gap-3 overflow-x-auto scrollbar-hide"
          >
            <div className="flex items-center gap-2 text-slate-500 mr-2 flex-shrink-0">
              <Trophy size={16} />
              <span className="text-xs font-bold uppercase tracking-wider">Logros:</span>
            </div>
            
            {badges.is_nostradamus && <Badge emoji="🎯" name="Nostradamus" desc="3+ Exactos" color="amber" />}
            {badges.is_rey_empate && <Badge emoji="🤝" name="Rey del Empate" desc="3+ Empates exactos" color="blue" />}
            {badges.is_francotirador && <Badge emoji="🔥" name="Francotirador" desc="Exacto con x2" color="rose" />}
            {badges.is_pecho_frio && <Badge emoji="🥶" name="Pecho Frío" desc="0 pts con x2" color="cyan" />}
            {badges.is_mas_conocedor && <Badge emoji="🤡" name="El Más Conocedor" desc="5+ ceros" color="purple" />}
            {badges.is_tortuga && <Badge emoji="🐢" name="La Tortuga" desc="Predijo a última hora" color="emerald" />}
            {badges.is_taylor && <Badge emoji="💩" name="0T" desc="Por ser tan Tay" color="stone" />}
            
            {(!badges.is_nostradamus && !badges.is_rey_empate && !badges.is_francotirador && !badges.is_pecho_frio && !badges.is_mas_conocedor && !badges.is_tortuga && !badges.is_taylor) && (
              <span className="text-xs text-slate-400 flex items-center italic">Aún no has desbloqueado logros</span>
            )}
          </motion.div>
        )}

        <PushNotificationToggle />

        <div className="flex gap-4 mt-6 border-b border-white/10 pb-1">
          <button 
            onClick={() => setActiveTab('predictions')}
            className={`pb-3 text-sm font-bold transition-colors relative flex items-center gap-2 ${activeTab === 'predictions' ? 'text-accent' : 'text-slate-500 hover:text-slate-300'}`}
          >
            <Trophy size={14} />
            Mis Resultados
            {activeTab === 'predictions' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent rounded-t-full" />}
          </button>
          <button 
            onClick={() => setActiveTab('logs')}
            className={`pb-3 text-sm font-bold transition-colors relative flex items-center gap-2 ${activeTab === 'logs' ? 'text-accent' : 'text-slate-500 hover:text-slate-300'}`}
          >
            <History size={14} />
            Historial de Cambios
            {activeTab === 'logs' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent rounded-t-full" />}
          </button>
        </div>
      </motion.div>

      <div className="relative z-10 pb-20">
        {loading ? (
          <div className="text-center py-10 text-slate-400 text-sm">Cargando datos...</div>
        ) : (
          <AnimatePresence mode="wait">
            {activeTab === 'predictions' && (
              <motion.div key="preds" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }} className="space-y-4">
                {predictions.length === 0 ? (
                   <div className="glass-card p-8 text-center text-slate-500 text-sm">No has hecho predicciones aún.</div>
                ) : (
                  predictions.map(pred => {
                    const match = pred.match
                    const isFinished = match.status === 'finished'
                    const pts = pred.points_earned !== null ? pred.points_earned : 0
                    
                    return (
                      <div key={pred.id} className="glass-card p-4">
                        <div className="flex justify-between items-center mb-3">
                          <span className="text-[10px] uppercase font-bold text-slate-400 bg-white/5 px-2 py-0.5 rounded">
                            {match.phase} {match.group_name ? `- Gp ${match.group_name}` : ''}
                          </span>
                          <span className={`text-[11px] font-bold px-2 py-0.5 rounded ${isFinished ? 'bg-accent/20 text-accent' : 'bg-slate-200 dark:bg-white/10 text-slate-500'}`}>
                            {isFinished ? `${pts} pts obtenidos` : 'Pendiente'}
                          </span>
                        </div>
                        
                        <div className="flex items-center justify-between">
                          <div className="flex flex-col items-center flex-1">
                            <span className="text-sm font-bold text-slate-900 dark:text-white truncate max-w-full">{match.home_team}</span>
                            <span className="text-2xl font-black mt-1 text-slate-800 dark:text-white">{isFinished ? match.home_goals_actual : '-'}</span>
                          </div>
                          <div className="px-4 text-center">
                            <span className="text-xs font-bold text-slate-400 block mb-1">VS</span>
                            <div className="bg-slate-100 dark:bg-black/30 rounded px-3 py-1 border border-slate-200 dark:border-white/5 text-center">
                              <span className="text-[10px] block text-slate-500 mb-0.5 font-bold">Tu predicción</span>
                              <span className="font-bold text-sm text-accent">
                                {pred.home_goals_pred} - {pred.away_goals_pred}
                              </span>
                              {pred.use_powerup_x2 && <span className="text-[10px] text-amber-500 font-bold block mt-0.5">⭐ x2</span>}
                            </div>
                          </div>
                          <div className="flex flex-col items-center flex-1">
                            <span className="text-sm font-bold text-slate-900 dark:text-white truncate max-w-full">{match.away_team}</span>
                            <span className="text-2xl font-black mt-1 text-slate-800 dark:text-white">{isFinished ? match.away_goals_actual : '-'}</span>
                          </div>
                        </div>
                      </div>
                    )
                  })
                )}
              </motion.div>
            )}

            {activeTab === 'logs' && (
              <motion.div key="logs" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }}>
                {logs.length === 0 ? (
                  <div className="glass-card p-8 text-center text-slate-500 text-sm">No hay registro de actividad aún. Recuerda que solo las actividades nuevas a partir de la habilitación del historial aparecerán aquí.</div>
                ) : (
                  <div className="relative border-l border-accent/20 ml-3 md:ml-4 space-y-6">
                    {logs.map(log => {
                      const m = log.match
                      const date = new Date(log.changed_at)
                      const isInsert = log.action === 'INSERT'
                      
                      let changesText = ''
                      if (isInsert) {
                         changesText = `Creó predicción: ${log.new_data?.home_goals_pred} - ${log.new_data?.away_goals_pred}`
                         if (log.new_data?.use_powerup_x2) changesText += ' (Usó x2)'
                      } else {
                         const oldH = log.old_data?.home_goals_pred; const newH = log.new_data?.home_goals_pred;
                         const oldA = log.old_data?.away_goals_pred; const newA = log.new_data?.away_goals_pred;
                         if (oldH !== newH || oldA !== newA) {
                            changesText = `Cambió marcador de ${oldH}-${oldA} a ${newH}-${newA}. `
                         }
                         const oldP = log.old_data?.use_powerup_x2; const newP = log.new_data?.use_powerup_x2;
                         if (oldP !== newP) {
                            changesText += newP ? `Activó comodín x2. ` : `Desactivó comodín x2.`
                         }
                      }

                      return (
                        <div key={log.id} className="relative pl-6">
                           <div className="absolute -left-1.5 top-1.5 w-3 h-3 rounded-full bg-accent ring-4 ring-slate-900/10 dark:ring-black"></div>
                           <div className="glass-card p-3">
                             <div className="flex items-center gap-2 text-[10px] text-slate-400 mb-1 font-bold">
                               <Clock size={10} />
                               {date.toLocaleDateString()} a las {date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                             </div>
                             <p className="text-xs font-bold text-slate-900 dark:text-white mb-1">{m.home_team} vs {m.away_team}</p>
                             <p className="text-sm text-slate-600 dark:text-slate-300">
                               {changesText}
                             </p>
                           </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </div>
    </div>
  )
}

// Helper para dibujar las medallas
function Badge({ emoji, name, desc, color }) {
  const colors = {
    amber: 'bg-amber-500/10 border-amber-500/20 text-amber-700 dark:text-amber-400',
    blue: 'bg-blue-500/10 border-blue-500/20 text-blue-700 dark:text-blue-400',
    rose: 'bg-rose-500/10 border-rose-500/20 text-rose-700 dark:text-rose-400',
    cyan: 'bg-cyan-500/10 border-cyan-500/20 text-cyan-700 dark:text-cyan-400',
    purple: 'bg-purple-500/10 border-purple-500/20 text-purple-700 dark:text-purple-400',
    emerald: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:text-emerald-400',
    stone: 'bg-stone-500/10 border-stone-500/20 text-stone-700 dark:text-stone-400',
  }
  
  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border flex-shrink-0 ${colors[color]}`}>
      <span className="text-lg leading-none">{emoji}</span>
      <div className="flex flex-col">
        <span className="text-[10px] font-black uppercase tracking-wide leading-tight">{name}</span>
        <span className="text-[9px] opacity-80 leading-tight">{desc}</span>
      </div>
    </div>
  )
}
