const variants = {
  primary: 'bg-accent text-[#06231d] hover:brightness-95',
  secondary: 'border border-slate-200 bg-white text-slate-800 hover:bg-slate-50 dark:border-[#303030] dark:bg-[#161616] dark:text-[#F3F1EA] dark:hover:bg-[#202020]',
  quiet: 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/5',
}

export default function Button({ variant = 'primary', className = '', children, type = 'button', ...props }) {
  return (
    <button type={type} className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant] || variants.primary} ${className}`} {...props}>
      {children}
    </button>
  )
}
