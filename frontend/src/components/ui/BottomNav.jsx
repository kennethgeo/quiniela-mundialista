// Barra de navegación inferior estilo iOS con 5 pestañas
import { NavLink } from 'react-router-dom'
import { Home, User } from 'lucide-react'
import { motion } from 'motion/react'

// Top-level: solo lo global. Partidos/Bracket/Tabla/Torneo viven DENTRO de cada
// quiniela (son por-torneo), no en la nav global.
const tabs = [
  { to: '/', icon: Home, label: 'Mis quinielas' },
  { to: '/profile', icon: User, label: 'Perfil' },
]

export default function BottomNav() {
  return (
    <nav className="w-full glass-nav border-t border-slate-200 dark:border-white/5 pb-safe z-50 md:hidden">
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
                  isActive ? 'text-accent' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                }`}
              >
                <div className="relative">
                  <Icon size={22} strokeWidth={isActive ? 2.5 : 1.8} />
                  {/* Glow indicator for active tab */}
                  {isActive && (
                    <motion.div
                      layoutId="nav-indicator"
                      className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-4 h-1 rounded-full bg-accent shadow-[0_0_8px_rgba(47,221,154,0.55)]"
                      transition={{ type: 'spring', stiffness: 350, damping: 28 }}
                    />
                  )}
                  {/* Subtle ambient glow behind active icon */}
                  {isActive && (
                    <div className="absolute inset-0 -m-1 rounded-full bg-accent/15 blur-md pointer-events-none" />
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
