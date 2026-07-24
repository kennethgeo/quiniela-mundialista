// Vitrina de medallas: grilla por familia, con niveles 🥉🥈🥇, progreso al
// próximo nivel y estados bloqueado/desbloqueado. Recibe `earned` = agregado
// por badge_key ({ [key]: { tier, count, leagues[] } }).
import { motion } from 'motion/react'
import { Lock } from 'lucide-react'
import { BADGES, BADGE_FAMILIES, FAMILY_ORDER, TIER_LABEL, TIER_COLOR, tierProgress } from '../../lib/badges'

export default function BadgeShowcase({ earned = {}, compact = false }) {
  const total = Object.keys(BADGES).length
  const got = Object.keys(earned).filter((k) => BADGES[k]).length

  return (
    <div>
      {!compact && (
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold font-['Unbounded'] text-slate-900 dark:text-[#F3F1EA] text-[15px]">Medallas</h3>
          <span className="font-['JetBrains_Mono'] font-bold text-[11px] text-[var(--text-muted,#8A8A8A)]">{got}/{total}</span>
        </div>
      )}

      <div className="space-y-4">
        {FAMILY_ORDER.map((fam) => {
          const keys = Object.keys(BADGES).filter((k) => BADGES[k].family === fam)
          if (!keys.length) return null
          return (
            <div key={fam}>
              <div className="font-['JetBrains_Mono'] font-bold text-[9px] uppercase tracking-[0.18em] text-[var(--text-muted,#8A8A8A)] mb-2 px-0.5">
                {BADGE_FAMILIES[fam]}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                {keys.map((key) => <BadgeTile key={key} badgeKey={key} data={earned[key]} />)}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function BadgeTile({ badgeKey, data }) {
  const b = BADGES[badgeKey]
  const unlocked = !!data
  const tier = data?.tier || 0
  const color = TIER_COLOR[tier] || '#8A8A8A'
  const prog = tierProgress(badgeKey, tier, data?.count)

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}
      className={`relative rounded-2xl border p-3 overflow-hidden ${
        unlocked
          ? 'bg-white dark:bg-[#161616] border-slate-200 dark:border-[#262626]'
          : 'bg-slate-50/60 dark:bg-white/[0.02] border-slate-200/60 dark:border-[#1c1c1c]'}`}
      style={unlocked ? { boxShadow: `inset 0 0 0 1px ${color}22` } : undefined}
    >
      {unlocked && tier > 0 && (
        <span className="absolute top-2 right-2 font-['JetBrains_Mono'] font-bold text-[8px] px-1.5 py-0.5 rounded-full"
          style={{ color, background: `${color}1f` }}>{TIER_LABEL[tier]}</span>
      )}
      <div className={`text-[26px] leading-none mb-1.5 ${unlocked ? '' : 'grayscale opacity-40'}`}>{b.emoji}</div>
      <div className={`font-['Archivo'] font-bold text-[12px] leading-tight ${unlocked ? 'text-slate-900 dark:text-[#F3F1EA]' : 'text-slate-400 dark:text-slate-600'}`}>
        {b.name}
      </div>
      <p className={`text-[10px] leading-snug mt-0.5 ${unlocked ? 'text-[var(--text-muted,#8A8A8A)]' : 'text-slate-400/70 dark:text-slate-600'}`}>{b.desc}</p>

      {unlocked ? (
        <div className="mt-1.5">
          {prog && prog.next != null ? (
            <>
              <div className="h-1 rounded-full bg-slate-200 dark:bg-[#262626] overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${Math.min(100, (prog.count / prog.next) * 100)}%`, background: color }} />
              </div>
              <div className="font-['JetBrains_Mono'] text-[8.5px] text-[var(--text-muted,#8A8A8A)] mt-1">{prog.count}/{prog.next} · próx. nivel</div>
            </>
          ) : (
            <div className="font-['JetBrains_Mono'] text-[8.5px] font-bold" style={{ color }}>
              {prog ? '¡Nivel máximo!' : (data?.count ? `×${data.count}` : 'Desbloqueada')}
            </div>
          )}
          {data?.leagues?.length > 1 && (
            <div className="text-[8.5px] text-slate-400 mt-0.5 truncate">en {data.leagues.length} quinielas</div>
          )}
        </div>
      ) : (
        <div className="mt-1.5 flex items-center gap-1 text-[9px] text-slate-400 dark:text-slate-600">
          <Lock size={9} /> Bloqueada
        </div>
      )}
    </motion.div>
  )
}

// Tira compacta de medallas ganadas (para la Tabla / Resumen): solo emojis con tier.
export function MedalStrip({ keys = [], max = 6 }) {
  if (!keys.length) return null
  const shown = keys.slice(0, max)
  return (
    <span className="inline-flex items-center gap-0.5">
      {shown.map(({ badge_key, tier }, i) => {
        const b = BADGES[badge_key]
        if (!b) return null
        return (
          <span key={i} className="text-[12px] leading-none" title={`${b.name}${tier > 1 ? ' · ' + TIER_LABEL[tier] : ''}`}
            style={tier === 3 ? { filter: 'drop-shadow(0 0 3px rgba(232,183,90,.6))' } : undefined}>
            {b.emoji}
          </span>
        )
      })}
      {keys.length > max && <span className="text-[9px] text-slate-400 ml-0.5">+{keys.length - max}</span>}
    </span>
  )
}
