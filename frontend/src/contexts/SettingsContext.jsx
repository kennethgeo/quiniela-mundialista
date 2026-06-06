import React, { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const SettingsContext = createContext()

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(null)
  const [loadingSettings, setLoadingSettings] = useState(true)

  const fetchSettings = async () => {
    try {
      const { data, error } = await supabase
        .from('global_settings')
        .select('*')
        .eq('id', 1)
        .single()
      
      if (error) throw error
      setSettings(data)
    } catch (err) {
      console.error('Error fetching global settings:', err)
      // Provide fallback safe settings
      setSettings({
        prizes_text: 'El campeón se lleva la gloria.',
        powers_text: 'Los poderes te dan ventaja.',
        rules_text: '1. Diviértete.',
        whatsapp_link: '',
        prediction_deadline: null,
        show_champion_prediction: false
      })
    } finally {
      setLoadingSettings(false)
    }
  }

  useEffect(() => {
    fetchSettings()
    
    // Subscribe to changes in settings
    const subscription = supabase
      .channel('global_settings_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'global_settings' }, payload => {
        setSettings(payload.new)
      })
      .subscribe()

    return () => {
      supabase.removeChannel(subscription)
    }
  }, [])

  return (
    <SettingsContext.Provider value={{ settings, loadingSettings, refreshSettings: fetchSettings }}>
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettings() {
  return useContext(SettingsContext)
}
