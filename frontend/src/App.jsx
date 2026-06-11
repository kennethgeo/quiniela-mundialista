import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from './contexts/ThemeContext'
import { SettingsProvider } from './contexts/SettingsContext'
import { AuthProvider } from './contexts/AuthContext'
import { useAuth } from './hooks/useAuth'
import Navbar from './components/ui/Navbar'
import BottomNav from './components/ui/BottomNav'
import ProtectedRoute from './components/auth/ProtectedRoute'
import InstallPrompt from './components/ui/InstallPrompt'
import LoadingSpinner from './components/ui/LoadingSpinner'

import { useState, lazy, Suspense } from 'react'

const AuthPage = lazy(() => import('./pages/AuthPage'))
const DashboardPage = lazy(() => import('./pages/DashboardPage'))
const MatchesPage = lazy(() => import('./pages/MatchesPage'))
const BracketPage = lazy(() => import('./pages/BracketPage'))
const LeaderboardPage = lazy(() => import('./pages/LeaderboardPage'))
const ProfilePage = lazy(() => import('./pages/ProfilePage'))
const AdminPage = lazy(() => import('./pages/AdminPage'))
const MatchDetailPage = lazy(() => import('./pages/MatchDetailPage'))
const RulesPage = lazy(() => import('./pages/RulesPage'))

import Sidebar from './components/ui/Sidebar'
import GlobalChatDrawer from './components/chat/GlobalChatDrawer'

// Layout principal que envuelve las rutas protegidas
function MainLayout({ children }) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)

  return (
    <div className="min-h-dvh flex bg-primary text-slate-900 dark:text-slate-200 bg-world-cup relative w-full">
      <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />
      
      {/* Móvil: app-shell de altura fija con scroll interno. Escritorio: scroll de documento */}
      <div className="flex-1 flex flex-col min-w-0 h-dvh overflow-hidden md:h-auto md:min-h-dvh md:overflow-visible transition-all duration-300 relative z-0">

        {/* Navbar solo en móvil — fuera del área de scroll para evitar glitches al scrollear */}
        <div className="md:hidden flex-none w-full z-40 bg-primary/90 backdrop-blur-md">
          <Navbar onMenuClick={() => setIsSidebarOpen(true)} />
        </div>

        <main className="flex-1 min-h-0 w-full overflow-y-auto overscroll-contain md:overflow-visible relative z-0">
          <div className="w-full px-4 sm:px-6 lg:px-8 md:py-8 pb-6">
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

function AppRoutes() {
  const { user, loading } = useAuth()
  useGlobalRealtime()

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

        {/* Rutas protegidas */}
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <MainLayout>
              <DashboardPage />
            </MainLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/matches"
        element={
          <ProtectedRoute>
            <MainLayout>
              <MatchesPage />
            </MainLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/bracket"
        element={
          <ProtectedRoute>
            <MainLayout>
              <BracketPage />
            </MainLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/leaderboard"
        element={
          <ProtectedRoute>
            <MainLayout>
              <LeaderboardPage />
            </MainLayout>
          </ProtectedRoute>
        }
      />
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
              <InstallPrompt />
              <AppRoutes />
            </AuthProvider>
          </SettingsProvider>
        </ThemeProvider>
      </Router>
    </QueryClientProvider>
  )
}
