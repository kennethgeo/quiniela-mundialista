import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Send, MessageSquare } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'

export default function MatchChat({ matchId }) {
  const { profile } = useAuth()
  const [messages, setMessages] = useState([])
  const [newMessage, setNewMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const messagesEndRef = useRef(null)

  // Fetch initial messages
  useEffect(() => {
    const fetchMessages = async () => {
      try {
        const { data, error } = await supabase
          .from('match_comments')
          .select(`
            *,
            users!inner (
              display_name
            )
          `)
          .eq('match_id', matchId)
          .order('created_at', { ascending: true })

        if (error) throw error
        setMessages(data || [])
      } catch (err) {
        console.error('Error fetching comments:', err)
      } finally {
        setLoading(false)
      }
    }

    fetchMessages()
  }, [matchId])

  // Setup Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel(`match_chat_${matchId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'match_comments',
          filter: `match_id=eq.${matchId}`
        },
        async (payload) => {
          // Fetch the user data for the new message
          const { data: userData } = await supabase
            .from('users')
            .select('display_name')
            .eq('id', payload.new.user_id)
            .single()

          const newMessage = {
            ...payload.new,
            users: userData || { display_name: 'Usuario' }
          }
          
          setMessages((current) => [...current, newMessage])
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [matchId])

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = async (e) => {
    e.preventDefault()
    if (!newMessage.trim() || !profile) return

    const content = newMessage.trim()
    setNewMessage('') // clear immediately for UX

    try {
      const { error } = await supabase
        .from('match_comments')
        .insert({
          match_id: matchId,
          user_id: profile.id,
          content: content
        })

      if (error) {
        throw error
      }
      // Note: Realtime subscription will handle adding it to the UI
    } catch (err) {
      console.error('Error sending message:', err)
      // Opcional: restaurar mensaje si falla
    }
  }

  return (
    <div className="glass-card flex flex-col h-[400px] overflow-hidden border border-white/10">
      {/* Header */}
      <div className="bg-white/5 border-b border-white/5 p-3 flex items-center gap-2">
        <MessageSquare size={16} className="text-accent" />
        <h3 className="font-bold text-white text-sm">Banter Box</h3>
      </div>

      {/* Messages list */}
      <div className="flex-1 p-4 overflow-y-auto space-y-4 scrollbar-hide">
        {loading ? (
          <div className="flex justify-center items-center h-full text-slate-500">
            <div className="animate-spin text-xl">⚽</div>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-500 gap-2">
            <MessageSquare size={24} className="opacity-50" />
            <p className="text-xs">Sin comentarios aún. ¡Sé el primero!</p>
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
                  className={`px-3 py-2 rounded-2xl max-w-[85%] text-sm ${
                    isMe
                      ? 'bg-accent/20 text-white border border-accent/30 rounded-tr-sm'
                      : 'bg-white/5 text-slate-200 border border-white/10 rounded-tl-sm'
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
      <form onSubmit={handleSend} className="p-3 bg-black/20 border-t border-white/5">
        <div className="relative flex items-center">
          <input
            type="text"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            placeholder="Comenta sobre el partido..."
            maxLength={500}
            className="w-full bg-white/5 border border-white/10 rounded-full pl-4 pr-10 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-accent/50 focus:border-accent transition-all"
          />
          <button
            type="submit"
            disabled={!newMessage.trim()}
            className="absolute right-1 p-1.5 rounded-full text-white bg-accent hover:bg-accent-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Send size={14} />
          </button>
        </div>
      </form>
    </div>
  )
}
