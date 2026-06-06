import { NavLink } from 'react-router-dom'
import { Home, Calendar, GitBranch, Trophy, Users, LogOut, Star } from 'lucide-react'
import { motion } from 'motion/react'
import { useAuth } from '../../hooks/useAuth'

const tabs = [
  { to: '/', icon: Home, label: 'Inicio' },
  { to: '/matches', icon: Calendar, label: 'Partidos' },
  { to: '/bracket', icon: GitBranch, label: 'Bracket' },
  { to: '/leaderboard', icon: Trophy, label: 'Ranking' },
  { to: '/leagues', icon: Users, label: 'Ligas' },
]

export default function Sidebar() {
  const { profile, signOut } = useAuth()

  const handleSignOut = async () => {
    try {
      await signOut()
    } catch (err) {
      console.error('Error al cerrar sesión:', err.message)
    }
  }

  return (
    <aside className="hidden md:flex flex-col w-64 h-dvh fixed top-0 left-0 glass-nav border-r border-white/[0.06] z-50 pt-8 pb-6 px-4">
      {/* App Logo */}
      <div className="flex items-center gap-2.5 mb-10 px-2">
        <span className="text-2xl">⚽</span>
        <h1 className="text-xl font-bold tracking-tight">
          <span className="text-white">Quiniela</span>
          <br/>
          <span className="bg-gradient-to-r from-amber-400 to-amber-500 bg-clip-text text-transparent">
            Mundialista
          </span>
        </h1>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1.5">
        {tabs.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className="block"
          >
            {({ isActive }) => (
              <motion.div
                whileHover={{ x: 4 }}
                whileTap={{ scale: 0.98 }}
                className={`flex items-center gap-3.5 px-4 py-3 rounded-2xl transition-all duration-300 ${
                  isActive 
                    ? 'bg-white/10 text-white shadow-[0_4px_24px_rgba(255,255,255,0.05)] border border-white/10' 
                    : 'text-slate-400 hover:text-slate-200 hover:bg-white/5 border border-transparent'
                }`}
              >
                <div className="relative">
                  <Icon size={20} strokeWidth={isActive ? 2.5 : 2} className={isActive ? 'text-accent' : ''} />
                  {isActive && (
                    <div className="absolute inset-0 bg-accent/20 blur-md rounded-full" />
                  )}
                </div>
                <span className={`text-sm font-semibold ${isActive ? 'text-white' : ''}`}>
                  {label}
                </span>
              </motion.div>
            )}
          </NavLink>
        ))}
      </nav>

      {/* User Profile Footer */}
      {profile && (
        <div className="mt-auto pt-6 border-t border-white/[0.06]">
          <div className="flex items-center gap-3 mb-4 px-2">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-accent/25 to-accent/5 border border-accent/25 flex items-center justify-center text-accent font-bold shadow-lg shadow-amber-500/10">
              {profile?.display_name?.charAt(0)?.toUpperCase() || '?'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-white truncate">
                {profile?.display_name || 'Jugador'}
              </p>
              <div className="flex items-center gap-1 mt-0.5">
                <Star size={10} fill="currentColor" className="text-amber-400" />
                <span className="text-amber-400 font-bold text-xs tabular-nums">
                  {profile?.total_points ?? 0} pts
                </span>
              </div>
            </div>
          </div>
          
          <button
            onClick={handleSignOut}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-400 hover:text-white hover:bg-white/10 transition-all border border-transparent hover:border-white/5"
          >
            <LogOut size={16} />
            Cerrar sesión
          </button>
        </div>
      )}
    </aside>
  )
}
