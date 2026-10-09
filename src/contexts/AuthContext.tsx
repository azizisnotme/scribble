import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrent, onOpenUrl } from '@tauri-apps/plugin-deep-link'
import { open } from '@tauri-apps/plugin-shell'
import type { Session } from '@supabase/supabase-js'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import { AuthContext, parseAuthCallback, type AccountProfile, type AppGate, type AuthContextValue } from '@/contexts/auth'
import { registerDevice, checkAppLock } from '@/lib/ban'
import { LIVE_EVENT, subscribeLiveEvents } from '@/lib/live-events'
import { inTauri } from '@/lib/ipc'
import { isSupabaseConfigured, supabase } from '@/lib/supabase'

const OPEN_GATE: AppGate = { maintenanceOn: false, maintenanceMessage: '', signupsOpen: true }
const AUTH_DEEP_LINK = 'scribble://auth/callback'
const handledCodes = new Set<string>()
let signInStartedAt = 0

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<AccountProfile | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [gate, setGate] = useState<AppGate>(OPEN_GATE)
  const [loading, setLoading] = useState(isSupabaseConfigured)
  const [actionLoading, setActionLoading] = useState(false)
  const [waitingForBrowser, setWaitingForBrowser] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadAccount = useCallback(async (nextSession: Session | null) => {
    setSession(nextSession)
    if (!supabase || !nextSession?.user) {
      setProfile(null)
      setIsAdmin(false)
      setGate(OPEN_GATE)
      return
    }

    const client = supabase
    const profileQuery = client
      .from('profiles')
      .select('id,email,display_name,avatar_url,created_at,last_sign_in_at,status,status_reason,note')
      .eq('id', nextSession.user.id)
      .single()
    const [profileResult, adminResult] = await Promise.all([
      profileQuery.then(async (result) => {
        if (!result.error || !/status|note|column/i.test(result.error.message)) return result
        return client
          .from('profiles')
          .select('id,email,display_name,avatar_url,created_at,last_sign_in_at')
          .eq('id', nextSession.user.id)
          .single()
      }),
      client.rpc('is_admin'),
    ])

    if (profileResult.error) throw profileResult.error
    if (adminResult.error) throw adminResult.error
    const nextProfile = profileResult.data as AccountProfile
    const standingResult = await client.rpc('account_standing')
    const standing = (standingResult.data ?? {}) as {
      blocked?: boolean
      block_reason?: string | null
      signup_rejected?: boolean
      signups_open?: boolean
      maintenance_on?: boolean
      maintenance_message?: string
    }
    const nextGate: AppGate = {
      maintenanceOn: standing.maintenance_on === true,
      maintenanceMessage: standing.maintenance_message ?? '',
      signupsOpen: standing.signups_open !== false,
    }
    const admin = adminResult.data === true
    if (nextProfile.status === 'suspended' || nextProfile.status === 'banned' || standing.blocked || (standing.signup_rejected && !admin)) {
      if (nextProfile.status === 'suspended' || nextProfile.status === 'banned' || standing.blocked) {
        await registerDevice()
        await checkAppLock()
      }
      await supabase.auth.signOut()
      setSession(null)
      setProfile(null)
      setIsAdmin(false)
      setGate(nextGate)
      setError(
        nextProfile.status === 'banned'
          ? nextProfile.status_reason
            ? `This account is banned. ${nextProfile.status_reason}`
            : 'This account is banned.'
          : nextProfile.status === 'suspended'
          ? nextProfile.status_reason
            ? `This account is suspended. ${nextProfile.status_reason}`
            : 'This account is suspended.'
          : standing.blocked
            ? standing.block_reason
              ? `This account is blocked. ${standing.block_reason}`
              : 'This account is blocked.'
            : 'Scribble is not taking new accounts right now.',
      )
      return
    }
    setProfile(nextProfile)
    setIsAdmin(admin)
    setGate(nextGate)
    void registerDevice()
  }, [])

  const refreshAccount = useCallback(async () => {
    if (!supabase) return
    const { data, error: sessionError } = await supabase.auth.getSession()
    if (sessionError) throw sessionError
    await loadAccount(data.session)
  }, [loadAccount])

  const handleCallback = useCallback(
    async (rawUrl: string) => {
      if (!supabase) return
      const callback = parseAuthCallback(rawUrl)
      if (!callback) return

      if (callback.error) {
        setError(callback.error)
        return
      }

      const code = callback.code
      if (!code || handledCodes.has(code)) return
      if (signInStartedAt === 0) return
      handledCodes.add(code)
      setActionLoading(true)
      setError(null)

      try {
        const flowId = callback.flowId
        const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(
          code,
          flowId ? { flowId } : undefined,
        )
        if (exchangeError) throw exchangeError
        await loadAccount(data.session)
        setWaitingForBrowser(false)
      } catch (callbackError) {
        handledCodes.delete(code)
        const message = errorMessage(callbackError)
        setError(
          /pkce|code verifier/i.test(message)
            ? 'Sign-in expired. Close the Google tab and start Google sign-in from Scribble again.'
            : message,
        )
      } finally {
        setActionLoading(false)
      }
    },
    [loadAccount],
  )

  useEffect(() => {
    if (!supabase) return

    let alive = true
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!alive) return
      setSession(nextSession)
      if (!nextSession) {
        setProfile(null)
        setIsAdmin(false)
        setGate(OPEN_GATE)
      } else {
        queueMicrotask(() => {
          void loadAccount(nextSession).catch((accountError) => setError(errorMessage(accountError)))
        })
      }
    })

    void supabase.auth
      .getSession()
      .then(({ data, error: sessionError }) => {
        if (sessionError) throw sessionError
        return loadAccount(data.session)
      })
      .catch((sessionLoadError) => setError(errorMessage(sessionLoadError)))
      .finally(() => {
        if (alive) setLoading(false)
      })

    return () => {
      alive = false
      authListener.subscription.unsubscribe()
    }
  }, [loadAccount])

  useEffect(() => {
    const client = supabase
    if (!client || !session) return
    const timer = window.setInterval(() => {
      void client.auth.getUser().then(({ error: userError }) => {
        if (!userError) return
        void client.auth.signOut()
        setSession(null)
        setProfile(null)
        setIsAdmin(false)
        setError('You were signed out.')
      })
    }, 60000)
    return () => window.clearInterval(timer)
  }, [session])

  useEffect(() => subscribeLiveEvents(), [])

  useEffect(() => {
    const client = supabase
    if (!client) return
    const onLive = () => {
      void client.auth.getSession().then(({ data }) => {
        if (!data.session) return
        void registerDevice().finally(() => client.auth.getUser().then(({ error: userError }) => {
          if (userError && /session|jwt|not found|invalid/i.test(userError.message)) {
            void client.auth.signOut()
            setSession(null)
            setProfile(null)
            setIsAdmin(false)
            return
          }
          if (userError) return
          void refreshAccount().catch((accountError) => setError(errorMessage(accountError)))
        }))
      })
    }
    window.addEventListener(LIVE_EVENT, onLive)
    return () => window.removeEventListener(LIVE_EVENT, onLive)
  }, [refreshAccount])

  useEffect(() => {
    if (!supabase || !inTauri) return
    const stoppers: Array<() => void> = []

    void getCurrent().then((urls) => {
      if (urls?.[0]) void handleCallback(urls[0])
    })
    void onOpenUrl((urls) => {
      if (urls[0]) void handleCallback(urls[0])
    }).then((stopListening) => {
      stoppers.push(stopListening)
    })
    void listen<string>('auth://callback', (event) => {
      if (event.payload) void handleCallback(event.payload)
    }).then((stopListening) => {
      stoppers.push(stopListening)
    })

    return () => {
      for (const stop of stoppers) stop()
    }
  }, [handleCallback])

  const signInWithGoogle = useCallback(async () => {
    if (!supabase) {
      setError('Supabase is not configured yet.')
      return
    }
    if (!inTauri) {
      setError('Google sign-in must be started from the Scribble desktop app.')
      return
    }

    setActionLoading(true)
    setError(null)
    signInStartedAt = Date.now()
    try {
      const redirectTo = await invoke<string>('auth_callback_url').catch(() => AUTH_DEEP_LINK)
      const { data, error: signInError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo,
          skipBrowserRedirect: true,
          queryParams: { prompt: 'select_account' },
        },
      })
      if (signInError) throw signInError
      if (!data.url) throw new Error('Supabase did not return a Google sign-in URL.')
      await open(data.url)
      setWaitingForBrowser(true)
    } catch (signInError) {
      setWaitingForBrowser(false)
      setError(errorMessage(signInError))
    } finally {
      setActionLoading(false)
    }
  }, [])

  const signOut = useCallback(async () => {
    if (!supabase) return
    setActionLoading(true)
    setError(null)
    try {
      const { error: signOutError } = await supabase.auth.signOut()
      if (signOutError) throw signOutError
      setSession(null)
      setProfile(null)
      setIsAdmin(false)
      setWaitingForBrowser(false)
    } catch (signOutError) {
      setError(errorMessage(signOutError))
    } finally {
      setActionLoading(false)
    }
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      configured: isSupabaseConfigured,
      loading,
      actionLoading,
      waitingForBrowser,
      user: session?.user ?? null,
      profile,
      isAdmin,
      gate,
      error,
      signInWithGoogle,
      signOut,
      refreshAccount,
      clearError: () => setError(null),
    }),
    [actionLoading, error, gate, isAdmin, loading, profile, refreshAccount, session, signInWithGoogle, signOut, waitingForBrowser],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

