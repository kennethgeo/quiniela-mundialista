import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Send, MessageSquare, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'

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
          .limit(100) // limit to recent messages

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
        {
          event: 'INSERT',
          schema: 'public',
          table: 'global_chat',
        },
        async (payload) => {
          // Fetch the user data for the new message
          const { data: userData } = await supabase
            .from('users')
            .select('display_name')
            .eq('id', payload.new.user_id)
            .single()

          const newMsg = {
            ...payload.new,
            users: userData || { display_name: 'Usuario' }
          }
          
          setMessages((current) => {
            // Prevent duplicates from optimistic update
            if (current.some(m => m.id === newMsg.id || (m.content === newMsg.content && m.user_id === newMsg.user_id))) {
              return current.map(m => (m.content === newMsg.content && m.user_id === newMsg.user_id) ? newMsg : m)
            }
            return [...current, newMsg]
          })
          
          // Increment unread if closed
          if (!isOpen && newMsg.user_id !== profile?.id) {
            setUnreadCount(prev => prev + 1)
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
      setUnreadCount(0) // clear unread when opened
    }
  }, [messages, isOpen])

  const handleSend = async (e) => {
    e.preventDefault()
    if (!newMessage.trim() || !profile) return

    const content = newMessage.trim()
    setNewMessage('') // clear immediately for UX

    try {
      // Optimistic update
      const tempId = crypto.randomUUID()
      const optimisticMsg = {
        id: tempId,
        user_id: profile.id,
        content: content,
        created_at: new Date().toISOString(),
        users: { display_name: profile.display_name || 'Yo' }
      }
      setMessages(prev => [...prev, optimisticMsg])

      const { data, error } = await supabase
        .from('global_chat')
        .insert({
          user_id: profile.id,
          content: content
        })
        .select()

      if (error) {
        throw error
      }
      
      // Update temp message with real DB data if needed, or rely on realtime to replace it
      // Actually, since realtime might fire, we might get duplicates if we don't handle it.
      // To keep it simple, we just alert if there's an error.
    } catch (err) {
      console.error('Error sending message:', err)
      alert('Error al enviar mensaje: ' + err.message)
      // Remove optimistic message
      setMessages(prev => prev.filter(m => m.content !== content))
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
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={() => setIsOpen(true)}
            className="fixed bottom-[85px] right-4 md:bottom-10 md:right-10 z-[60] w-14 h-14 rounded-full flex items-center justify-center shadow-2xl shadow-accent/40 bg-gradient-to-br from-accent to-accent-dark text-white backdrop-blur-md"
          >
            <MessageSquare size={24} />
            {unreadCount > 0 && (
              <motion.span 
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="absolute -top-1 -right-1 bg-rose-500 text-white text-[10px] font-bold w-5 h-5 flex items-center justify-center rounded-full border-2 border-slate-900 shadow-md"
              >
                {unreadCount}
              </motion.span>
            )}
          </motion.button>
        )}
      </AnimatePresence>

      {/* ── Drawer (Panel Desplegable) ── */}
      <AnimatePresence>
        {isOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsOpen(false)}
              className="fixed inset-0 bg-slate-900/20 backdrop-blur-sm z-[55] sm:bg-transparent sm:backdrop-blur-none"
            />

            <motion.div
              initial={{ y: '100%', opacity: 0, scale: 0.95 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: '100%', opacity: 0, scale: 0.95 }}
              transition={{ type: 'spring', damping: 25, stiffness: 200, mass: 0.8 }}
              className="fixed bottom-[70px] sm:bottom-6 sm:right-6 md:bottom-10 md:right-10 w-full sm:w-[350px] md:w-[380px] h-[550px] max-h-[80vh] z-[60] flex flex-col bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl shadow-2xl sm:rounded-3xl border sm:border-slate-200/50 dark:border-white/10 overflow-hidden"
            >
              {/* Header */}
              <div className="bg-white/50 dark:bg-slate-800/50 backdrop-blur-md border-b border-slate-200/50 dark:border-white/10 p-4 flex items-center justify-between sticky top-0 z-10">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center">
                    <MessageSquare size={16} className="text-accent" />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-900 dark:text-white text-sm leading-tight">Liga Global</h3>
                    <p className="text-[10px] text-slate-500 font-medium">Chat en vivo</p>
                  </div>
                </div>
                <button 
                  onClick={() => setIsOpen(false)}
                  className="p-2 rounded-full bg-slate-100/50 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white transition-colors"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Messages list */}
              <div className="flex-1 p-4 overflow-y-auto space-y-4 scrollbar-hide">
                {loading ? (
                  <div className="flex justify-center items-center h-full">
                    <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}>
                      <span className="text-2xl">⚽</span>
                    </motion.div>
                  </div>
                ) : messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-slate-500 gap-3">
                    <div className="w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                      <MessageSquare size={24} className="opacity-50" />
                    </div>
                    <p className="text-xs font-medium">Sé el primero en comentar</p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    {messages.map((msg, idx) => {
                      const isMe = msg.user_id === profile?.id
                      const isLastFromUser = idx === messages.length - 1 || messages[idx + 1]?.user_id !== msg.user_id

                      return (
                        <motion.div
                          key={msg.id}
                          initial={{ opacity: 0, scale: 0.9, y: 10, originX: isMe ? 1 : 0 }}
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
                        >
                          {!isMe && (
                            <span className="text-[10px] text-slate-500 font-bold mb-1 ml-1">
                              {msg.users?.display_name}
                            </span>
                          )}
                          <div
                            className={`px-4 py-2.5 max-w-[85%] text-sm shadow-sm ${
                              isMe
                                ? `bg-gradient-to-br from-accent to-accent-dark text-white rounded-2xl ${isLastFromUser ? 'rounded-br-sm' : ''}`
                                : `bg-slate-100 dark:bg-slate-800/80 text-slate-800 dark:text-slate-200 border border-slate-200/50 dark:border-white/5 rounded-2xl ${isLastFromUser ? 'rounded-bl-sm' : ''}`
                            }`}
                          >
                            <p className="leading-relaxed">{msg.content}</p>
                          </div>
                        </motion.div>
                      )
                    })}
                  </div>
                )}
                <div ref={messagesEndRef} className="h-2" />
              </div>

              {/* Input area */}
              <form onSubmit={handleSend} className="p-3 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-t border-slate-200/50 dark:border-white/10 relative z-10">
                <div className="relative flex items-center group">
                  <input
                    type="text"
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    placeholder="Escribe un mensaje..."
                    maxLength={500}
                    className="w-full bg-slate-100/80 dark:bg-slate-800/50 border border-transparent rounded-full pl-4 pr-12 py-3 text-sm text-slate-900 dark:text-white placeholder-slate-500 focus:outline-none focus:bg-white dark:focus:bg-slate-800 focus:border-accent/30 focus:ring-2 focus:ring-accent/20 transition-all shadow-inner"
                  />
                  <AnimatePresence>
                    {newMessage.trim() && (
                      <motion.button
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.8 }}
                        type="submit"
                        className="absolute right-1.5 p-2 rounded-full text-white bg-accent hover:bg-accent-dark shadow-md transition-colors"
                      >
                        <Send size={16} className="ml-0.5" />
                      </motion.button>
                    )}
                  </AnimatePresence>
                </div>
              </form>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  )
}
