/* Banner de anuncio del admin (global_settings.announcement). Descartable por
   usuario; si el admin cambia el texto, vuelve a aparecer. */
import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Megaphone, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'

// hash simple para saber si es un anuncio "nuevo" respecto al ya descartado
function keyOf(text) {
  let h = 0
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0
  return `annc_dismissed_${h}`
}

export default function AnnouncementBanner() {
  const [text, setText] = useState('')
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    let alive = true
    const load = async () => {
      const { data } = await supabase
        .from('global_settings')
        .select('announcement, announcement_active')
        .eq('id', 1)
        .single()
      if (!alive || !data) return
      const t = (data.announcement || '').trim()
      if (data.announcement_active && t) {
        setText(t)
        setVisible(localStorage.getItem(keyOf(t)) !== '1')
      } else {
        setVisible(false)
      }
    }
    load()
    // Realtime: reaccionar a cambios del anuncio.
    const ch = supabase
      .channel('global_settings_annc')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'global_settings' }, load)
      .subscribe()
    return () => { alive = false; supabase.removeChannel(ch) }
  }, [])

  const dismiss = () => {
    if (text) localStorage.setItem(keyOf(text), '1')
    setVisible(false)
  }

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          className="w-full overflow-hidden"
        >
          <div className="flex items-start gap-2.5 px-4 py-2.5 bg-gradient-to-r from-accent/20 to-purple-500/10 border-b border-accent/20 text-slate-800 dark:text-slate-100">
            <Megaphone size={15} className="text-accent shrink-0 mt-0.5" />
            <p className="flex-1 text-xs font-medium leading-snug [overflow-wrap:anywhere]">{text}</p>
            <button onClick={dismiss} className="shrink-0 p-1 rounded-full text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 transition-colors">
              <X size={14} />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
