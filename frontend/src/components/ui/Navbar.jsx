// Barra de navegación superior con nombre de la app y avatar del usuario
import { useAuth } from '../../hooks/useAuth'
import { LogOut, Star } from 'lucide-react'
import { motion } from 'motion/react'

export default function Navbar() {
  const { profile, signOut } = useAuth()

  const handleSignOut = async () => {
    try {
      await signOut()
    } catch (err) {
      console.error('Error al cerrar sesión:', err.message)
    }
  }

  return (
    <header className="sticky top-0 z-40 glass-nav border-b border-white/[0.06] md:hidden">
      <div className="flex items-center justify-between h-14 px-4 max-w-4xl mx-auto">
        {/* Nombre de la app */}
        <h1 className="text-lg font-bold text-white tracking-tight flex items-center gap-1.5">
          <span className="text-xl">⚽</span>
          <span className="bg-gradient-to-r from-white to-slate-300 bg-clip-text text-transparent">
            Quiniela
          </span>
          <span className="bg-gradient-to-r from-amber-400 to-amber-500 bg-clip-text text-transparent">
            Mundialista
          </span>
        </h1>

        {/* Info del usuario */}
        <div className="flex items-center gap-2.5">
          {/* Puntos totales — golden badge */}
          {profile && (
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex items-center gap-1 px-2.5 py-1 rounded-xl bg-amber-500/10 border border-amber-500/20"
            >
              <Star size={12} fill="currentColor" className="text-amber-400" />
              <span className="text-amber-400 font-bold text-xs tabular-nums">{profile.total_points ?? 0}</span>
            </motion.div>
          )}

          {/* Avatar del usuario */}
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-accent/25 to-accent/5 border border-accent/25 flex items-center justify-center text-accent font-bold text-sm shadow-md shadow-amber-500/10">
              {profile?.display_name?.charAt(0)?.toUpperCase() || '?'}
            </div>

            {/* Botón cerrar sesión */}
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={handleSignOut}
              className="p-1.5 rounded-xl text-slate-500 hover:text-slate-300 hover:bg-white/5 transition-all"
              title="Cerrar sesión"
            >
              <LogOut size={16} />
            </motion.button>
          </div>
        </div>
      </div>
    </header>
  )
}
