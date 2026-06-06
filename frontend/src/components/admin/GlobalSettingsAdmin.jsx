import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { motion } from 'motion/react'
import { Save, Settings, MessageSquare, AlertCircle, Link as LinkIcon, Trophy, Clock } from 'lucide-react'
import { useSettings } from '../../contexts/SettingsContext'

export default function GlobalSettingsAdmin() {
  const { settings, refreshSettings } = useSettings()
  const [formState, setFormState] = useState({
    prizes_text: '',
    powers_text: '',
    rules_text: '',
    whatsapp_link: '',
    prediction_deadline: '',
    show_champion_prediction: false
  })
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null)

  useEffect(() => {
    if (settings) {
      // Format deadline for datetime-local input
      let deadline = ''
      if (settings.prediction_deadline) {
        const date = new Date(settings.prediction_deadline)
        const tzOffset = date.getTimezoneOffset() * 60000
        deadline = new Date(date.getTime() - tzOffset).toISOString().slice(0, 16)
      }

      setFormState({
        prizes_text: settings.prizes_text || '',
        powers_text: settings.powers_text || '',
        rules_text: settings.rules_text || '',
        whatsapp_link: settings.whatsapp_link || '',
        prediction_deadline: deadline,
        show_champion_prediction: settings.show_champion_prediction || false
      })
    }
  }, [settings])

  const handleSave = async (e) => {
    e.preventDefault()
    setSaving(true)
    setMessage(null)
    
    try {
      let utcDeadline = null
      if (formState.prediction_deadline) {
        const date = new Date(formState.prediction_deadline)
        utcDeadline = date.toISOString()
      }

      const updates = {
        prizes_text: formState.prizes_text,
        powers_text: formState.powers_text,
        rules_text: formState.rules_text,
        whatsapp_link: formState.whatsapp_link,
        prediction_deadline: utcDeadline,
        show_champion_prediction: formState.show_champion_prediction,
        updated_at: new Date().toISOString()
      }

      const { error } = await supabase
        .from('global_settings')
        .upsert({ id: 1, ...updates })

      if (error) throw error
      
      setMessage({ type: 'success', text: 'Configuraciones guardadas correctamente.' })
      refreshSettings()
    } catch (err) {
      console.error('Error saving settings:', err)
      setMessage({ type: 'error', text: 'Error al guardar: ' + err.message })
    } finally {
      setSaving(false)
      setTimeout(() => setMessage(null), 3000)
    }
  }

  return (
    <div className="relative z-10 glass-card p-5 max-w-3xl">
      <div className="flex items-center gap-2 mb-6 border-b border-white/10 pb-4">
        <Settings className="text-accent" size={20} />
        <h2 className="text-lg font-bold text-slate-900 dark:text-white">Ajustes Globales de la App</h2>
      </div>

      {message && (
        <motion.div 
          initial={{ opacity: 0, y: -10 }} 
          animate={{ opacity: 1, y: 0 }}
          className={`p-3 rounded-xl mb-6 text-sm font-semibold flex items-center gap-2 ${
            message.type === 'success' ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30' : 'bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-500/30'
          }`}
        >
          <AlertCircle size={16} />
          {message.text}
        </motion.div>
      )}

      <form onSubmit={handleSave} className="space-y-6">
        
        {/* Toggle Sections */}
        <div className="bg-white/5 dark:bg-black/20 p-4 rounded-2xl border border-white/10 space-y-4">
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-200 uppercase tracking-widest flex items-center gap-2">
            <Trophy size={14} className="text-amber-500" />
            Características Activas
          </h3>
          
          <label className="flex items-center justify-between cursor-pointer p-2 hover:bg-white/5 rounded-xl transition-colors">
            <div>
              <span className="block text-sm font-semibold text-slate-900 dark:text-white">Predicción de Campeón</span>
              <span className="text-xs text-slate-500">Muestra la opción para que los usuarios predigan al campeón del mundial.</span>
            </div>
            <div className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${formState.show_champion_prediction ? 'bg-accent' : 'bg-slate-700'}`}>
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${formState.show_champion_prediction ? 'translate-x-6' : 'translate-x-1'}`} />
            </div>
            {/* Hidden actual checkbox for accessibility */}
            <input 
              type="checkbox" 
              className="sr-only" 
              checked={formState.show_champion_prediction}
              onChange={(e) => setFormState({...formState, show_champion_prediction: e.target.checked})}
            />
          </label>
        </div>

        {/* Text Areas */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-slate-500 uppercase">Texto de Premios</label>
            <textarea 
              rows="3"
              value={formState.prizes_text}
              onChange={(e) => setFormState({...formState, prizes_text: e.target.value})}
              className="w-full bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-accent"
              placeholder="Detalla qué ganarán los primeros lugares..."
            />
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-semibold text-slate-500 uppercase">Texto de Reglas</label>
            <textarea 
              rows="3"
              value={formState.rules_text}
              onChange={(e) => setFormState({...formState, rules_text: e.target.value})}
              className="w-full bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-accent"
              placeholder="Explica cómo funcionan los puntos..."
            />
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-semibold text-slate-500 uppercase">Texto de Poderes (Prodefy)</label>
            <textarea 
              rows="3"
              value={formState.powers_text}
              onChange={(e) => setFormState({...formState, powers_text: e.target.value})}
              className="w-full bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-accent"
              placeholder="Explica qué son los poderes especiales..."
            />
          </div>
        </div>

        {/* Links and Limits */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 pt-4 border-t border-white/5">
          <div className="space-y-2">
            <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 uppercase">
              <MessageSquare size={12} /> Link Grupo WhatsApp
            </label>
            <input 
              type="url"
              value={formState.whatsapp_link}
              onChange={(e) => setFormState({...formState, whatsapp_link: e.target.value})}
              className="w-full bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-accent"
              placeholder="https://chat.whatsapp.com/..."
            />
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 uppercase">
              <Clock size={12} /> Cierre Límite (Predicciones Base)
            </label>
            <input 
              type="datetime-local"
              value={formState.prediction_deadline}
              onChange={(e) => setFormState({...formState, prediction_deadline: e.target.value})}
              className="w-full bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
        </div>

        <div className="pt-4 flex justify-end">
          <button 
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 bg-accent hover:bg-accent-light text-slate-950 font-bold px-6 py-3 rounded-xl transition-all shadow-lg shadow-accent/20 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Save size={18} />
            {saving ? 'Guardando...' : 'Guardar Configuraciones'}
          </button>
        </div>
      </form>
    </div>
  )
}
