import { useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { GuestOnly, ProtectedRoute } from './components/RouteGuards'
import WorkspacePage from './pages/WorkspacePage'
import ChatPage from './pages/ChatPage'
import CompareDocPage from './pages/CompareDocPage'
import type { AuthSession, User } from './types'

const TOKEN_KEY = 'elcara_access_token'

function App() {
  const [user, setUser] = useState<User | null>(null)
  const [token, setToken] = useState('')
  const [restoring, setRestoring] = useState(true)

  useEffect(() => {
    const savedToken = localStorage.getItem(TOKEN_KEY)
    if (!savedToken) {
      setRestoring(false)
      return
    }

    let active = true
    fetch('/api/auth/me', { headers: { Authorization: `Bearer ${savedToken}` } })
      .then(async (response) => {
        if (!response.ok) throw new Error('Session expired')
        return response.json() as Promise<User>
      })
      .then((currentUser) => {
        if (!active) return
        setToken(savedToken)
        setUser(currentUser)
      })
      .catch(() => {
        if (!active) return
        localStorage.removeItem(TOKEN_KEY)
      })
      .finally(() => {
        if (active) setRestoring(false)
      })

    return () => { active = false }
  }, [])

  function acceptSession(session: AuthSession) {
    localStorage.setItem(TOKEN_KEY, session.access_token)
    setToken(session.access_token)
    setUser(session.user)
  }

  function logout() {
    const activeToken = token
    localStorage.removeItem(TOKEN_KEY)
    setToken('')
    setUser(null)
    if (activeToken) {
      void fetch('/api/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${activeToken}` },
      }).catch(() => undefined)
    }
  }

  return (
    <Routes>
      <Route path="/" element={<Navigate to={user ? '/workspace' : '/login'} replace />} />
      <Route path="/login" element={<GuestOnly user={user} restoring={restoring} mode="login" onAuthenticated={acceptSession} />} />
      <Route path="/register" element={<GuestOnly user={user} restoring={restoring} mode="register" onAuthenticated={acceptSession} />} />
      <Route
        path="/workspace"
        element={(
          <ProtectedRoute user={user} restoring={restoring}>
            {user && <WorkspacePage user={user} token={token} onLogout={logout} />}
          </ProtectedRoute>
        )}
      />
      <Route
        path="/chat/:id"
        element={(
          <ProtectedRoute user={user} restoring={restoring}>
            {user && <ChatPage user={user} token={token} onLogout={logout} />}
          </ProtectedRoute>
        )}
      />
      <Route
        path="/compare-doc"
        element={(
          <ProtectedRoute user={user} restoring={restoring}>
            {user && <CompareDocPage user={user} token={token} onLogout={logout} />}
          </ProtectedRoute>
        )}
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
