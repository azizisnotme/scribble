import type { User } from '@supabase/supabase-js'
import { createContext, useContext } from 'react'

export interface AccountProfile {
  id: string
  email: string
  display_name: string | null
  avatar_url: string | null
  created_at: string
  last_sign_in_at: string | null
  status?: 'active' | 'suspended' | 'banned'
  status_reason?: string | null
  note?: string | null
}

export interface AppGate {
  maintenanceOn: boolean
  maintenanceMessage: string
  signupsOpen: boolean
}

export interface AuthContextValue {
  configured: boolean
  loading: boolean
  actionLoading: boolean
  waitingForBrowser: boolean
  user: User | null
  profile: AccountProfile | null
  isAdmin: boolean
  gate: AppGate
  error: string | null
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
  refreshAccount: () => Promise<void>
  clearError: () => void
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export interface AuthCallback {
  code: string | null
  flowId: string | null
  error: string | null
}

export function parseAuthCallback(rawUrl: string): AuthCallback | null {
  const callback = new URL(rawUrl)
  const isAppScheme = callback.protocol === 'scribble:' && callback.host === 'auth' && callback.pathname === '/callback'
  const isLoopback =
    (callback.protocol === 'http:' || callback.protocol === 'https:') &&
    (callback.hostname === '127.0.0.1' || callback.hostname === 'localhost') &&
    callback.pathname === '/auth/callback'
  if (!isAppScheme && !isLoopback) return null
  return {
    code: callback.searchParams.get('code'),
    flowId: callback.searchParams.get('sb_flow_id'),
    error: callback.searchParams.get('error_description') ?? callback.searchParams.get('error'),
  }
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider')
  return context
}

