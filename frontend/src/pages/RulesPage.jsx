import { BookOpen, Target, Zap, Trophy, ShieldAlert } from 'lucide-react'
import { motion } from 'motion/react'

export default function RulesPage() {
  return (
    <div className="px-4 py-5 bg-world-cup h-full min-h-screen md:min-h-0 relative overflow-y-auto pb-24 md:pb-6">
      {/* Premium header */}
      <motion.div
        initial={{ opacity: 0, y: -15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="mb-6 relative z-10"
      >
        <div className="flex items-center gap-3 mb-1.5">
          <div className="w-10 h-10 rounded-2xl gradient-gold flex items-center justify-center shadow-lg shadow-amber-500/20">
            <BookOpen size={20} className="text-slate-900" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">Reglas de Juego</h1>
            <p className="text-xs text-slate-600 dark:text-slate-400">Todo lo que necesitas saber para ganar</p>
          </div>
        </div>
        <div className="mt-4 h-px w-full bg-gradient-to-r from-transparent via-slate-300 dark:via-white/10 to-transparent" />
      </motion.div>

      <div className="max-w-3xl mx-auto space-y-6">
        {/* Sistema de Puntos */}
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="bg-white dark:bg-slate-900 rounded-2xl p-5 md:p-6 shadow-lg shadow-black/5 border border-slate-200 dark:border-white/5"
        >
          <div className="flex items-center gap-3 mb-4">
            <Target size={24} className="text-blue-500" />
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">Sistema de Puntos</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-slate-50 dark:bg-black/20 p-4 rounded-xl border border-slate-100 dark:border-white/5">
              <div className="text-2xl font-black text-accent mb-1">3 Pts</div>
              <h3 className="font-bold text-slate-800 dark:text-slate-200 text-sm mb-2">Marcador Exacto</h3>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Aciertas tanto el ganador como la cantidad exacta de goles de cada equipo. (Ej. Predices 2-1 y el partido termina 2-1).
              </p>
            </div>
            <div className="bg-slate-50 dark:bg-black/20 p-4 rounded-xl border border-slate-100 dark:border-white/5">
              <div className="text-2xl font-black text-blue-500 mb-1">1 Pt</div>
              <h3 className="font-bold text-slate-800 dark:text-slate-200 text-sm mb-2">Resultado Correcto</h3>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Aciertas quién gana (o si es empate), pero no el marcador exacto. (Ej. Predices 2-0 y el partido termina 3-1).
              </p>
            </div>
          </div>
        </motion.section>

        {/* Comodín x2 */}
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="bg-gradient-to-br from-indigo-50 to-purple-50 dark:from-slate-900 dark:to-slate-800 rounded-2xl p-5 md:p-6 shadow-lg shadow-purple-500/5 border border-purple-100 dark:border-purple-500/20"
        >
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center">
              <Zap size={18} className="text-accent fill-current" />
            </div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">Comodines Multiplicadores (x2)</h2>
          </div>
          <p className="text-sm text-slate-700 dark:text-slate-300 mb-4 leading-relaxed">
            Puedes usar el comodín <strong>x2</strong> para duplicar los puntos que ganes en un partido específico. 
            Si aciertas el marcador exacto con x2, ¡te llevas 6 puntos!
          </p>
          <div className="bg-white/60 dark:bg-black/20 rounded-xl p-4 border border-purple-200/50 dark:border-white/5">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3">Límites de Uso</h3>
            <ul className="space-y-2 text-sm text-slate-700 dark:text-slate-300">
              <li className="flex justify-between items-center">
                <span>Fase de Grupos (por jornada)</span>
                <span className="font-bold text-accent">4 comodines</span>
              </li>
              <li className="flex justify-between items-center">
                <span>Ronda de 32 (Dieciseisavos)</span>
                <span className="font-bold text-accent">3 comodines</span>
              </li>
              <li className="flex justify-between items-center">
                <span>Octavos de Final</span>
                <span className="font-bold text-accent">2 comodines</span>
              </li>
              <li className="flex justify-between items-center">
                <span>Cuartos, Semis y Finales</span>
                <span className="font-bold text-accent">1 comodín</span>
              </li>
            </ul>
          </div>
        </motion.section>

        {/* Fases Eliminatorias */}
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="bg-white dark:bg-slate-900 rounded-2xl p-5 md:p-6 shadow-lg shadow-black/5 border border-slate-200 dark:border-white/5"
        >
          <div className="flex items-center gap-3 mb-4">
            <Trophy size={24} className="text-amber-500" />
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">Fases Eliminatorias (Knockout)</h2>
          </div>
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <div className="mt-0.5"><ShieldAlert size={16} className="text-slate-400" /></div>
              <div>
                <h3 className="font-bold text-sm text-slate-800 dark:text-slate-200">Marcador en los 120 minutos</h3>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                  Tu predicción de goles (Ej. 1-1) cuenta para el resultado al final de los 90 minutos más la prórroga (120 min). Los goles de la tanda de penales no se suman a este marcador.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="mt-0.5"><ShieldAlert size={16} className="text-slate-400" /></div>
              <div>
                <h3 className="font-bold text-sm text-slate-800 dark:text-slate-200">Definición por Penales</h3>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                  Si predices un empate (Ej. 1-1), el sistema te pedirá que elijas quién avanzará ganando en la tanda de penales. Este pronóstico también forma parte de la predicción y puede definir si recibes puntos por acertar al ganador del partido.
                </p>
              </div>
            </div>
          </div>
        </motion.section>

        {/* Cierre */}
        <div className="text-center pb-8 pt-4">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Los resultados oficiales se sincronizan con los datos de FIFA. 
            Todas las predicciones se bloquean en el instante en que inicia cada partido.
          </p>
        </div>
      </div>
    </div>
  )
}
