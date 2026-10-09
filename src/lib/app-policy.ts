import { useSyncExternalStore } from 'react'

import { NOTICE_CHANGED_EVENT } from '@/components/NoticeBanner'
import { LIVE_EVENT } from '@/lib/live-events'
import { supabase } from '@/lib/supabase'
import { setUiTheme, type UiThemeId } from '@/lib/theme'

export interface AppPolicy {
  signupsOpen: boolean
  maintenanceOn: boolean
  maintenanceMessage: string
  signupMessage: string
  allowedDomain: string
  minVersion: string
  updateMessage: string
  supportEmail: string
  welcomeTitle: string
  welcomeBody: string
  statusLine: string
  dashboardKicker: string
  dashboardHeadline: string
  lockTheme: string
  liveOn: boolean
  ocrOn: boolean
  aiOn: boolean
  analyticsOn: boolean
  templatesOn: boolean
  scribblesOn: boolean
  clipboardOn: boolean
  typingOn: boolean
  readOnly: boolean
  forceRepair: boolean
  allowTypos: boolean
  allowPauses: boolean
  hotkeysOn: boolean
  overlayOn: boolean
  onboardingOn: boolean
  backupOn: boolean
  maxWpm: number
  maxChars: number
  defaultWpm: number
  defaultCountdownSec: number
}

const OPEN_POLICY: AppPolicy = {
  signupsOpen: true,
  maintenanceOn: false,
  maintenanceMessage: '',
  signupMessage: '',
  allowedDomain: '',
  minVersion: '',
  updateMessage: '',
  supportEmail: '',
  welcomeTitle: '',
  welcomeBody: '',
  statusLine: '',
  dashboardKicker: '',
  dashboardHeadline: '',
  lockTheme: '',
  liveOn: true,
  ocrOn: true,
  aiOn: true,
  analyticsOn: true,
  templatesOn: true,
  scribblesOn: true,
  clipboardOn: true,
  typingOn: true,
  readOnly: false,
  forceRepair: false,
  allowTypos: true,
  allowPauses: true,
  hotkeysOn: true,
  overlayOn: true,
  onboardingOn: true,
  backupOn: true,
  maxWpm: 0,
  maxChars: 0,
  defaultWpm: 0,
  defaultCountdownSec: 0,
}

const THEMES = new Set<UiThemeId>([
  'cobalt',
  'bloodlust',
  'toxic',
  'hearth',
  'tide',
  'noir',
  'sketch',
  'classic_light',
  'frost',
  'parchment',
  'classic_dark',
])

let policy = OPEN_POLICY
const listeners = new Set<() => void>()

function flag(value: unknown, fallback: boolean) {
  if (value === undefined || value === null) return fallback
  return value === true
}

function text(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function whole(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0
}

export function policyFromRow(row: Record<string, unknown> | null | undefined): AppPolicy {
  if (!row) return OPEN_POLICY
  return {
    signupsOpen: row.signups_open !== false,
    maintenanceOn: row.maintenance_on === true,
    maintenanceMessage: text(row.maintenance_message),
    signupMessage: text(row.signup_message),
    allowedDomain: text(row.allowed_domain),
    minVersion: text(row.min_version),
    updateMessage: text(row.update_message),
    supportEmail: text(row.support_email),
    welcomeTitle: text(row.welcome_title),
    welcomeBody: text(row.welcome_body),
    statusLine: text(row.status_line),
    dashboardKicker: text(row.dashboard_kicker),
    dashboardHeadline: text(row.dashboard_headline),
    lockTheme: text(row.lock_theme),
    liveOn: flag(row.live_on, true),
    ocrOn: flag(row.ocr_on, true),
    aiOn: flag(row.ai_on, true),
    analyticsOn: flag(row.analytics_on, true),
    templatesOn: flag(row.templates_on, true),
    scribblesOn: flag(row.scribbles_on, true),
    clipboardOn: flag(row.clipboard_on, true),
    typingOn: flag(row.typing_on, true),
    readOnly: flag(row.read_only, false),
    forceRepair: flag(row.force_repair, false),
    allowTypos: flag(row.allow_typos, true),
    allowPauses: flag(row.allow_pauses, true),
    hotkeysOn: flag(row.hotkeys_on, true),
    overlayOn: flag(row.overlay_on, true),
    onboardingOn: flag(row.onboarding_on, true),
    backupOn: flag(row.backup_on, true),
    maxWpm: whole(row.max_wpm),
    maxChars: whole(row.max_chars),
    defaultWpm: whole(row.default_wpm),
    defaultCountdownSec: whole(row.default_countdown_sec),
  }
}

function samePolicy(left: AppPolicy, right: AppPolicy) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function publish(next: AppPolicy) {
  const themeChanged = next.lockTheme !== policy.lockTheme
  if (samePolicy(policy, next) && !themeChanged) return
  policy = next
  if (THEMES.has(next.lockTheme as UiThemeId)) setUiTheme(next.lockTheme as UiThemeId)
  listeners.forEach((listener) => listener())
}

export function policySnapshot() {
  return policy
}

export function useAppPolicy() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => policy,
    () => policy,
  )
}

export function versionIsOlder(current: string, minimum: string) {
  const required = minimum.trim()
  if (!required) return false
  const parts = (value: string) => value.split('.').map((part) => Number.parseInt(part, 10) || 0)
  const left = parts(current)
  const right = parts(required)
  for (let index = 0; index < 3; index += 1) {
    const have = left[index] ?? 0
    const need = right[index] ?? 0
    if (have < need) return true
    if (have > need) return false
  }
  return false
}

export function startAppPolicy() {
  const client = supabase
  if (!client) return () => {}
  let alive = true
  const load = () => {
    void client
      .from('app_controls')
      .select('*')
      .eq('id', 1)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!alive || error) return
        publish(policyFromRow(data as Record<string, unknown> | null))
      })
  }
  load()
  const timer = window.setInterval(load, 20000)
  window.addEventListener('focus', load)
  window.addEventListener(NOTICE_CHANGED_EVENT, load)
  window.addEventListener(LIVE_EVENT, load)
  return () => {
    alive = false
    window.clearInterval(timer)
    window.removeEventListener('focus', load)
    window.removeEventListener(NOTICE_CHANGED_EVENT, load)
    window.removeEventListener(LIVE_EVENT, load)
  }
}
