import { lazy, Suspense, useEffect, useState } from 'react'

import { scheduleStartupUpdateProbe, UPDATE_EVENT } from '@/lib/auto-update'
import { inTauri } from '@/lib/ipc'
import { Sidebar, type NavId, NAV } from '@/components/Sidebar'
import { Header } from '@/components/Header'
import { StatusBar } from '@/components/StatusBar'
import { Dashboard } from '@/views/Dashboard'
import { Settings } from '@/views/Settings'
import { Live } from '@/views/Live'
import { Account } from '@/views/Account'
import { Scribbles } from '@/views/Scribbles'
import { Templates } from '@/views/Templates'
import { TypingHost } from '@/components/TypingHost'
import { DesktopPresence } from '@/components/DesktopPresence'
import { NoticeBanner } from '@/components/NoticeBanner'
import { Onboarding } from '@/components/Onboarding'
import { pushTextToLiveBuffer } from '@/lib/live-buffer-bridge'
import { useAuth } from '@/contexts/auth'
import { cachedBan, checkAppLock, registerDevice, type AppLock } from '@/lib/ban'
import { stopTypingSession } from '@/lib/typing-session'
import { startAppPolicy, useAppPolicy, versionIsOlder } from '@/lib/app-policy'
import { LIVE_EVENT } from '@/lib/live-events'
import { invoke } from '@tauri-apps/api/core'
import { hasCompletedOnboarding, ONBOARDING_RESET_EVENT } from '@/lib/onboarding'

const Analytics = lazy(() => import('@/views/Analytics').then((mod) => ({ default: mod.Analytics })))
const OcrScanner = lazy(() => import('@/views/OcrScanner').then((mod) => ({ default: mod.OcrScanner })))
const ScribbleAI = lazy(() => import('@/views/ScribbleAI').then((mod) => ({ default: mod.ScribbleAI })))
const Admin = lazy(() => import('@/views/Admin').then((mod) => ({ default: mod.Admin })))

const LAST_VIEW_KEY = 'scribble_last_view_v1'

function loadLastView(): NavId {
  try {
    const saved = localStorage.getItem(LAST_VIEW_KEY) as NavId | null
    return saved && NAV.some((item) => item.id === saved) && saved !== 'admin' ? saved : 'dashboard'
  } catch {
    return 'dashboard'
  }
}

function titleForView(view: NavId): string {
  if (view === 'settings') return 'Settings'
  if (view === 'ocr') return 'Extract Text from Picture'
  return NAV.find((n) => n.id === view)?.label ?? 'Dashboard'
}

