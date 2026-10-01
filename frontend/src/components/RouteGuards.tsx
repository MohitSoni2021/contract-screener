import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import AuthPage from '../pages/AuthPage'
import RouteLoading from './RouteLoading'
import type { AuthSession, User } from '../types'

type GuestOnlyProps = {
  user: User | null
  restoring: boolean
  mode: 'login' | 'register'
  onAuthenticated: (session: AuthSession) => void
}

export function GuestOnly({ user, restoring, mode, onAuthenticated }: GuestOnlyProps) {
  if (restoring) return <RouteLoading />
  if (user) return <Navigate to="/workspace" replace />
  return <AuthPage mode={mode} onAuthenticated={onAuthenticated} />
}

type ProtectedRouteProps = {
  user: User | null
  restoring: boolean
  children: ReactNode
}

export function ProtectedRoute({ user, restoring, children }: ProtectedRouteProps) {
  if (restoring) return <RouteLoading />
  if (!user) return <Navigate to="/login" replace />
  return children
}
