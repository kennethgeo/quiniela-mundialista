// Barra superior mínima (solo móvil): logo + switch de tema.
// El escritorio ya tiene estos controles en el Sidebar.
import { Moon, Sun } from 'lucide-react'
import { useTheme } from '../../contexts/ThemeContext'
import { TicoLogo } from '../auth/TicoBrand'

export default function QuickBar() {
  const { theme, toggleTheme } = useTheme()

  const btn = 'w-9 h-9 grid place-items-center rounded-xl bg-white/70 dark:bg-white/5 border border-slate-200 dark:border-[#262626] text-slate-600 dark:text-[#F3F1EA] active:scale-95 transition-transform'

  return (
    <div className="md:hidden sticky top-0 z-30 flex items-center justify-between px-4 pt-[max(0.45rem,env(safe-area-inset-top))] pb-2 bg-[var(--bg-body)]/85 backdrop-blur-md">
      <TicoLogo size={28} />
      <button onClick={toggleTheme} className={btn} title="Modo claro / oscuro" aria-label="Cambiar tema">
        {theme === 'light' ? <Moon size={17} /> : <Sun size={17} />}
      </button>
    </div>
  )
}
