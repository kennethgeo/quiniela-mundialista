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

import AuthPage from './pages/AuthPage'
import DashboardPage from './pages/DashboardPage'
import MatchesPage from './pages/MatchesPage'
import BracketPage from './pages/BracketPage'
import LeaderboardPage from './pages/LeaderboardPage'
import ProfilePage from './pages/ProfilePage'
import AdminPage from './pages/AdminPage'
import MatchDetailPage from './pages/MatchDetailPage'
import RulesPage from './pages/RulesPage'

import Sidebar from './components/ui/Sidebar'
import GlobalChatDrawer from './components/chat/GlobalChatDrawer'

import { useState } from 'react'

// Layout principal que envuelve las rutas protegidas
function MainLayout({ children }) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)

  return (
    <div className="min-h-dvh flex bg-primary text-slate-900 dark:text-slate-200 bg-world-cup relative w-full overflow-hidden">
      <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />
      
      {/* Contenedor del contenido que toma el resto de la pantalla */}
      <div className="flex-1 flex flex-col min-w-0 min-h-dvh transition-all duration-300 relative z-0">
        
        {/* Navbar solo en móvil */}
        <div className="md:hidden flex-none w-full">
          <Navbar onMenuClick={() => setIsSidebarOpen(true)} />
        </div>
        
        <main className="flex-1 w-full overflow-y-auto pb-20 md:pb-6 relative z-0">
          <div className="w-full px-4 sm:px-6 lg:px-8 md:py-8 h-full">
            {children}
          </div>
        </main>

        <div className="md:hidden">
          <BottomNav />
        </div>
      </div>
      
      {/* Botón flotante y drawer del chat global */}
      <GlobalChatDrawer />
    </div>
  )
}

function AppRoutes() {
  const { user, loading } = useAuth()

  if (loading) {
    return <div className="min-h-dvh bg-primary flex items-center justify-center text-accent">⚽ Cargando...</div>
  }

  return (
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
