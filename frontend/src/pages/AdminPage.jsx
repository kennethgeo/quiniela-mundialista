import { useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { ShieldAlert, Trophy, CalendarDays, Calculator, Users, Settings2 } from 'lucide-react'

import TournamentsAdmin from '../components/admin/TournamentsAdmin'
import TournamentMatchesAdmin from '../components/admin/TournamentMatchesAdmin'
import VerificarMarcadores from '../components/admin/VerificarMarcadores'
import TournamentGlobalsAdmin from '../components/admin/TournamentGlobalsAdmin'
import BracketAdmin from '../components/admin/BracketAdmin'
import MatchResultsAdmin from '../components/admin/MatchResultsAdmin'
import RecalcScoresAdmin from '../components/admin/RecalcScoresAdmin'
import ScoreReconcileAdmin from '../components/admin/ScoreReconcileAdmin'
import UserManagementAdmin from '../components/admin/UserManagementAdmin'
import BannedEmailsAdmin from '../components/admin/BannedEmailsAdmin'
import AnnouncementsAdmin from '../components/admin/AnnouncementsAdmin'
import AvatarOptimizerAdmin from '../components/admin/AvatarOptimizerAdmin'

// Pestañas agrupadas por flujo de trabajo (antes: 5 pestañas planas con 14
// componentes amontonados, varios sin relación entre sí — "Configuración
// Global" mezclaba torneos, anuncios, reconciliación de puntos y un
// optimizador de avatares en una sola lista sin separación).
const TABS = [
  { id: 'tournaments', label: 'Torneos', icon: Trophy },
  { id: 'matches', label: 'Resultados', icon: CalendarDays },
  { id: 'scoring', label: 'Puntaje', icon: Calculator },
  { id: 'users', label: 'Usuarios', icon: Users },
  { id: 'site', label: 'Sitio', icon: Settings2 },
]

// Divisor con título dentro de una pestaña, para que varios componentes
// agrupados no queden apilados sin ninguna separación visual entre ellos.
function AdminSection({ icon: Icon, title, desc, children }) {
  return (
    <div className="mb-8 last:mb-0">
      <div className="flex items-center gap-2 mb-0.5">
        {Icon && <Icon size={15} className="text-accent shrink-0" />}
        <h2 className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">{title}</h2>
      </div>
      {desc && <p className="text-xs text-slate-400 dark:text-slate-500 mb-3">{desc}</p>}
      <div className={desc ? 'space-y-4' : 'space-y-4 mt-3'}>{children}</div>
    </div>
  )
}

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState('tournaments')

  return (
    <div className="px-4 py-5 bg-world-cup h-full min-h-screen md:min-h-0 relative">
      <motion.div
        initial={{ opacity: 0, y: -15 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-6 relative z-10"
      >
        <div className="flex items-center gap-3 mb-1.5">
          <div className="w-10 h-10 rounded-2xl bg-rose-500/20 flex items-center justify-center border border-rose-500/30">
            <ShieldAlert size={20} className="text-rose-500" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">Panel de Administración</h1>
            <p className="text-xs text-slate-500">Solo usuarios con is_admin = true</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-4 mt-6 border-b border-white/10 pb-1 overflow-x-auto scrollbar-hide">
          {TABS.map((t) => {
            const Icon = t.icon
            const active = activeTab === t.id
            return (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={`pb-3 shrink-0 flex items-center gap-1.5 text-sm font-bold transition-colors relative ${active ? 'text-accent' : 'text-slate-500 hover:text-slate-300'}`}
              >
                <Icon size={14} /> {t.label}
                {active && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent rounded-t-full" />}
              </button>
            )
          })}
        </div>
      </motion.div>

      <AnimatePresence mode="wait">
        {activeTab === 'tournaments' && (
          <motion.div key="tournaments" initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12 }} className="relative z-10 pb-20">
            <AdminSection icon={Trophy} title="Torneos" desc="Crear/editar torneos y cargar sus fixtures.">
              <TournamentsAdmin />
              <TournamentMatchesAdmin />
            </AdminSection>
            <AdminSection icon={Trophy} title="Predicciones globales" desc="Campeón, goleador y asistidor reales de cada torneo.">
              <TournamentGlobalsAdmin />
            </AdminSection>
            <AdminSection icon={Trophy} title="Bracket de eliminatoria" desc="Solo Mundial 2026.">
              <BracketAdmin />
            </AdminSection>
          </motion.div>
        )}

        {activeTab === 'matches' && (
          <motion.div key="matches" initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12 }} className="relative z-10 pb-20">
            <MatchResultsAdmin />
          </motion.div>
        )}

        {activeTab === 'scoring' && (
          <motion.div key="scoring" initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12 }} className="relative z-10 pb-20">
            {/* PowerupsAdmin se quitó: editaba la tabla powerup_limits, que dejó
                de controlar el puntaje en la migración 48. El cupo que de verdad
                se aplica es leagues.powerup_limit y cada quiniela lo configura en
                su propia pestaña Reglas. El panel guardaba, decía "listo" y no
                cambiaba el límite real — peor que no tenerlo. */}
            <AdminSection icon={Calculator} title="Recalcular y reconciliar" desc="Herramientas de mantenimiento del puntaje.">
              <RecalcScoresAdmin />
              <ScoreReconcileAdmin />
              <VerificarMarcadores />
            </AdminSection>
          </motion.div>
        )}

        {activeTab === 'users' && (
          <motion.div key="users" initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12 }} className="relative z-10 pb-20">
            <AdminSection icon={Users} title="Usuarios">
              <UserManagementAdmin />
            </AdminSection>
            <AdminSection icon={Users} title="Correos baneados" desc="Impide que se vuelvan a registrar.">
              <BannedEmailsAdmin />
            </AdminSection>
          </motion.div>
        )}

        {activeTab === 'site' && (
          <motion.div key="site" initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12 }} className="relative z-10 pb-20">
            <AdminSection icon={Settings2} title="Anuncios">
              <AnnouncementsAdmin />
            </AdminSection>
            <AdminSection icon={Settings2} title="Avatares" desc="Optimiza las imágenes de perfil ya subidas.">
              <AvatarOptimizerAdmin />
            </AdminSection>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