function App() {
  const [view, setView] = useState<NavId>(loadLastView)
  const [showOnboarding, setShowOnboarding] = useState(() => !hasCompletedOnboarding())
  const [statusMsg, setStatusMsg] = useState('Ready')
  const [statusProg, setStatusProg] = useState(0)
  const { isAdmin, gate, signOut, user, loading: authLoading, signInWithGoogle, actionLoading, error: authError } = useAuth()
  const [appLock, setAppLock] = useState<AppLock>(() => cachedBan() ?? { banned: false, reason: '' })
  const [lockChecked, setLockChecked] = useState(() => cachedBan()?.banned === true)
  const [updateLabel, setUpdateLabel] = useState<string | null>(null)
  const policy = useAppPolicy()
  const [appVersion, setAppVersion] = useState('0.2.8')
  const maintenanceOn = policy.maintenanceOn || gate.maintenanceOn
  const maintenanceMessage = policy.maintenanceMessage || gate.maintenanceMessage
  const updateRequired = !isAdmin && versionIsOlder(appVersion, policy.minVersion)

  const navigate = (id: NavId) => {
    if (id === 'admin' && !isAdmin) {
      setView('account')
      return
    }
    if (id === 'write' || id === 'ai-core') {
      setView('scribble-ai')
      return
    }
    setView(id)
  }
  const activeView = view === 'admin' && !isAdmin ? 'account' : view

  useEffect(() => {
    setStatusMsg(
      view === 'live'
        ? 'Live — paste text, focus target window, F9 to type (F10 stop, F11 pause)'
        : view === 'ocr'
          ? 'Extract Text from Picture — drop an image to pull out its text (runs locally on your PC)'
          : view === 'scribble-ai'
            ? 'Scribble AI — write essays or chat, all on this PC'
            : 'Ready',
    )
    setStatusProg(0)
  }, [view])

  useEffect(() => {
    const onUpdate = (event: Event) => {
      setUpdateLabel((event as CustomEvent<string | null>).detail)
    }
    window.addEventListener(UPDATE_EVENT, onUpdate)
    const cancel = inTauri ? scheduleStartupUpdateProbe() : () => {}
    return () => {
      cancel()
      window.removeEventListener(UPDATE_EVENT, onUpdate)
    }
  }, [])

  useEffect(() => {
    if (!appLock.banned) return
    void stopTypingSession()
  }, [appLock.banned])

  useEffect(() => startAppPolicy(), [])

  useEffect(() => {
    if (!inTauri) return
    void invoke<{ version: string }>('app_info')
      .then((info) => setAppVersion(info.version))
      .catch(() => {})
  }, [])

  useEffect(() => {
    let alive = true
    const tick = () => {
      void (async () => {
        if (user) await registerDevice()
        const lock = await checkAppLock()
        if (!alive) return
        setLockChecked(true)
        setAppLock((prev) => (prev.banned === lock.banned && prev.reason === lock.reason ? prev : lock))
      })()
    }
    const onLocked = (event: Event) => {
      const lock = (event as CustomEvent<AppLock>).detail
      if (!lock?.banned) return
      setLockChecked(true)
      setAppLock(lock)
    }
    window.addEventListener('scribble:pc-locked', onLocked)
    tick()
    const timer = window.setInterval(tick, 5000)
    window.addEventListener(LIVE_EVENT, tick)
    return () => {
      alive = false
      window.clearInterval(timer)
      window.removeEventListener(LIVE_EVENT, tick)
      window.removeEventListener('scribble:pc-locked', onLocked)
    }
  }, [user])

  useEffect(() => {
    try {
      localStorage.setItem(LAST_VIEW_KEY, activeView)
    } catch {
      // Navigation still works if WebView storage is unavailable.
    }
  }, [activeView])

  useEffect(() => {
    const show = () => setShowOnboarding(true)
    window.addEventListener(ONBOARDING_RESET_EVENT, show)
    return () => window.removeEventListener(ONBOARDING_RESET_EVENT, show)
  }, [])

  const title = titleForView(activeView)

  const sendToLive = (text: string) => {
    pushTextToLiveBuffer(text, () => navigate('live'))
  }

  const hiddenNav: NavId[] = isAdmin
    ? []
    : [
        !policy.liveOn ? 'live' : null,
        !policy.ocrOn ? 'ocr' : null,
        !policy.aiOn ? 'scribble-ai' : null,
        !policy.analyticsOn ? 'analytics' : null,
        !policy.templatesOn ? 'templates' : null,
        !policy.scribblesOn ? 'scribbles' : null,
      ].filter((id): id is NavId => id !== null)

  if (!lockChecked || authLoading) {
    return <div className="app-atmosphere h-dvh" />
  }

  if (appLock.banned) {
    return (
      <div className="app-atmosphere flex h-dvh items-center justify-center p-8">
        <div className="max-w-md text-center">
          <p className="eyebrow">Closed</p>
          <h1 className="font-display mt-3 text-[36px] leading-none text-foreground">Scribble is closed</h1>
          <p className="mt-4 text-[14px] leading-relaxed text-muted-foreground">{appLock.reason}</p>
        </div>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="app-atmosphere flex h-dvh items-center justify-center p-8">
        <div className="max-w-md text-center">
          <p className="eyebrow">Account</p>
          <h1 className="font-display mt-3 text-[36px] leading-none text-foreground">Sign in to use Scribble</h1>
          <p className="mt-4 text-[14px] leading-relaxed text-muted-foreground">
            Scribble stays closed until a Google account that is allowed to use it signs in.
          </p>
          {authError && <p className="mt-3 text-[13px] text-destructive">{authError}</p>}
          <button
            type="button"
            className="mt-6 rounded-xl bg-primary px-4 py-2 text-[13px] font-semibold text-primary-foreground disabled:opacity-60"
            disabled={actionLoading}
            onClick={() => void signInWithGoogle()}
          >
            {actionLoading ? 'Waiting for Google…' : 'Continue with Google'}
          </button>
        </div>
      </div>
    )
  }

  if (updateRequired) {
    return (
      <div className="app-atmosphere flex h-dvh items-center justify-center p-8">
        <div className="max-w-md text-center">
          <p className="eyebrow">Update</p>
          <h1 className="font-display mt-3 text-[36px] leading-none text-foreground">Scribble needs an update</h1>
          <p className="mt-4 text-[14px] leading-relaxed text-muted-foreground">
            {policy.updateMessage || `Version ${policy.minVersion} or newer is required. You are on ${appVersion}.`}
          </p>
          {policy.supportEmail && <p className="mt-3 text-[13px] text-muted-foreground">{policy.supportEmail}</p>}
        </div>
      </div>
    )
  }

  if (updateLabel) {
    return (
      <div className="app-atmosphere flex h-dvh items-center justify-center p-8">
        <div className="max-w-md text-center">
          <p className="eyebrow">Update</p>
          <h1 className="font-display mt-3 text-[36px] leading-none text-foreground">Updating Scribble</h1>
          <p className="mt-4 text-[14px] leading-relaxed text-muted-foreground">{updateLabel}</p>
        </div>
      </div>
    )
  }

  return (
    <>
      <TypingHost />
      {showOnboarding && policy.onboardingOn && <Onboarding onClose={() => setShowOnboarding(false)} onNavigate={navigate} />}
    <div className="app-atmosphere flex h-dvh min-h-0 w-screen overflow-hidden">
      <div className="app-window flex h-full min-h-0 w-full overflow-hidden">
        <Sidebar active={activeView} onChange={navigate} isAdmin={isAdmin} hidden={hiddenNav} />
        <main className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background/40">
          <Header title={title} onNavigate={navigate} />
          <NoticeBanner />
          {maintenanceOn && isAdmin && (
            <p className="mx-6 mt-3 rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-[13px] text-foreground">
              Maintenance is on. Other people see a locked screen until you turn it off in Admin.
            </p>
          )}
          <div className="min-h-0 flex-1 overflow-hidden">
            {maintenanceOn && !isAdmin ? (
              <div className="flex h-full items-center justify-center p-8">
                <div className="max-w-md text-center">
                  <h2 className="font-display text-[28px] text-foreground">Scribble is paused</h2>
                  <p className="mt-3 text-[14px] leading-relaxed text-muted-foreground">
                    {maintenanceMessage || 'The owner has paused Scribble for a bit. Try again later.'}
                  </p>
                  <button type="button" className="mt-6 text-[13px] text-primary" onClick={() => void signOut()}>
                    Sign out
                  </button>
                </div>
              </div>
            ) : null}
            {!(maintenanceOn && !isAdmin) && hiddenNav.includes(activeView) && (
              <div className="flex h-full items-center justify-center p-8 text-center text-[14px] text-muted-foreground">
                The owner turned this page off.
              </div>
            )}
            {!(maintenanceOn && !isAdmin) && !hiddenNav.includes(activeView) && activeView === 'dashboard' && <Dashboard onNavigate={navigate} onSendToLive={sendToLive} />}
            {!(maintenanceOn && !isAdmin) && !hiddenNav.includes(activeView) && activeView === 'live' && (
              <Live
                onStatus={(msg, prog) => {
                  setStatusMsg(msg)
                  setStatusProg(prog ?? 0)
                }}
              />
            )}
            {!(maintenanceOn && !isAdmin) && !hiddenNav.includes(activeView) && activeView === 'scribbles' && <Scribbles onSendToLive={sendToLive} />}
            {!(maintenanceOn && !isAdmin) && !hiddenNav.includes(activeView) && activeView === 'templates' && <Templates onSendToLive={sendToLive} />}
            <Suspense fallback={null}>
            {!(maintenanceOn && !isAdmin) && !hiddenNav.includes(activeView) && activeView === 'ocr' && <OcrScanner onSendToLive={sendToLive} />}
            {!(maintenanceOn && !isAdmin) && !hiddenNav.includes(activeView) && activeView === 'analytics' && <Analytics />}
            {!(maintenanceOn && !isAdmin) && !hiddenNav.includes(activeView) && activeView === 'scribble-ai' && <ScribbleAI onSendToLive={sendToLive} />}
            {!(maintenanceOn && !isAdmin) && activeView === 'account' && <Account onGoSettings={() => setView('settings')} />}
            {!(maintenanceOn && !isAdmin) && activeView === 'admin' && isAdmin && <Admin />}
            </Suspense>
            {!(maintenanceOn && !isAdmin) && activeView === 'settings' && <Settings />}
          </div>
          <StatusBar message={policy.statusLine || statusMsg} progress={statusProg} onOpenLive={() => navigate('live')} />
          <DesktopPresence onOpenLive={() => navigate('live')} />
        </main>
      </div>
    </div>
    </>
  )
}

export default App
