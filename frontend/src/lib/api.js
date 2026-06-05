// Cliente API - agrega automáticamente el token de autenticación a las solicitudes
import { supabase } from './supabase'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

/**
 * Realiza una solicitud HTTP autenticada al backend.
 * Automáticamente adjunta el token JWT de Supabase.
 */
export async function apiFetch(endpoint, options = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token

  const config = {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      ...options.headers
    }
  }

  const response = await fetch(`${API_URL}${endpoint}`, config)

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Error desconocido' }))
    throw new Error(error.detail || `Error ${response.status}`)
  }

  return response.json()
}

/** Métodos abreviados para las operaciones CRUD */
export const api = {
  get: (endpoint) => apiFetch(endpoint),
  post: (endpoint, data) => apiFetch(endpoint, { method: 'POST', body: JSON.stringify(data) }),
  put: (endpoint, data) => apiFetch(endpoint, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (endpoint) => apiFetch(endpoint, { method: 'DELETE' })
}
