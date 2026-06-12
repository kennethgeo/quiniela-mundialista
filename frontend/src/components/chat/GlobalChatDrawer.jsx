import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Send, MessageSquare, X, Users } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'

// Paleta de degradados para los avatares (asignado de forma determinista por nombre)
const AVATAR_GRADIENTS = [
  'from-violet-500 to-purple-600',
  'from-sky-500 to-blue-600',
  'from-emerald-500 to-teal-600',
  'from-amber-500 to-orange-600',
  'from-rose-500 to-pink-600',
  'from-cyan-500 to-sky-600',
  'from-fuchsia-500 to-purple-600',
  'from-lime-500 to-green-600',
]

function gradientFor(name = '') {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return AVATAR_GRADIENTS[h % AVATAR_GRADIENTS.length]
}

function initialOf(name = '?') {
  return (name.trim().charAt(0) || '?').toUpperCase()
}

function timeOf(iso) {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

export default function GlobalChatDrawer() {
  const { profile } = useAuth()
  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState([])
  const [newMessage, setNewMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [unreadCount, setUnreadCount] = useState(0)
  const messagesEndRef = useRef(null)

  // Fetch initial messages
  useEffect(() => {
    const fetchMessages = async () => {
      try {
        const { data, error } = await supabase
          .from('global_chat')
          .select(`
            *,
            users!inner (
              display_name
            )
          `)
          .order('created_at', { ascending: true })
          .limit(100)

        if (error) throw error
        setMessages(data || [])
      } catch (err) {
        console.error('Error fetching chat:', err)
      } finally {
        setLoading(false)
      }
    }

    fetchMessages()
  }, [])

  // Setup Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel('global_chat_channel')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'global_chat' },
        async (payload) => {
          const { data: userData } = await supabase
            .from('users')
            .select('display_name')
            .eq('id', payload.new.user_id)
            .single()

          const newMsg = {
            ...payload.new,
            users: userData || { display_name: 'Usuario' },
          }

          setMessages((current) => {
            if (current.some((m) => m.id === newMsg.id || (m.content === newMsg.content && m.user_id === newMsg.user_id))) {
              return current.map((m) => (m.content === newMsg.content && m.user_id === newMsg.user_id ? newMsg : m))
            }
            return [...current, newMsg]
          })

          if (!isOpen && newMsg.user_id !== profile?.id) {
            setUnreadCount((prev) => prev + 1)
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [isOpen, profile])

  // Auto-scroll to bottom when opened or new messages arrive
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
      setUnreadCount(0)
    }
  }, [messages, isOpen])

  const handleSend = async (e) => {
    e.preventDefault()
    if (!newMessage.trim() || !profile) return

    const content = newMessage.trim()
    setNewMessage('')

    try {
      const tempId = crypto.randomUUID()
      const optimisticMsg = {
        id: tempId,
        user_id: profile.id,
        content,
        created_at: new Date().toISOString(),
        users: { display_name: profile.display_name || 'Yo' },
      }
      setMessages((prev) => [...prev, optimisticMsg])

      const { error } = await supabase
        .from('global_chat')
        .insert({ user_id: profile.id, content })
        .select()

      if (error) throw error
    } catch (err) {
      console.error('Error sending message:', err)
      alert('Error al enviar mensaje: ' + err.message)
      setMessages((prev) => prev.filter((m) => m.content !== content))
    }
  }

  return (
    <>
      {/* ── Botón Flotante ── */}
      <AnimatePresence>
        {!isOpen && (
          <motion.button
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.9 }}
            onClick={() => setIsOpen(true)}
            className="fixed bottom-[85px] right-4 md:bottom-10 md:right-10 z-[60] w-14 h-14 rounded-full flex items-center justify-center shadow-2xl shadow-accent/40 bg-gradient-to-br from-accent to-accent-dark text-white"
          >
            <MessageSquare size={24} />
            {unreadCount > 0 && (
              <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="absolute -top-1 -right-1 bg-rose-500 text-white text-[10px] font-bold min-w-5 h-5 px-1 flex items-center justify-center rounded-full border-2 border-white dark:border-slate-900 shadow-md"
              >
                {unreadCount > 9 ? '9+' : unreadCount}
              </motion.span>
            )}
          </motion.button>
        )}
      </AnimatePresence>

      {/* ── Drawer ── */}
      <AnimatePresence>
        {isOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsOpen(false)}
              className="fixed inset-0 bg-slate-900/30 backdrop-blur-sm z-[55] sm:bg-slate-900/10 sm:backdrop-blur-none"
            />

            <motion.div
              initial={{ y: '100%', opacity: 0, scale: 0.97 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: '100%', opacity: 0, scale: 0.97 }}
              transition={{ type: 'spring', damping: 26, stiffness: 220, mass: 0.8 }}
              className="fixed inset-x-0 bottom-0 sm:inset-x-auto sm:bottom-6 sm:right-6 md:bottom-10 md:right-10 w-full sm:w-[380px] h-[78vh] sm:h-[600px] sm:max-h-[80vh] z-[60] flex flex-col bg-white dark:bg-slate-900 shadow-2xl rounded-t-3xl sm:rounded-3xl border border-slate-200/70 dark:border-white/10 overflow-hidden"
            >
              {/* ── Header con degradado ── */}
              <div className="relative shrink-0 bg-gradient-to-r from-accent to-accent-dark text-white px-4 py-4 flex items-center justify-between gap-2 overflow-hidden">
                <div className="absolute -right-6 -top-10 w-32 h-32 bg-white/10 rounded-full blur-2xl pointer-events-none" />
                <div className="flex items-center gap-3 relative z-10 min-w-0">
                  <div className="w-9 h-9 shrink-0 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center ring-1 ring-white/30">
                    <Users size={18} />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-bold text-base leading-snug truncate">Liga Global</h3>
                    <p className="text-[11px] text-white/80 font-medium flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-300 shadow-[0_0_6px_rgba(110,231,183,0.9)]" />
                      Chat en vivo
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setIsOpen(false)}
                  className="relative z-10 shrink-0 p-2 rounded-full bg-white/15 hover:bg-white/25 text-white transition-colors"
                >
                  <X size={16} />
                </button>
              </div>

              {/* ── Lista de mensajes ── */}
              <div className="flex-1 min-h-0 px-3 py-3 overflow-y-auto scrollbar-hide bg-slate-50 dark:bg-slate-950/40">
                {loading ? (
                  <div className="flex justify-center items-center h-full">
                    <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}>
                      <span className="text-2xl">⚽</span>
                    </motion.div>
                  </div>
                ) : messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-3 px-6 text-center">
                    <div className="w-16 h-16 rounded-2xl bg-accent/10 flex items-center justify-center">
                      <MessageSquare size={26} className="text-accent" />
                    </div>
                    <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">Aún no hay mensajes</p>
                    <p className="text-xs">Sé el primero en romper el hielo 👋</p>
                  </div>
                ) : (
                  messages.map((msg, idx) => {
                    const isMe = msg.user_id === profile?.id
                    const prev = messages[idx - 1]
                    const next = messages[idx + 1]
                    const firstOfGroup = !prev || prev.user_id !== msg.user_id
                    const lastOfGroup = !next || next.user_id !== msg.user_id
                    const name = msg.users?.display_name || 'Usuario'

                    return (
                      <motion.div
                        key={msg.id}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        className={`flex items-end gap-2 ${isMe ? 'flex-row-reverse' : ''} ${firstOfGroup ? 'mt-3' : 'mt-1'}`}
                      >
                        {/* Avatar (solo de los demás, alineado al último del grupo) */}
                        {!isMe && (
                          <div className="w-7 shrink-0">
                            {lastOfGroup && (
                              <div className={`w-7 h-7 rounded-full bg-gradient-to-br ${gradientFor(name)} flex items-center justify-center text-white text-[11px] font-bold shadow-sm`}>
                                {initialOf(name)}
                              </div>
                            )}
                          </div>
                        )}

                        <div className={`flex flex-col max-w-[85%] min-w-0 ${isMe ? 'items-end' : 'items-start'}`}>
                          {!isMe && firstOfGroup && (
                            <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1 ml-1">{name}</span>
                          )}
                          <div
                            className={`px-4 py-2.5 text-sm leading-relaxed shadow-sm whitespace-pre-wrap [overflow-wrap:anywhere] ${
                              isMe
                                ? `bg-gradient-to-br from-accent to-accent-dark text-white rounded-2xl ${lastOfGroup ? 'rounded-br-md' : 'rounded-br-2xl'}`
                                : `bg-white dark:bg-white/[0.07] text-slate-800 dark:text-slate-100 border border-slate-200/70 dark:border-white/5 rounded-2xl ${lastOfGroup ? 'rounded-bl-md' : 'rounded-bl-2xl'}`
                            }`}
                          >
                            {msg.content}
                            <span className={`block text-[10px] mt-1 leading-none ${isMe ? 'text-white/60 text-right' : 'text-slate-400 dark:text-slate-500'}`}>
                              {timeOf(msg.created_at)}
                            </span>
                          </div>
                        </div>
                      </motion.div>
                    )
                  })
                )}
                <div ref={messagesEndRef} className="h-1" />
              </div>

              {/* ── Input ── */}
              <form onSubmit={handleSend} className="shrink-0 p-3 bg-white dark:bg-slate-900 border-t border-slate-200/70 dark:border-white/10">
                <div className="relative flex items-center">
                  <input
                    type="text"
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    placeholder="Escribe un mensaje..."
                    maxLength={500}
                    className="w-full bg-slate-100 dark:bg-white/[0.06] border border-transparent rounded-full pl-4 pr-12 py-3 text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:bg-white dark:focus:bg-slate-800 focus:border-accent/40 focus:ring-2 focus:ring-accent/20 transition-all"
                  />
                  <motion.button
                    type="submit"
                    disabled={!newMessage.trim()}
                    whileTap={{ scale: 0.88 }}
                    className={`absolute right-1.5 w-9 h-9 flex items-center justify-center rounded-full text-white transition-all ${
                      newMessage.trim()
                        ? 'bg-gradient-to-br from-accent to-accent-dark shadow-md shadow-accent/30'
                        : 'bg-slate-300 dark:bg-slate-700 cursor-not-allowed'
                    }`}
                  >
                    <Send size={16} className="ml-0.5" />
                  </motion.button>
                </div>
              </form>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  )
}
