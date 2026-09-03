import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'motion/react'
import { Activity, Trophy, Clock, Target, Zap, CheckCircle2, XCircle, Camera, Trash2, Loader2, Moon, Sun, LogOut, ShieldAlert, BookOpen, RefreshCw, Wrench } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { resizeImage } from '../lib/image'
import { getTournamentLocked } from '../lib/tournamentLock'
import { useAuth } from '../hooks/useAuth'
import { useTheme } from '../contexts/ThemeContext'
import PushNotificationToggle from '../components/ui/PushNotificationToggle'
import GlobalPredictionsModal from '../components/profile/GlobalPredictionsModal'
import BadgeShowcase, { MedalStrip } from '../components/medals/BadgeShowcase'
import { fetchMyMedals, aggregateMedals } from '../lib/medals'
import { refreshApplication } from '../lib/appUpdate'
import { EmptyState } from '../components/ui/StatePanel'

const AVATAR_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_AVATAR_SOURCE_BYTES = 12 * 1024 * 1024
const MAX_AVATAR_UPLOAD_BYTES = 1024 * 1024

export default function ProfilePage() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const { theme, toggleTheme } = useTheme()
  const [activeTab, setActiveTab] = useState('predictions')
  
  const [predictions, setPredictions] = useState([])
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [globalPrediction, setGlobalPrediction] = useState(null)
  const [isPredictionsLocked, setIsPredictionsLocked] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  
  const [stats, setStats] = useState({
    exact: 0,
    correct: 0,
    miss: 0,
    powerups: 0,
    totalFinished: 0,
    predictedCount: 0
  })

  const [medalsAgg, setMedalsAgg] = useState({})
  const [advancedStats, setAdvancedStats] = useState(null)
  
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [refreshingApp, setRefreshingApp] = useState(false)
  const fileInputRef = useRef(null)

  const handleAvatarUpload = async (event) => {
    let uploadedPath = null
    try {
      setUploadingAvatar(true)
      const file = event.target.files[0]
      if (!file) return
      if (!AVATAR_TYPES.has(file.type)) throw new Error('Usá una imagen JPG, PNG o WebP.')
      if (file.size > MAX_AVATAR_SOURCE_BYTES) throw new Error('La imagen original no puede superar 12 MB.')

      // Redimensionar/comprimir antes de subir: una foto de teléfono de varios
      // MB se descargaba completa en ranking/podio/perfil (Cached Egress alto).
      const blob = await resizeImage(file, 256, 0.82)
      if (blob.size > MAX_AVATAR_UPLOAD_BYTES) {
        throw new Error('No pudimos optimizar la imagen por debajo de 1 MB. Probá con otra foto.')
      }
      const filePath = `${profile.id}-${Date.now()}.webp`

      // La anterior se conserva hasta que la nueva esté subida y enlazada. Así
      // una falla de red nunca deja al usuario sin la foto que ya tenía.
      const prevUrl = profile.avatar_url || ''
      const marker = '/avatars/'

      // Upload to storage (webp pequeño + cache de 1 año para no re-descargar)
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, blob, { contentType: 'image/webp', cacheControl: '31536000', upsert: true })

      if (uploadError) throw uploadError
      uploadedPath = filePath

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('avatars')
        .getPublicUrl(filePath)

      // Update user record
      const { error: updateError } = await supabase
        .from('users')
        .update({ avatar_url: publicUrl })
        .eq('id', profile.id)

      if (updateError) throw updateError
      uploadedPath = null

      if (prevUrl.includes(marker)) {
        const oldPath = decodeURIComponent(prevUrl.split(marker)[1]?.split('?')[0] || '')
        if (oldPath && oldPath !== filePath) await supabase.storage.from('avatars').remove([oldPath]).catch(() => {})
      }

      // Reload window to reflect changes globally
      window.location.reload()
    } catch (error) {
      if (uploadedPath) await supabase.storage.from('avatars').remove([uploadedPath]).catch(() => {})
      console.error('Error uploading avatar:', error)
      alert('Error subiendo la foto: ' + error.message)
    } finally {
      setUploadingAvatar(false)
      event.target.value = ''
    }
  }

  const handleAvatarRemove = async () => {
    try {
      setUploadingAvatar(true)
      const { error: updateError } = await supabase
        .from('users')
        .update({ avatar_url: null })
        .eq('id', profile.id)

      if (updateError) throw updateError

      const prevUrl = profile.avatar_url || ''
      const marker = '/avatars/'
      if (prevUrl.includes(marker)) {
        const oldPath = decodeURIComponent(prevUrl.split(marker)[1]?.split('?')[0] || '')
        if (oldPath) await supabase.storage.from('avatars').remove([oldPath]).catch(() => {})
      }
      
      window.location.reload()
    } catch (error) {
      console.error('Error removing avatar:', error)
      alert('Error eliminando la foto: ' + error.message)
    } finally {
      setUploadingAvatar(false)
    }
  }

  useEffect(() => {
    if (profile?.id) {
      fetchData()
    }
  }, [profile?.id])

  const fetchData = async () => {
    try {
      setLoading(true)

      // Son fuentes independientes: arrancarlas juntas evita una cascada de
      // esperas perceptible en redes móviles lentas.
      const [matchesResult, predictionsResult, logsResult, statsResult, globalResult, medalRows, locked] = await Promise.all([
        supabase.from('matches')
          .select('id,kickoff_at,status,phase,group_name,home_team,away_team,home_goals_actual,away_goals_actual'),
        supabase.from('predictions')
          .select('id,match_id,home_goals_pred,away_goals_pred,use_powerup_x2,points_earned')
          .eq('user_id', profile.id),
        supabase.from('prediction_logs')
          .select('id,match_id,changed_at,action,old_data,new_data')
          .eq('user_id', profile.id)
          .order('changed_at', { ascending: false })
          .limit(50),
        supabase.from('user_stats_view')
          .select('talisman_team,maldito_team').eq('user_id', profile.id).maybeSingle(),
        supabase.from('tournament_predictions')
          .select('champion_team,top_scorer_name').eq('user_id', profile.id).maybeSingle(),
        fetchMyMedals().catch(() => []),
        getTournamentLocked(),
      ])

      if (matchesResult.error) throw matchesResult.error
      if (predictionsResult.error) throw predictionsResult.error
      const matchesData = matchesResult.data || []
      const predsData = predictionsResult.data || []
      
      if (matchesData.length || predsData.length) {
        const enrichedPreds = predsData.map(p => ({
          ...p,
          match: matchesData.find(m => m.id === p.match_id)
        })).filter(p => p.match)
        
        enrichedPreds.sort((a,b) => new Date(b.match.kickoff_at) - new Date(a.match.kickoff_at))
        setPredictions(enrichedPreds)

        let exact = 0, correct = 0, miss = 0, powerups = 0, totalFinished = 0
        enrichedPreds.forEach(pred => {
          if (pred.use_powerup_x2) powerups++
          if (pred.match.status === 'finished') {
            totalFinished++
            const pts = pred.points_earned || 0
            // Exacto = 3 pts (o 6 con x2). Acierto ganador = 1 pt (o 2 con x2).
            // Lo demás (0 pts) es fallo. Antes los aciertos de 1 pt caían como
            // fallo y los exactos sin x2 contaban como acierto ganador.
            if (pts === 3 || pts === 6) exact++
            else if (pts > 0) correct++
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

      const logsData = logsResult.data || []
      if (logsData && matchesData) {
        const enrichedLogs = logsData.map(l => ({
          ...l,
          match: matchesData.find(m => m.id === l.match_id)
        })).filter(l => l.match)
        setLogs(enrichedLogs)
      }

      setMedalsAgg(aggregateMedals(medalRows))
      setAdvancedStats(statsResult.data || null)
      setGlobalPrediction(globalResult.data || null)
        
      // Bloqueo: manual (admin) o automático al iniciar el primer partido del torneo
      setIsPredictionsLocked(locked)

    } catch (err) {
      console.error('Error fetching profile data', err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="px-4 py-5 relative">
      <motion.div
        initial={{ opacity: 0, y: -15 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-6 relative z-10"
      >
        <div className="flex flex-col items-center gap-2.5 mb-5">
          <div className="relative group">
            <div
              className="w-[76px] h-[76px] rounded-full flex items-center justify-center overflow-hidden cursor-pointer transition-transform hover:scale-105 font-['Unbounded'] font-bold text-[26px] text-[#06231d]"
              style={{ background: 'linear-gradient(135deg,#2ED3B7,#1a8f7c)' }}
              onClick={() => !uploadingAvatar && fileInputRef.current?.click()}
            >
              {uploadingAvatar ? (
                <Loader2 size={24} className="text-[#06231d] animate-spin" />
              ) : profile?.avatar_url ? (
                <>
                  <img src={profile.avatar_url} alt="Avatar" className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <Camera size={20} className="text-white" />
                  </div>
                </>
              ) : (
                <>
                  {(profile?.display_name?.charAt(0) || 'T').toUpperCase()}
                  <div className="absolute inset-0 bg-black/40 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <Camera size={20} className="text-white" />
                  </div>
                </>
              )}
            </div>

            {profile?.avatar_url && !uploadingAvatar && (
              <button
                onClick={handleAvatarRemove}
                className="absolute -top-1 -right-1 bg-[#FF7A59] rounded-full p-1 shadow-md hover:opacity-90 transition-opacity"
                title="Eliminar foto"
              >
                <Trash2 size={12} className="text-white" />
              </button>
            )}

            <input
              type="file"
              ref={fileInputRef}
              onChange={handleAvatarUpload}
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
            />
          </div>
          <h1 className="font-['Unbounded'] font-bold text-[18px] text-slate-900 dark:text-[#F3F1EA] text-center">{profile?.display_name || 'Jugador'}</h1>
          <p className="font-['JetBrains_Mono'] font-semibold text-[11px] text-[var(--text-muted,#8A8A8A)]">{profile?.total_points || 0} pts totales</p>
          {/* Este perfil es el GLOBAL: junta todas las quinielas. El de cada
              quiniela vive en su pestaña Tabla, tocando tu fila. Sin este
              cartel los dos números se ven distintos y parecen un error. */}
          <p className="text-[10px] text-[var(--text-muted,#8A8A8A)] text-center mt-1.5 max-w-[260px] leading-relaxed">
            Tu perfil global: junta todas tus quinielas y cuenta cada partido una vez.
            El de cada quiniela lo abrís tocando tu fila en su Tabla.
          </p>
        </div>

        {/* Métricas / Dashboard */}
        {!loading && (
          <motion.div
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
            className="grid grid-cols-3 gap-2 mt-5"
          >
            {/* PTS TOTALES */}
            <div className="rounded-xl p-3 text-center bg-white dark:bg-[#161616] border border-slate-200 dark:border-[#262626]">
              <div className="font-['JetBrains_Mono'] font-extrabold text-[20px] text-accent">{profile?.total_points || 0}</div>
              <div className="font-['Archivo'] font-semibold text-[8.5px] text-[var(--text-muted,#8A8A8A)] mt-0.5 uppercase">Pts Totales</div>
            </div>
            {/* EFECTIVIDAD */}
            <div className="rounded-xl p-3 text-center bg-white dark:bg-[#161616] border border-slate-200 dark:border-[#262626]">
              <div className="font-['JetBrains_Mono'] font-extrabold text-[20px] text-slate-900 dark:text-[#F3F1EA]">
                {stats.totalFinished > 0 ? Math.round(((stats.exact + stats.correct) / stats.totalFinished) * 100) : 0}%
              </div>
              <div className="font-['Archivo'] font-semibold text-[8.5px] text-[var(--text-muted,#8A8A8A)] mt-0.5 uppercase">Efectividad</div>
            </div>
            {/* EXACTOS */}
            <div className="rounded-xl p-3 text-center bg-white dark:bg-[#161616] border border-slate-200 dark:border-[#262626]">
              <div className="font-['JetBrains_Mono'] font-extrabold text-[20px] text-[#FF7A59]">{stats.exact}</div>
              <div className="font-['Archivo'] font-semibold text-[8.5px] text-[var(--text-muted,#8A8A8A)] mt-0.5 uppercase">Exactos</div>
            </div>

            {/* Barra Inferior de Métricas Secundarias e Históricas */}
            <div className="glass-card p-3 col-span-3 flex flex-col sm:flex-row flex-wrap justify-between items-center gap-4 mt-1">
              <div className="flex w-full sm:w-auto justify-around flex-1 gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-accent/15 flex items-center justify-center text-accent">
                    <CheckCircle2 size={16} />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-900 dark:text-[#F3F1EA]">{stats.correct}</p>
                    <p className="text-[10px] text-slate-500 uppercase font-bold">Acierto Ganador</p>
                  </div>
                </div>
                <div className="w-px h-8 bg-slate-200 dark:bg-white/10" />
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-[#FF7A59]/15 flex items-center justify-center text-[#FF7A59]">
                    <XCircle size={16} />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-900 dark:text-[#F3F1EA]">{stats.miss}</p>
                    <p className="text-[10px] text-slate-500 uppercase font-bold">Desaciertos</p>
                  </div>
                </div>
              </div>

              <div className="flex w-full sm:w-auto justify-around flex-1 gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-accent/15 flex items-center justify-center text-accent">
                    <Zap size={16} fill="currentColor" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-900 dark:text-[#F3F1EA]">{stats.powerups}</p>
                    <p className="text-[10px] text-slate-500 uppercase font-bold">Comodines Usados</p>
                  </div>
                </div>
                <div className="w-px h-8 bg-slate-200 dark:bg-white/10" />
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-500">
                    <Activity size={16} />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-900 dark:text-[#F3F1EA]">{stats.predictedCount}</p>
                    <p className="text-[10px] text-slate-500 uppercase font-bold">Predicciones Guardadas</p>
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

        {/* Medallas (preview) — el detalle completo está en la pestaña Medallas */}
        <motion.div
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
          className="mt-6 glass-card p-4 flex items-center gap-3 overflow-x-auto scrollbar-hide"
        >
          <div className="flex items-center gap-2 text-slate-500 mr-1 flex-shrink-0">
            <Trophy size={16} />
            <span className="text-xs font-bold uppercase tracking-wider">Medallas</span>
          </div>
          {Object.keys(medalsAgg).length ? (
            <MedalStrip keys={Object.entries(medalsAgg).map(([k, v]) => ({ badge_key: k, tier: v.tier }))} max={14} />
          ) : (
            <span className="text-xs text-slate-400 italic">Aún no desbloqueaste medallas</span>
          )}
        </motion.div>

        <PushNotificationToggle />

        {/* Ajustes / acciones (movidos aquí al quitar la barra superior) */}
        <div className="mt-6 space-y-2">
          <div className="font-['JetBrains_Mono'] font-bold text-[9.5px] tracking-[0.14em] text-[var(--text-muted,#8A8A8A)] mb-2 px-1">AJUSTES</div>

          <button onClick={toggleTheme}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-white dark:bg-[#161616] border border-slate-200 dark:border-[#262626] text-slate-700 dark:text-[#F3F1EA] font-['Archivo'] font-semibold text-sm">
            {theme === 'light' ? <Moon size={18} className="text-accent" /> : <Sun size={18} className="text-accent" />}
            Modo {theme === 'light' ? 'oscuro' : 'claro'}
          </button>

          <button onClick={() => navigate('/rules')}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-white dark:bg-[#161616] border border-slate-200 dark:border-[#262626] text-slate-700 dark:text-[#F3F1EA] font-['Archivo'] font-semibold text-sm">
            <BookOpen size={18} className="text-accent" /> Reglas del juego
          </button>

          {profile?.is_admin && (
            <button onClick={() => navigate('/admin')}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-white dark:bg-[#161616] border border-slate-200 dark:border-[#262626] text-[#FF7A59] font-['Archivo'] font-semibold text-sm">
              <ShieldAlert size={18} /> Panel de administración
            </button>
          )}

          <details className="rounded-xl border border-slate-200 bg-white dark:border-[#262626] dark:bg-[#161616]">
            <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 font-['Archivo'] text-sm font-semibold text-slate-700 dark:text-[#F3F1EA]">
              <Wrench size={18} className="text-slate-400" />
              Solución de problemas
              <span className="ml-auto text-[10px] font-normal text-[var(--text-muted,#8A8A8A)]">Opcional</span>
            </summary>
            <div className="border-t border-slate-100 px-4 pb-4 pt-3 dark:border-white/5">
              <p className="mb-3 text-[11px] leading-relaxed text-[var(--text-muted,#8A8A8A)]">
                Usalo solo si la app parece mostrar una versión anterior. No borra tu cuenta ni tus predicciones.
              </p>
              <button
                onClick={async () => {
                  if (refreshingApp) return
                  setRefreshingApp(true)
                  try { await refreshApplication() } catch { window.location.reload() }
                }}
                disabled={refreshingApp}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-slate-100 px-3 py-2.5 text-xs font-bold text-slate-700 disabled:opacity-60 dark:bg-white/[0.06] dark:text-slate-200">
                <RefreshCw size={14} className={refreshingApp ? 'animate-spin' : ''} />
                {refreshingApp ? 'Actualizando…' : 'Buscar actualización y limpiar caché'}
              </button>
            </div>
          </details>

          <button onClick={async () => { try { await signOut(); navigate('/auth') } catch (e) { console.error(e) } }}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-[#FF5A5A]/10 border border-[#FF5A5A]/25 text-[#FF5A5A] font-['Archivo'] font-semibold text-sm">
            <LogOut size={18} /> Cerrar sesión
          </button>
        </div>

        <div className="flex gap-4 mt-6 border-b border-white/10 pb-1">
          <button 
            onClick={() => setActiveTab('predictions')}
            className={`flex-1 py-2.5 text-sm font-bold rounded-lg transition-all whitespace-nowrap px-4 ${activeTab === 'predictions' ? 'bg-white dark:bg-white/10 text-accent shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
          >
            Predicciones
          </button>
          <button 
            onClick={() => setActiveTab('global')}
            className={`flex-1 py-2.5 text-sm font-bold rounded-lg transition-all whitespace-nowrap px-4 ${activeTab === 'global' ? 'bg-white dark:bg-white/10 text-accent shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
          >
            Globales
          </button>
          <button 
            onClick={() => setActiveTab('badges')}
            className={`flex-1 py-2.5 text-sm font-bold rounded-lg transition-all whitespace-nowrap px-4 flex items-center justify-center gap-1.5 ${activeTab === 'badges' ? 'bg-white dark:bg-white/10 text-accent shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
          >
            Medallas
          </button>
          <button 
            onClick={() => setActiveTab('history')}
            className={`flex-1 py-2.5 text-sm font-bold rounded-lg transition-all whitespace-nowrap px-4 ${activeTab === 'history' ? 'bg-white dark:bg-white/10 text-accent shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
          >
            Historial
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
                   <EmptyState title="Todavía no hiciste predicciones" description="Entrá a una quiniela y elegí un marcador antes del cierre." />
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

            {activeTab === 'global' && (
              <motion.div
                initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
                className="space-y-4"
              >
                {globalPrediction ? (
                  <div className="glass-card p-5">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2 text-accent">
                        <Trophy size={20} />
                        <h3 className="font-bold text-slate-900 dark:text-white">Mis Predicciones Globales</h3>
                      </div>
                      {!isPredictionsLocked && (
                        <button 
                          onClick={() => setIsModalOpen(true)}
                          className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 dark:bg-white/10 dark:hover:bg-white/20 text-xs font-bold rounded-lg transition-colors"
                        >
                          Editar
                        </button>
                      )}
                    </div>
                    
                    <div className="space-y-4">
                      <div className="p-4 bg-slate-50 dark:bg-white/5 border border-slate-100 dark:border-white/10 rounded-xl">
                        <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Equipo Campeón</p>
                        <p className="font-bold text-slate-900 dark:text-white text-lg flex items-center gap-2">
                          {globalPrediction.champion_team ? (
                            <>
                              {globalPrediction.champion_team}
                            </>
                          ) : (
                            <span className="text-slate-400 italic">No seleccionado</span>
                          )}
                        </p>
                      </div>

                      <div className="p-4 bg-slate-50 dark:bg-white/5 border border-slate-100 dark:border-white/10 rounded-xl">
                        <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Goleador del Torneo</p>
                        <p className="font-bold text-slate-900 dark:text-white text-lg flex items-center gap-2">
                          {globalPrediction.top_scorer_name ? (
                            <>
                              <Target size={18} className="text-accent" />
                              {globalPrediction.top_scorer_name}
                            </>
                          ) : (
                            <span className="text-slate-400 italic">No seleccionado</span>
                          )}
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-10">
                    <Trophy size={48} className="mx-auto text-slate-300 dark:text-slate-600 mb-3" />
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-1">Sin Predicciones Globales</h3>
                    <p className="text-sm text-slate-500 mb-5">Aún no has elegido al campeón ni al goleador del torneo.</p>
                    {!isPredictionsLocked ? (
                      <button 
                        onClick={() => setIsModalOpen(true)}
                        className="px-5 py-2.5 bg-accent hover:bg-accent-light text-white font-bold rounded-xl transition-colors shadow-lg shadow-accent/20"
                      >
                        Hacer Predicciones
                      </button>
                    ) : (
                      <p className="text-xs text-rose-500 font-bold bg-rose-500/10 inline-block px-3 py-1 rounded-full">Las predicciones ya están cerradas</p>
                    )}
                  </div>
                )}
              </motion.div>
            )}

            {activeTab === 'badges' && (
              <motion.div initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }}>
                <div className="glass-card p-4">
                  <BadgeShowcase earned={medalsAgg} />
                </div>
              </motion.div>
            )}

            {activeTab === 'history' && (
              <motion.div key="logs" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }}>
                {logs.length === 0 ? (
                  <EmptyState title="Sin actividad todavía" description="Tus cambios de predicción aparecerán acá." />
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
        {/* Spacer para que el BottomNav no tape en móvil */}
        <div className="h-32 w-full shrink-0 md:hidden pointer-events-none" />
      </div>
      
      <GlobalPredictionsModal 
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        initialData={globalPrediction}
        userId={profile?.id}
        onSaved={fetchData}
      />
    </div>
  )
}
