import { AlertCircle, Inbox } from 'lucide-react'

export function EmptyState({ title, description, icon: Icon = Inbox, compact = false }) {
  return (
    <div className={`rounded-2xl border border-dashed border-slate-200 dark:border-[#303030] text-center ${compact ? 'px-4 py-5' : 'px-6 py-9'}`}>
      <Icon size={compact ? 22 : 30} className="mx-auto text-accent mb-2" aria-hidden="true" />
      <p className="font-['Archivo'] font-bold text-sm text-slate-900 dark:text-[#F3F1EA]">{title}</p>
      {description && <p className="mt-1 text-xs leading-relaxed text-[var(--text-muted,#8A8A8A)]">{description}</p>}
    </div>
  )
}

export function ErrorState({ title = 'No pudimos cargar esto', description, onRetry, compact = false }) {
  return (
    <div role="alert" className={`rounded-2xl border border-[#FF7A59]/25 bg-[#FF7A59]/10 ${compact ? 'px-4 py-3' : 'px-5 py-5'}`}>
      <div className="flex items-start gap-3">
        <AlertCircle size={18} className="text-[#FF7A59] shrink-0 mt-0.5" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="font-['Archivo'] font-bold text-sm text-slate-900 dark:text-[#F3F1EA]">{title}</p>
          {description && <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400">{description}</p>}
        </div>
        {onRetry && (
          <button onClick={onRetry} className="shrink-0 text-xs font-bold text-[#FF7A59] hover:underline">
            Reintentar
          </button>
        )}
      </div>
    </div>
  )
}
