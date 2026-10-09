// Renderer-side facade for the Rust typing engine.

import { useEffect, useRef, useState } from 'react'
import { inTauri } from '@/lib/ipc'

export interface TypingProgress {
  typed: number
  total: number
  wordIndex: number
  wordTotal: number
  currentWord: string
  repairs: number
  paused: boolean
}

export interface TypingCountdown {
  remainingMs: number
}

export interface TypingDone {
  reason: 'completed' | 'cancelled' | 'error'
  total: number
  repairs: number
}

export interface TypingStatus {
  running: boolean
  paused: boolean
  typed: number
  total: number
  word_index: number
  word_total: number
  current_word: string
  repairs: number
}

export interface TargetWindowInfo {
  title: string
  hwnd: number
}

export interface TypingStartOptions {
  wpm?: number
  autoRepair?: boolean
  startDelayMs?: number
  /** Win32 HWND; preferred over title when set. */
  targetWindowHwnd?: number
  /** Fallback when HWND unset — empty = focused window after countdown. */
  targetWindowTitle?: string
  mistakesEnabled?: boolean
  mistakeChance?: number
  thinkingPauses?: boolean
}

type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>
type Listen = (event: string, handler: (e: { payload: unknown }) => void) => Promise<() => void>

let cachedInvoke: Invoke | null = null
let cachedListen: Listen | null = null

async function loadTauri(): Promise<{ invoke: Invoke; listen: Listen } | null> {
  if (!inTauri) return null
  if (cachedInvoke && cachedListen) return { invoke: cachedInvoke, listen: cachedListen }
  const core = await import('@tauri-apps/api/core')
  const event = await import('@tauri-apps/api/event')
  cachedInvoke = core.invoke as Invoke
  cachedListen = event.listen as unknown as Listen
  return { invoke: cachedInvoke, listen: cachedListen }
}

export async function listTargetWindows(): Promise<TargetWindowInfo[]> {
  const t = await loadTauri()
  if (!t) return []
  return (await t.invoke('list_target_windows')) as TargetWindowInfo[]
}

export async function startTyping(text: string, options: TypingStartOptions = {}): Promise<void> {
  const t = await loadTauri()
  if (!t) {
    throw new Error('Typing engine requires the Tauri runtime (run the desktop build, not the browser preview).')
  }
  await t.invoke('type_text', {
    text,
    wpm: options.wpm ?? 220,
    autoRepair: options.autoRepair ?? true,
    startDelayMs: options.startDelayMs ?? 0,
    targetWindowHwnd: options.targetWindowHwnd ?? 0,
    targetWindowTitle: options.targetWindowTitle ?? '',
    mistakesEnabled: options.mistakesEnabled ?? false,
    mistakeChance: options.mistakeChance ?? 0.02,
    thinkingPauses: options.thinkingPauses ?? false,
  })
}

export async function cancelTyping(): Promise<boolean> {
  const t = await loadTauri()
  if (!t) return false
  return (await t.invoke('cancel_typing')) as boolean
}

export async function pauseTyping(): Promise<boolean> {
  const t = await loadTauri()
  if (!t) return false
  return (await t.invoke('pause_typing')) as boolean
}

export async function getTypingStatus(): Promise<TypingStatus | null> {
  const t = await loadTauri()
  if (!t) return null
  return (await t.invoke('typing_status')) as TypingStatus
}

interface TypingEventOptions {
  onProgress?: (p: TypingProgress) => void
  onCountdown?: (c: TypingCountdown) => void
  onDone?: (d: TypingDone) => void
  onError?: (msg: string) => void
  onHotkeyStart?: () => void
  onHotkeyCancel?: () => void
  onHotkeyPause?: () => void
  onPauseChange?: (paused: boolean) => void
}

export function readTypingProgress(payload: unknown): TypingProgress {
  const raw = (payload ?? {}) as Record<string, unknown>
  const num = (camel: string, snake: string) => {
    const value = raw[camel] ?? raw[snake]
    return typeof value === 'number' ? value : 0
  }
  const current = raw.currentWord ?? raw.current_word
  return {
    typed: num('typed', 'typed'),
    total: num('total', 'total'),
    wordIndex: num('wordIndex', 'word_index'),
    wordTotal: num('wordTotal', 'word_total'),
    currentWord: typeof current === 'string' ? current : '',
    repairs: num('repairs', 'repairs'),
    paused: Boolean(raw.paused),
  }
}

export function useTypingEvents(opts: TypingEventOptions): void {
  const optsRef = useRef(opts)
  optsRef.current = opts

  useEffect(() => {
    let disposed = false
    const unlisteners: Array<() => void> = []

    loadTauri()
      .then((t) => {
        if (!t || disposed) return
        const subs: Array<Promise<() => void>> = [
          t.listen('typing://progress', (e) => {
            optsRef.current.onProgress?.(readTypingProgress(e.payload))
          }),
          t.listen('typing://countdown', (e) => {
            const raw = e.payload as { remaining_ms?: number }
            const remainingMs = raw.remaining_ms ?? 0
            optsRef.current.onCountdown?.({ remainingMs })
          }),
          t.listen('typing://done', (e) => optsRef.current.onDone?.(e.payload as TypingDone)),
          t.listen('typing://error', (e) => {
            const p = e.payload
            optsRef.current.onError?.(typeof p === 'string' ? p : JSON.stringify(p))
          }),
          t.listen('typing://pause', (e) => {
            const paused = Boolean(e.payload)
            optsRef.current.onPauseChange?.(paused)
          }),
          t.listen('hotkey://start', () => optsRef.current.onHotkeyStart?.()),
          t.listen('hotkey://cancel', () => optsRef.current.onHotkeyCancel?.()),
          t.listen('hotkey://pause', () => optsRef.current.onHotkeyPause?.()),
        ]

        Promise.all(subs).then((fns) => {
          if (disposed) {
            fns.forEach((fn) => fn())
            return
          }
          unlisteners.push(...fns)
        })
      })
      .catch(() => {})

    return () => {
      disposed = true
      unlisteners.forEach((fn) => fn())
    }
  }, [])
}

export function useTypingStatus(intervalMs = 1000): TypingStatus {
  const [status, setStatus] = useState<TypingStatus>({
    running: false,
    paused: false,
    typed: 0,
    total: 0,
    word_index: 0,
    word_total: 0,
    current_word: '',
    repairs: 0,
  })
  useEffect(() => {
    let active = true
    const tick = () => {
      getTypingStatus().then((s) => {
        if (active && s) setStatus(s)
      })
    }
    tick()
    const id = window.setInterval(tick, intervalMs)
    return () => {
      active = false
      window.clearInterval(id)
    }
  }, [intervalMs])
  return status
}
