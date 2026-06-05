// Barra de navegación inferior estilo iOS con 5 pestañas
import { NavLink } from 'react-router-dom'
import { Home, Calendar, GitBranch, Trophy, Users } from 'lucide-react'
import { motion } from 'motion/react'

const tabs = [
  { to: '/', icon: Home, label: 'Inicio' },
  { to: '/matches', icon: Calendar, label: 'Partidos' },
  { to: '/bracket', icon: GitBranch, label: 'Bracket' },
  { to: '/leaderboard', icon: Trophy, label: 'Ranking' },
  { to: '/leagues', icon: Users, label: 'Ligas' },
]

export default function BottomNav() {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 glass-nav pb-safe">
      <div className="flex items-center justify-around h-16 max-w-lg mx-auto px-2">
        {tabs.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className="flex-1"
          >
            {({ isActive }) => (
              <motion.div
                whileTap={{ scale: 0.9 }}
                className={`flex flex-col items-center gap-0.5 py-1 transition-colors ${
                  isActive ? 'text-accent' : 'text-slate-500'
                }`}
              >
                <div className="relative">
                  <Icon size={22} strokeWidth={isActive ? 2.5 : 1.8} />
                  {/* Indicador luminoso debajo del ícono activo */}
                  {isActive && (
                    <motion.div
                      layoutId="nav-indicator"
                      className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-accent"
                      transition={{ type: 'spring', stiffness: 300, damping: 25 }}
                    />
                  )}
                </div>
                <span className={`text-[10px] font-medium ${isActive ? 'text-accent' : 'text-slate-500'}`}>
                  {label}
                </span>
              </motion.div>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
