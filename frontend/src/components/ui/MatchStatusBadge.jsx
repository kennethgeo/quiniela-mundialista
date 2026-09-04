import { matchStatus } from '../../lib/matchStatus'

const STYLE = {
  success: 'text-[#168b76] dark:text-[#2ED3B7] bg-[#2ED3B7]/12',
  warning: 'text-[#a87518] dark:text-[#E8B75A] bg-[#E8B75A]/14',
  live: 'text-[#d92f51] dark:text-[#FF4D6D] bg-[#FF4D6D]/14',
  muted: 'text-slate-500 dark:text-slate-400 bg-slate-500/10',
}

export default function MatchStatusBadge({ match, now, className = '' }) {
  const state = matchStatus(match, now)
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 font-['JetBrains_Mono'] text-[8.5px] font-bold uppercase tracking-[0.06em] ${STYLE[state.tone]} ${className}`}>
      {state.tone === 'live' && <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" aria-hidden="true" />}
      {state.label}
    </span>
  )
}
