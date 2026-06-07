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
      <button
        onClick={() => setIsOpen(true)}
        className={`fixed bottom-6 right-6 md:bottom-10 md:right-10 z-40 w-14 h-14 rounded-full flex items-center justify-center shadow-[0_0_20px_rgba(168,85,247,0.4)] hover:scale-105 transition-transform ${
          isOpen ? 'hidden' : 'flex'
        } bg-gradient-to-br from-accent to-accent-dark text-white`}
      >
        <MessageSquare size={24} />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-rose-500 text-white text-[10px] font-bold w-5 h-5 flex items-center justify-center rounded-full border-2 border-slate-900">
            {unreadCount}
          </span>
        )}
      </button>

      {/* ── Drawer (Panel Desplegable) ── */}
      <AnimatePresence>
        {isOpen && (
          <>
            {/* Backdrop for mobile (optional, mostly to click outside) */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsOpen(false)}
              className="fixed inset-0 bg-black/20 z-40 sm:bg-transparent"
            />

            <motion.div
              initial={{ y: '100%', opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: '100%', opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed bottom-0 sm:bottom-6 sm:right-6 md:bottom-10 md:right-10 w-full sm:w-80 md:w-[350px] h-[500px] max-h-[80vh] z-50 flex flex-col glass-strong shadow-2xl sm:rounded-2xl border-t sm:border border-white/10 overflow-hidden"
            >
              {/* Header */}
              <div className="bg-white/5 border-b border-white/10 p-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MessageSquare size={16} className="text-accent" />
                  <h3 className="font-bold text-slate-900 dark:text-white text-sm">Chat de la Liga</h3>
                </div>
                <button 
                  onClick={() => setIsOpen(false)}
                  className="p-1 rounded-full hover:bg-white/10 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white transition-colors"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Messages list */}
              <div className="flex-1 p-4 overflow-y-auto space-y-4 scrollbar-hide bg-slate-50 dark:bg-black/20">
                {loading ? (
                  <div className="flex justify-center items-center h-full text-slate-500">
                    <div className="animate-spin text-xl">⚽</div>
                  </div>
                ) : messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-slate-500 gap-2">
                    <MessageSquare size={24} className="opacity-50" />
                    <p className="text-xs">Sin comentarios aún. ¡Inicia el chat!</p>
                  </div>
                ) : (
                  messages.map((msg, idx) => {
                    const isMe = msg.user_id === profile?.id
                    return (
                      <motion.div
                        key={msg.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
                      >
                        {!isMe && (
                          <span className="text-[10px] text-slate-500 font-bold mb-0.5 px-1">
                            {msg.users?.display_name}
                          </span>
                        )}
                        <div
                          className={`px-3 py-2 rounded-2xl max-w-[85%] text-sm shadow-sm ${
                            isMe
                              ? 'bg-accent text-white rounded-tr-sm'
                              : 'bg-white dark:bg-white/10 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-white/5 rounded-tl-sm'
                          }`}
                        >
                          {msg.content}
                        </div>
                      </motion.div>
                    )
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Input area */}
              <form onSubmit={handleSend} className="p-3 bg-white/50 dark:bg-black/40 border-t border-slate-200 dark:border-white/10 backdrop-blur-md">
                <div className="relative flex items-center">
                  <input
                    type="text"
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    placeholder="Escribe un mensaje..."
                    maxLength={500}
                    className="w-full bg-white dark:bg-white/5 border border-slate-300 dark:border-white/10 rounded-full pl-4 pr-10 py-2.5 text-sm text-slate-900 dark:text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-accent/50 focus:border-accent transition-all shadow-inner"
                  />
                  <button
                    type="submit"
                    disabled={!newMessage.trim()}
                    className="absolute right-1.5 p-1.5 rounded-full text-white bg-accent hover:bg-accent-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <Send size={14} />
                  </button>
                </div>
              </form>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  )
}
