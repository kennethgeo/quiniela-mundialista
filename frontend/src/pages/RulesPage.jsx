import { BookOpen, Target, Zap, Trophy, ShieldAlert, Clock, AlertTriangle } from 'lucide-react'
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

      <div className="max-w-3xl mx-auto space-y-8">
        
        {/* Banner de Bloqueo de Partidos */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5 }}
          className="bg-rose-500/10 dark:bg-rose-500/5 border border-rose-500/20 rounded-2xl p-4 md:p-5 flex items-start gap-4"
        >
          <div className="mt-1 w-10 h-10 rounded-full bg-rose-500/20 flex items-center justify-center shrink-0">
            <Clock size={20} className="text-rose-600 dark:text-rose-400" />
          </div>
          <div>
            <h3 className="font-bold text-rose-700 dark:text-rose-300 mb-1">¡Cierre de Predicciones!</h3>
            <p className="text-sm text-rose-600/80 dark:text-rose-400/80 leading-relaxed">
              Las predicciones se bloquean <strong>exactamente 15 minutos antes</strong> de que inicie cada partido. Hasta entonces, puedes cambiarlas las veces que quieras. Las predicciones de los demás jugadores están ocultas hasta que se bloquea el partido para evitar copias.
            </p>
          </div>
        </motion.div>

        {/* Sistema de Puntos */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="relative overflow-hidden bg-white dark:bg-[#0f0f13] rounded-3xl p-6 md:p-8 shadow-2xl shadow-black/5 border border-slate-200 dark:border-white/5"
        >
          <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl pointer-events-none -translate-y-1/2 translate-x-1/3" />
          <div className="flex items-center gap-3 mb-6 relative z-10">
            <div className="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center">
              <Target size={24} className="text-blue-500" />
            </div>
            <h2 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">Sistema de Puntos</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 relative z-10">
            <div className="group relative bg-slate-50 dark:bg-white/[0.02] p-6 rounded-2xl border border-slate-100 dark:border-white/5 hover:border-blue-500/30 transition-colors">
              <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                <Target size={48} className="text-blue-500" />
              </div>
              <div className="text-3xl font-black text-accent mb-2 drop-shadow-sm">3 Pts</div>
              <h3 className="font-bold text-slate-800 dark:text-slate-200 text-base mb-2">Marcador Exacto</h3>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Aciertas tanto el ganador como la cantidad exacta de goles de cada equipo. (Ej. Predices 2-1 y termina 2-1).
              </p>
            </div>
            <div className="group relative bg-slate-50 dark:bg-white/[0.02] p-6 rounded-2xl border border-slate-100 dark:border-white/5 hover:border-blue-500/30 transition-colors">
              <div className="text-3xl font-black text-blue-500 mb-2 drop-shadow-sm">1 Pt</div>
              <h3 className="font-bold text-slate-800 dark:text-slate-200 text-base mb-2">Resultado Correcto</h3>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Aciertas quién gana o si es empate, pero no el marcador exacto. (Ej. Predices 2-0 y termina 3-1).
              </p>
            </div>
          </div>
        </motion.section>

        {/* Predicciones Globales */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.15 }}
          className="relative overflow-hidden bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/10 rounded-3xl p-6 md:p-8 shadow-2xl shadow-amber-500/5 border border-amber-200/50 dark:border-amber-500/20"
        >
          <div className="absolute top-0 right-0 w-64 h-64 bg-amber-500/10 rounded-full blur-3xl pointer-events-none -translate-y-1/2 translate-x-1/3" />
          <div className="flex items-center gap-3 mb-6 relative z-10">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-lg shadow-amber-500/20">
              <Trophy size={24} className="text-white" />
            </div>
            <div>
              <h2 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">Predicciones Globales</h2>
              <p className="text-sm font-medium text-amber-600 dark:text-amber-500">24 Puntos en juego</p>
            </div>
          </div>
          
          <div className="space-y-4 relative z-10">
            <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
              Antes de que inicie el primer partido del Mundial, puedes intentar adivinar quién será el <strong>Campeón del Mundo</strong> y el <strong>Goleador del Torneo</strong>. Estas predicciones se bloquean automáticamente apenas el balón ruede por primera vez en el partido inaugural.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-white/60 dark:bg-black/20 backdrop-blur-sm p-4 rounded-2xl border border-amber-200/50 dark:border-white/5">
                <div className="text-2xl font-black text-amber-500 mb-1">12 Pts</div>
                <h3 className="font-bold text-slate-800 dark:text-slate-200 text-sm mb-1">Acertar Campeón</h3>
                <p className="text-xs text-slate-600 dark:text-slate-400">Si tu equipo levanta la copa al final del torneo.</p>
              </div>
              <div className="bg-white/60 dark:bg-black/20 backdrop-blur-sm p-4 rounded-2xl border border-amber-200/50 dark:border-white/5">
                <div className="text-2xl font-black text-amber-500 mb-1">12 Pts</div>
                <h3 className="font-bold text-slate-800 dark:text-slate-200 text-sm mb-1">Acertar Goleador</h3>
                <p className="text-xs text-slate-600 dark:text-slate-400">Si el jugador que escribiste gana la bota de oro.</p>
              </div>
            </div>
          </div>
        </motion.section>

        {/* Comodín x2 */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="relative overflow-hidden bg-gradient-to-br from-indigo-50 to-purple-50 dark:from-slate-900 dark:to-slate-800 rounded-3xl p-6 md:p-8 shadow-2xl shadow-purple-500/10 border border-purple-200 dark:border-purple-500/20"
        >
          <div className="absolute top-0 left-0 w-full h-full bg-[url('/fifa26-bg.png')] bg-cover opacity-5 dark:opacity-10 pointer-events-none mix-blend-overlay" />
          <div className="absolute bottom-0 left-0 w-64 h-64 bg-accent/20 rounded-full blur-3xl pointer-events-none translate-y-1/2 -translate-x-1/4" />
          
          <div className="flex items-center gap-4 mb-6 relative z-10">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-accent to-purple-600 flex items-center justify-center shadow-lg shadow-accent/30">
              <Zap size={28} className="text-white fill-current" />
            </div>
            <div>
              <h2 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">Comodines (x2)</h2>
              <p className="text-sm font-medium text-accent">Duplica tus puntos</p>
            </div>
          </div>
          <p className="text-base text-slate-700 dark:text-slate-300 mb-6 leading-relaxed relative z-10">
            Aplica el comodín <strong>x2</strong> a tus partidos más seguros. 
            Si aciertas el marcador exacto con el comodín activo, ¡te llevas 6 puntos en lugar de 3! Úsalos con estrategia porque son limitados por fase.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 relative z-10">
            {[
              { label: 'Fase de Grupos', desc: 'Por jornada', num: '4' },
              { label: 'Ronda de 32', desc: 'Dieciseisavos', num: '3' },
              { label: 'Octavos', desc: 'Final', num: '2' },
              { label: 'Rondas Finales', desc: 'A partir de Cuartos', num: '1' }
            ].map((item, i) => (
              <div key={i} className="bg-white/60 dark:bg-black/30 backdrop-blur-sm rounded-2xl p-4 border border-purple-200/50 dark:border-white/10 text-center">
                <div className="text-2xl font-black text-slate-900 dark:text-white mb-1">{item.num}</div>
                <div className="text-xs font-bold text-accent uppercase tracking-wider mb-1">{item.label}</div>
                <div className="text-[10px] text-slate-500 dark:text-slate-400">{item.desc}</div>
              </div>
            ))}
          </div>
        </motion.section>

        {/* Fases Eliminatorias */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="relative overflow-hidden bg-white dark:bg-[#0f0f13] rounded-3xl p-6 md:p-8 shadow-2xl shadow-black/5 border border-slate-200 dark:border-white/5"
        >
          <div className="absolute top-0 left-1/2 w-64 h-64 bg-amber-500/10 rounded-full blur-3xl pointer-events-none -translate-y-1/2 -translate-x-1/2" />
          
          <div className="flex items-center gap-3 mb-6 relative z-10">
            <div className="w-12 h-12 rounded-xl bg-amber-500/10 flex items-center justify-center">
              <Trophy size={24} className="text-amber-500" />
            </div>
            <h2 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">Fases Eliminatorias</h2>
          </div>
          
          <div className="space-y-4 relative z-10">
            <div className="bg-slate-50 dark:bg-white/[0.02] p-5 rounded-2xl border border-slate-100 dark:border-white/5 flex gap-4 items-start">
              <div className="mt-1 w-8 h-8 rounded-full bg-slate-200 dark:bg-white/10 flex items-center justify-center shrink-0">
                <AlertTriangle size={16} className="text-slate-600 dark:text-slate-400" />
              </div>
              <div>
                <h3 className="font-bold text-base text-slate-800 dark:text-slate-200">Marcador en los 120 minutos</h3>
                <p className="text-sm text-slate-600 dark:text-slate-400 mt-2 leading-relaxed">
                  Tu predicción de goles (Ej. 1-1) cuenta para el resultado al final de los 90 minutos más la posible prórroga (120 min en total). Los goles marcados en la tanda de penales <strong>no</strong> se suman a este marcador.
                </p>
              </div>
            </div>
            <div className="bg-slate-50 dark:bg-white/[0.02] p-5 rounded-2xl border border-slate-100 dark:border-white/5 flex gap-4 items-start">
              <div className="mt-1 w-8 h-8 rounded-full bg-slate-200 dark:bg-white/10 flex items-center justify-center shrink-0">
                <Trophy size={16} className="text-slate-600 dark:text-slate-400" />
              </div>
              <div>
                <h3 className="font-bold text-base text-slate-800 dark:text-slate-200">Definición por Penales</h3>
                <p className="text-sm text-slate-600 dark:text-slate-400 mt-2 leading-relaxed">
                  Si predices un empate (Ej. 1-1), el sistema te pedirá quién avanza en la tanda de penales. Tu marcador del empate <strong>puntúa igual</strong> (3 si es exacto, 1 si solo acertaste el empate) aunque falles el penal. Y si <strong>aciertas quién pasa</strong>, sumas un <strong>bonus de +1</strong>. Además, si predijiste un <strong>ganador</strong> (Ej. 3-1) pero el partido se fue a penales, igual ganás <strong>1 punto</strong> si el equipo que elegiste es el que <strong>avanza</strong>.
                </p>
              </div>
            </div>
          </div>
        </motion.section>

        {/* Cierre */}
        <div className="text-center pb-8 pt-4">
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
            Sincronización en vivo con FIFA Data.
          </p>
        </div>
      </div>
    </div>
  )
}
