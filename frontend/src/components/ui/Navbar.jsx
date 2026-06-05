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
    <header className="sticky top-0 z-40 glass-nav border-b border-white/5">
      <div className="flex items-center justify-between h-14 px-4 max-w-lg mx-auto">
        {/* Nombre de la app */}
        <h1 className="text-lg font-bold text-white tracking-tight">
          ⚽ Quiniela Mundialista
        </h1>

        {/* Info del usuario */}
        <div className="flex items-center gap-3">
          {/* Puntos totales */}
          {profile && (
            <motion.div
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              className="flex items-center gap-1 text-accent font-semibold text-sm"
            >
              <Star size={14} fill="currentColor" />
              <span>{profile.total_points ?? 0}</span>
            </motion.div>
          )}

          {/* Avatar del usuario */}
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-accent/20 border border-accent/30 flex items-center justify-center text-accent font-bold text-sm">
              {profile?.display_name?.charAt(0)?.toUpperCase() || '?'}
            </div>

            {/* Botón cerrar sesión */}
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={handleSignOut}
              className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-white/5 transition-colors"
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
