import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
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
import LeaguesPage from './pages/LeaguesPage'

import Sidebar from './components/ui/Sidebar'

// Layout principal que envuelve las rutas protegidas
function MainLayout({ children }) {
  return (
    <div className="min-h-dvh flex bg-primary text-slate-200 bg-world-cup relative">
      <Navbar />
      <Sidebar />
      
      {/* Contenido principal con padding para el nav inferior en móviles y nav lateral en desktop */}
      <main className="flex-1 overflow-y-auto pb-20 md:pb-6 pt-0 md:pt-6 md:pl-64 relative z-0 min-h-dvh">
        <div className="max-w-3xl mx-auto w-full md:rounded-3xl md:glass md:min-h-[calc(100vh-3rem)] md:shadow-2xl overflow-hidden relative">
          {children}
        </div>
      </main>

      <BottomNav />
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
        path="/leagues"
        element={
          <ProtectedRoute>
            <MainLayout>
              <LeaguesPage />
            </MainLayout>
          </ProtectedRoute>
        }
      />

      {/* Redirección por defecto */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

function App() {
  return (
    <Router>
      <AuthProvider>
        <InstallPrompt />
        <AppRoutes />
      </AuthProvider>
    </Router>
  )
}

export default App
