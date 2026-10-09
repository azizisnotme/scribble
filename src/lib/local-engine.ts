// Built-in engine. Analytics live in localStorage, text extraction runs in
// WebAssembly via tesseract.js (see ./ocr), and recent uploads come from a
// small localStorage-backed list. Everything in this file is renderer-side only.

import { extractText } from '@/lib/ocr'
import { storageGetJson, storageSetJson } from '@/lib/storage'

const ANALYTICS_KEY = 'scribble_analytics_v1'
const RECENT_KEY = 'scribble_recent_uploads_v1'
const MAX_RECENT = 6

interface DailyBucket {
  chars: number
  words: number
  sessions: number
}

interface AnalyticsState {
  lifetime_chars: number
  lifetime_words: number
  lifetime_sessions: number
  daily: Record<string, DailyBucket>
  first_seen: string | null
  last_typed: string | null
  recent_sessions: AnalyticsSession[]
}

export interface AnalyticsSession {
  ts: string
  chars: number
  words: number
  source: string
}

export interface RecentUpload {
  id: string
  name: string
  age: string
  status: 'done' | 'upload' | 'ongoing'
  ts: number
  text?: string
  imageDataUrl?: string
  confidence?: number
  ms?: number
}

const WORD_RE = /\b[\w'\u2019-]+\b/gu

function utcIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
}

function todayKeyUtc(): string {
  return new Date().toISOString().slice(0, 10)
}

function emptyState(): AnalyticsState {
  return {
    lifetime_chars: 0,
    lifetime_words: 0,
    lifetime_sessions: 0,
    daily: {},
    first_seen: utcIso(),
    last_typed: null,
    recent_sessions: [],
  }
}

function loadAnalytics(): AnalyticsState {
  try {
    const data = storageGetJson<Partial<AnalyticsState> | null>(ANALYTICS_KEY, null)
    if (!data) return emptyState()
    const base = emptyState()
    return {
      ...base,
      ...data,
      daily: typeof data.daily === 'object' && data.daily !== null ? data.daily : {},
      recent_sessions: Array.isArray(data.recent_sessions) ? data.recent_sessions : [],
    }
  } catch {
    return emptyState()
  }
}

function saveAnalytics(s: AnalyticsState): void {
  try {
    storageSetJson(ANALYTICS_KEY, s)
  } catch {
    /* storage quota; ignore */
  }
}

function countWords(text: string): number {
  if (!text) return 0
  const m = text.match(WORD_RE)
  return m ? m.length : 0
}

export function readAnalyticsSummary(days = 14): Record<string, unknown> {
  const state = loadAnalytics()
  const daily = state.daily
  const sortedDays = Object.keys(daily).sort().reverse().slice(0, days)
  const recent = [...sortedDays].reverse().map((d) => ({
    date: d,
    chars: daily[d]?.chars ?? 0,
    words: daily[d]?.words ?? 0,
    sessions: daily[d]?.sessions ?? 0,
  }))
  const today = todayKeyUtc()
  const tb = daily[today] ?? { chars: 0, words: 0, sessions: 0 }
  return {
    lifetime_chars: state.lifetime_chars,
    lifetime_words: state.lifetime_words,
    lifetime_sessions: state.lifetime_sessions,
    today_chars: tb.chars,
    today_words: tb.words,
    today_sessions: tb.sessions,
    first_seen: state.first_seen,
    last_typed: state.last_typed,
    recent_days: recent,
    recent_sessions: state.recent_sessions.slice(0, 20),
  }
}

export function recordAnalyticsTyped(textOrChars: string | number, source = 'typing'): Record<string, unknown> {
  const state = loadAnalytics()
  let chars = 0
  let words = 0
  if (typeof textOrChars === 'number') {
    chars = Math.max(0, Math.floor(textOrChars))
  } else {
    const text = textOrChars || ''
    chars = text.length
    words = countWords(text)
  }
  if (chars <= 0) return readAnalyticsSummary()

  state.lifetime_chars += chars
  state.lifetime_words += words
  state.lifetime_sessions += 1
  state.last_typed = utcIso()
  state.recent_sessions.unshift({ ts: state.last_typed, chars, words, source })
  state.recent_sessions = state.recent_sessions.slice(0, 50)
  if (!state.first_seen) state.first_seen = utcIso()

  const day = todayKeyUtc()
  const bucket = state.daily[day] ?? { chars: 0, words: 0, sessions: 0 }
  bucket.chars += chars
  bucket.words += words
  bucket.sessions += 1
  state.daily[day] = bucket

  saveAnalytics(state)
  return readAnalyticsSummary()
}

function loadRecent(): RecentUpload[] {
  try {
    const data = storageGetJson<RecentUpload[]>(RECENT_KEY, [])
    return Array.isArray(data) ? (data as RecentUpload[]) : []
  } catch {
    return []
  }
}

function saveRecent(items: RecentUpload[]): void {
  try {
    storageSetJson(RECENT_KEY, items.slice(0, MAX_RECENT))
  } catch {
    /* ignore quota */
  }
}

function ageOf(ts: number): string {
  const diffMs = Date.now() - ts
  const min = Math.floor(diffMs / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`
  const d = Math.floor(hr / 24)
  return `${d} day${d === 1 ? '' : 's'} ago`
}

export function listRecentUploads(): RecentUpload[] {
  return loadRecent().map((r) => ({ ...r, age: ageOf(r.ts) }))
}

export function pushRecentUpload(
  name: string,
  status: RecentUpload['status'] = 'done',
  result?: Pick<RecentUpload, 'text' | 'imageDataUrl' | 'confidence' | 'ms'>,
): void {
  const items = loadRecent()
  const entry: RecentUpload = {
    id: `u_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name,
    age: 'just now',
    status,
    ts: Date.now(),
    ...result,
  }
  saveRecent([entry, ...items])
}

export async function dispatch(method: string, params: Record<string, unknown>): Promise<unknown> {
  switch (method) {
    case 'health.ping':
      return { ok: true, mode: 'local-engine', ts: Date.now() / 1000 }
    case 'analytics.stats':
      return readAnalyticsSummary(Number(params.days ?? 14))
    case 'analytics.record':
      return recordAnalyticsTyped(
        typeof params.chars === 'number'
          ? params.chars
          : typeof params.text === 'string'
            ? params.text
            : 0,
        typeof params.source === 'string' ? params.source : 'typing',
      )
    case 'ocr.recent':
      return listRecentUploads()
    case 'ocr.run': {
      const url = params.imageDataUrl
      const name = typeof params.path === 'string' ? params.path : 'image'
      if (typeof url === 'string' && url.startsWith('data:')) {
        const out = await extractText(url)
        pushRecentUpload(prettyName(name), out.text ? 'done' : 'ongoing')
        return { text: out.text, ms: out.ms, confidence: out.confidence }
      }
      throw new Error('Extracting text needs an image — drop one in or click Browse.')
    }
    default:
      throw new Error(`No local handler for ${method}`)
  }
}

function prettyName(p: string): string {
  if (!p) return 'image'
  const slash = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return slash >= 0 ? p.slice(slash + 1) : p
}
