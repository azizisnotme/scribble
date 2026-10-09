/** Live typing speed presets — WPM clamp matches Rust engine (10–2000). */

export const LIVE_WPM_MIN = 10
export const LIVE_WPM_MAX = 2000

export const LIVE_WPM_PRESETS = [
  { id: 'crawl', label: 'Crawl', wpm: 40, hint: 'Very slow' },
  { id: 'slow', label: 'Slow', wpm: 80, hint: 'Careful' },
  { id: 'practice', label: 'Practice', wpm: 120, hint: 'Learning' },
  { id: 'steady', label: 'Steady', wpm: 180, hint: 'Comfortable' },
  { id: 'normal', label: 'Normal', wpm: 220, hint: 'Default' },
  { id: 'fast', label: 'Fast', wpm: 350, hint: 'Quick' },
  { id: 'turbo', label: 'Turbo', wpm: 500, hint: 'Very fast' },
  { id: 'blitz', label: 'Blitz', wpm: 800, hint: 'Rapid' },
  { id: 'max', label: 'Max', wpm: 1200, hint: 'Near limit' },
  { id: 'insane', label: 'Insane', wpm: 2000, hint: 'Engine max' },
] as const

export const LIVE_DELAY_PRESETS = [
  { ms: 0, label: 'Instant' },
  { ms: 500, label: '0.5s' },
  { ms: 1000, label: '1s' },
  { ms: 2000, label: '2s' },
  { ms: 3000, label: '3s' },
  { ms: 5000, label: '5s' },
  { ms: 10000, label: '10s' },
] as const

export const KEY_LIVE_WPM = 'scribble_live_wpm'
const KEY_WPM_BY_APP = 'scribble_wpm_by_app'

export function appSpeedKey(title: string): string {
  const cleaned = title.replace(/\s+/g, ' ').trim().slice(0, 80)
  return cleaned || 'focused window'
}

export function loadAppWpm(title: string): number | null {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY_WPM_BY_APP) ?? '{}') as Record<string, number>
    const value = saved[appSpeedKey(title)]
    return Number.isFinite(value) ? clampWpm(value) : null
  } catch {
    return null
  }
}

export function saveAppWpm(title: string, wpm: number): void {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY_WPM_BY_APP) ?? '{}') as Record<string, number>
    saved[appSpeedKey(title)] = clampWpm(wpm)
    localStorage.setItem(KEY_WPM_BY_APP, JSON.stringify(saved))
  } catch {
    // The global speed still applies if this map cannot be stored.
  }
}
export const KEY_LIVE_DELAY_MS = 'scribble_live_delay_ms'

export function clampWpm(n: number): number {
  if (!Number.isFinite(n)) return 220
  return Math.min(LIVE_WPM_MAX, Math.max(LIVE_WPM_MIN, Math.round(n)))
}

export function loadSavedWpm(): number {
  try {
    const n = Number(localStorage.getItem(KEY_LIVE_WPM))
    return clampWpm(n)
  } catch {
    return 220
  }
}

export function loadSavedDelayMs(): number {
  try {
    const n = Number(localStorage.getItem(KEY_LIVE_DELAY_MS))
    if (!Number.isFinite(n) || n < 0) return 2000
    return Math.min(30_000, Math.round(n))
  } catch {
    return 2000
  }
}

export function estimatedMinutes(chars: number, wpm: number): string {
  if (chars <= 0 || wpm <= 0) return '—'
  const words = chars / 5
  const mins = words / wpm
  if (mins < 1) return `${Math.max(1, Math.round(mins * 60))}s`
  if (mins < 60) return `${mins.toFixed(1)} min`
  return `${(mins / 60).toFixed(1)} hr`
}
