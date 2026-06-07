import { NavLink, useNavigate } from 'react-router-dom'
import { Home, Calendar, GitBranch, Trophy, Star, X, ShieldAlert, Moon, Sun, LogOut, User } from 'lucide-react'
import { motion, AnimatePresence } from 'motion/react'
import { useAuth } from '../../hooks/useAuth'
import { useTheme } from '../../contexts/ThemeContext'

const tabs = [
  { to: '/', icon: Home, label: 'Inicio' },
  { to: '/matches', icon: Calendar, label: 'Partidos' },
  { to: '/bracket', icon: GitBranch, label: 'Bracket' },
  { to: '/leaderboard', icon: Trophy, label: 'Ranking' },
  { to: '/profile', icon: User, label: 'Mi Perfil' },
]

export default function Sidebar({ isOpen, onClose }) {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const { theme, toggleTheme } = useTheme()

  const handleSignOut = async () => {
    try {
      await signOut()
      navigate('/login')
    } catch (err) {
      console.error('Error al cerrar sesión:', err.message)
    }
  }

  return (
    <>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            onClick={onClose}
            className="fixed inset-0 bg-slate-950/80 z-40 md:hidden"
          />
        )}
      </AnimatePresence>

      <aside
        className={`fixed md:static top-0 left-0 w-64 h-dvh shrink-0 flex flex-col glass-nav border-r border-white/5 z-50 pt-6 pb-6 px-4 shadow-2xl md:shadow-none transition-transform duration-300 md:translate-x-0 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Header: Logo & Close Button */}
        <div className="flex items-center justify-between mb-8 px-2">
              <div className="flex items-center gap-2.5">
                <span className="text-2xl">⚽</span>
                <h1 className="text-xl font-bold tracking-tight leading-tight">
                  <span className="text-white block">Quiniela</span>
                  <span className="bg-gradient-to-r from-amber-400 to-amber-500 bg-clip-text text-transparent block">
                    Mundialista
                  </span>
                </h1>
              </div>
              <button 
                onClick={onClose} 
                className="p-1.5 rounded-full text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            {/* Navigation */}
            <nav className="flex-1 space-y-1.5">
              {tabs.map(({ to, icon: Icon, label }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={to === '/'}
                  className="block"
                  onClick={onClose}
                >
                  {({ isActive }) => (
                    <motion.div
                      whileHover={{ x: 4 }}
                      whileTap={{ scale: 0.98 }}
                      className={`flex items-center gap-3.5 px-4 py-3 rounded-2xl transition-all duration-300 ${
                        isActive 
                          ? 'bg-slate-200/80 dark:bg-white/10 text-slate-900 dark:text-white shadow-[0_4px_24px_rgba(0,0,0,0.05)] dark:shadow-[0_4px_24px_rgba(255,255,255,0.05)] border border-slate-300/50 dark:border-white/10' 
                          : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/5 border border-transparent'
                      }`}
                    >
                      <div className="relative">
                        <Icon size={20} strokeWidth={isActive ? 2.5 : 2} className={isActive ? 'text-accent' : ''} />
                        {isActive && (
                          <div className="absolute inset-0 bg-accent/20 blur-md rounded-full" />
                        )}
                      </div>
                      <span className={`text-sm font-semibold ${isActive ? 'text-slate-900 dark:text-white' : ''}`}>
                        {label}
                      </span>
                    </motion.div>
                  )}
                </NavLink>
              ))}

              {profile?.is_admin && (
                <NavLink
                  to="/admin"
                  className="block mt-4 pt-4 border-t border-white/[0.06]"
                  onClick={onClose}
                >
                  {({ isActive }) => (
                    <motion.div
                      whileHover={{ x: 4 }}
                      whileTap={{ scale: 0.98 }}
                      className={`flex items-center gap-3.5 px-4 py-3 rounded-2xl transition-all duration-300 ${
                        isActive 
                          ? 'bg-rose-500/20 text-rose-400 shadow-[0_4px_24px_rgba(244,63,94,0.15)] border border-rose-500/30' 
                          : 'text-rose-500/70 hover:text-rose-400 hover:bg-rose-500/10 border border-transparent'
                      }`}
                    >
                      <div className="relative">
                        <ShieldAlert size={20} strokeWidth={isActive ? 2.5 : 2} />
                        {isActive && <div className="absolute inset-0 bg-rose-500/20 blur-md rounded-full" />}
                      </div>
                      <span className={`text-sm font-semibold ${isActive ? 'text-rose-400' : ''}`}>
                        Panel Admin
                      </span>
                    </motion.div>
                  )}
                </NavLink>
              )}
            </nav>

            {/* User Profile Footer */}
            {profile && (
              <div className="mt-auto pt-6 border-t border-white/[0.06]">
                <div className="flex items-center gap-3 mb-4 px-2">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-accent/25 to-accent/5 border border-accent/25 flex items-center justify-center text-accent font-bold shadow-lg shadow-accent/10">
                    {profile?.display_name?.charAt(0)?.toUpperCase() || '?'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-white truncate">
                      {profile?.display_name || 'Jugador'}
                    </p>
                    <div className="flex items-center gap-1 mt-0.5">
                      <Star size={10} fill="currentColor" className="text-accent" />
                      <span className="text-accent font-bold text-xs tabular-nums">
                        {profile?.total_points ?? 0} pts
                      </span>
                    </div>
                  </div>
                </div>
                
                <div className="flex flex-col gap-3 pb-safe">
                  <button
                    onClick={toggleTheme}
                    className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded-2xl font-semibold bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white transition-all border border-white/5 shadow-sm"
                    title={`Cambiar a modo ${theme === 'light' ? 'oscuro' : 'claro'}`}
                  >
                    {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
                    <span className="text-[13px]">
                      Modo {theme === 'light' ? 'Oscuro' : 'Claro'}
                    </span>
                  </button>
                  
                  <button
                    onClick={() => { onClose(); handleSignOut(); }}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-2xl text-[13px] font-semibold text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-all border border-transparent"
                  >
                    <LogOut size={18} />
                    Cerrar sesión
                  </button>
                </div>
              </div>
            )}
          </aside>
    </>
  )
}
