// Barra de navegación inferior estilo iOS con 5 pestañas
import { NavLink } from 'react-router-dom'
import { Home, Calendar, GitBranch, Trophy, Users } from 'lucide-react'
import { motion } from 'motion/react'

const tabs = [
  { to: '/', icon: Home, label: 'Inicio' },
  { to: '/matches', icon: Calendar, label: 'Partidos' },
  { to: '/bracket', icon: GitBranch, label: 'Bracket' },
  { to: '/leaderboard', icon: Trophy, label: 'Ranking' },
]

export default function BottomNav() {
  return (
    <nav className="fixed bottom-0 left-0 right-0 glass-nav border-t border-white/5 pb-safe z-50 md:hidden">
      <div className="flex items-center justify-around h-16 max-w-4xl mx-auto px-2">
        {tabs.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className="flex-1"
          >
            {({ isActive }) => (
              <motion.div
                whileTap={{ scale: 0.85 }}
                className={`flex flex-col items-center gap-0.5 py-1.5 transition-all duration-200 ${
                  isActive ? 'text-accent' : 'text-slate-500'
                }`}
              >
                <div className="relative">
                  <Icon size={22} strokeWidth={isActive ? 2.5 : 1.8} />
                  {/* Glow indicator for active tab */}
                  {isActive && (
                    <motion.div
                      layoutId="nav-indicator"
                      className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-4 h-1 rounded-full bg-accent shadow-[0_0_8px_rgba(245,158,11,0.5)]"
                      transition={{ type: 'spring', stiffness: 350, damping: 28 }}
                    />
                  )}
                  {/* Subtle ambient glow behind active icon */}
                  {isActive && (
                    <div className="absolute inset-0 -m-1 rounded-full bg-accent/10 blur-md pointer-events-none" />
                  )}
                </div>
                <span className={`text-[10px] font-semibold ${isActive ? 'text-accent' : 'text-slate-500'}`}>
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
