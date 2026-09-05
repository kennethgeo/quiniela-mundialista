import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { supabase } from './lib/supabase'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from './contexts/ThemeContext'
import { SettingsProvider } from './contexts/SettingsContext'
import { AuthProvider } from './contexts/AuthContext'
import { ToastProvider } from './components/ui/Toast'
import { useAuth } from './hooks/useAuth'
import BottomNav from './components/ui/BottomNav'
import QuickBar from './components/ui/QuickBar'
import ProtectedRoute from './components/auth/ProtectedRoute'
import InstallPrompt from './components/ui/InstallPrompt'
import CambioDeCuenta from './hooks/useCambioDeCuenta'
import LoadingSpinner from './components/ui/LoadingSpinner'

import { useState, useEffect, lazy, Suspense } from 'react'

const AuthPage = lazy(() => import('./pages/AuthPage'))
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage'))
const ProfilePage = lazy(() => import('./pages/ProfilePage'))
const AdminPage = lazy(() => import('./pages/AdminPage'))
const MatchDetailPage = lazy(() => import('./pages/MatchDetailPage'))
const RulesPage = lazy(() => import('./pages/RulesPage'))
const TicoGamesV2Preview = lazy(() => import('./pages/TicoGamesV2Preview'))
const HubPage = lazy(() => import('./pages/HubPage'))
const GroupPage = lazy(() => import('./pages/GroupPage'))

import Sidebar from './components/ui/Sidebar'
import GlobalChatDrawer from './components/chat/GlobalChatDrawer'
import AnnouncementBanner from './components/ui/AnnouncementBanner'
import { useLiveSync } from './hooks/useLiveSync'

// Layout principal que envuelve las rutas protegidas
function MainLayout({ children }) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  useLiveSync()

  return (
    <div className="min-h-dvh flex bg-primary text-slate-900 dark:text-slate-200 bg-world-cup relative w-full">
      <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />
      
      {/* Móvil: app-shell de altura fija con scroll interno. Escritorio: scroll de documento */}
      <div className="flex-1 flex flex-col min-w-0 h-dvh overflow-hidden md:h-auto md:min-h-dvh md:overflow-visible transition-all duration-300 relative z-0">

        <main className="flex-1 min-h-0 min-w-0 w-full overflow-x-hidden overflow-y-auto overscroll-contain md:overflow-visible relative z-0">
          <QuickBar />
          <AnnouncementBanner />
          <div className="w-full min-w-0 max-w-full px-4 sm:px-6 lg:px-8 pt-2 md:pt-8 md:py-8 pb-6">
            {children}
          </div>
        </main>

        <div className="md:hidden flex-none">
          <BottomNav />
        </div>
      </div>
      
      {/* Botón flotante y drawer del chat global */}
      <GlobalChatDrawer />
    </div>
  )
}

import ErrorBoundary from './components/ui/ErrorBoundary'

import { useGlobalRealtime } from './hooks/useRealtime'
import UnirsePage from './pages/UnirsePage'

function AppRoutes() {
  const { loading } = useAuth()
  const navigate = useNavigate()
  useGlobalRealtime()

  // Red de seguridad: si el enlace de recuperación de contraseña cae en cualquier
  // pantalla (p. ej. el inicio, por el Site URL de Supabase), llevamos al usuario
  // a /reset-password en cuanto Supabase emite el evento PASSWORD_RECOVERY.
  useEffect(() => {
    const hash = window.location.hash || ''
    if (hash.includes('type=recovery') && !window.location.pathname.startsWith('/reset-password')) {
      navigate('/reset-password' + hash, { replace: true })
    }
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' && !window.location.pathname.startsWith('/reset-password')) {
        navigate('/reset-password', { replace: true })
      }
    })
    return () => subscription?.unsubscribe?.()
  }, [navigate])

  if (loading) {
    return <div className="min-h-dvh bg-primary flex items-center justify-center text-accent">⚽ Cargando...</div>
  }

  return (
    <ErrorBoundary>
      <Suspense fallback={
        <div className="min-h-dvh bg-primary flex items-center justify-center">
          <LoadingSpinner />
        </div>
      }>
        <Routes>
        {/* Rutas públicas */}
        <Route path="/auth" element={<AuthPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        {/* Pública a propósito: tiene que poder guardar el código antes de
            mandar a /auth a quien todavía no tiene cuenta. */}
        <Route path="/unirse/:codigo" element={<UnirsePage />} />

        {/* Rutas protegidas */}
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <MainLayout>
              <HubPage />
            </MainLayout>
          </ProtectedRoute>
        }
      />
      <Route path="/dashboard" element={<Navigate to="/" replace />} />
      <Route
        path="/q/:id"
        element={
          <ProtectedRoute>
            <MainLayout>
              <GroupPage />
            </MainLayout>
          </ProtectedRoute>
        }
      />
      {/* Rutas del flujo viejo (no están en la nav): predecir/ver ahora es por
          quiniela en /q/:id. Se redirigen al Hub para no usar el guardado antiguo. */}
      <Route path="/matches" element={<Navigate to="/" replace />} />
      <Route path="/bracket" element={<Navigate to="/" replace />} />
      <Route path="/leaderboard" element={<Navigate to="/" replace />} />
      <Route path="/torneo" element={<Navigate to="/" replace />} />
      <Route
        path="/profile"
        element={
          <ProtectedRoute>
            <MainLayout>
              <ProfilePage />
            </MainLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/match/:id"
        element={
          <ProtectedRoute>
            <MainLayout>
              <MatchDetailPage />
            </MainLayout>
          </ProtectedRoute>
        }
      />

      <Route
        path="/admin"
        element={
          <ProtectedRoute>
            <MainLayout>
              <AdminPage />
            </MainLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/rules"
        element={
          <ProtectedRoute>
            <MainLayout>
              <RulesPage />
            </MainLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/hub"
        element={
          <ProtectedRoute>
            <MainLayout>
              <HubPage />
            </MainLayout>
          </ProtectedRoute>
        }
      />
      {/* Preview del rediseño 2.0 — solo admin (guard interno) */}
      <Route
        path="/v2"
        element={
          <ProtectedRoute>
            <MainLayout>
              <TicoGamesV2Preview />
            </MainLayout>
          </ProtectedRoute>
        }
      />

      {/* Redirección por defecto */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
    </ErrorBoundary>
  )
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutos de caché
      refetchOnWindowFocus: false,
    },
  },
})

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Router>
        <ThemeProvider>
          <SettingsProvider>
            <AuthProvider>
              <ToastProvider>
                {/* Vacía la caché al cambiar de cuenta. Va DENTRO de
                    AuthProvider y del QueryClientProvider: necesita los dos. */}
                <CambioDeCuenta />
                <InstallPrompt />
                <AppRoutes />
              </ToastProvider>
            </AuthProvider>
          </SettingsProvider>
        </ThemeProvider>
      </Router>
    </QueryClientProvider>
  )
}
