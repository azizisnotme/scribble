import { useSyncExternalStore } from 'react'

import { py } from '@/lib/ipc'
import { LIVE_BUFFER_EVENT, LIVE_BUFFER_STORAGE_KEY } from '@/lib/live-buffer-bridge'
import { loadSavedDelayMs, loadSavedWpm } from '@/lib/live-speed'
import {
  cancelTyping,
  pauseTyping,
  startTyping,
  type TypingDone,
  type TypingProgress,
  type TypingStartOptions,
} from '@/lib/typing-engine'

export const KEY_LIVE_DRAFT = 'scribble_live_draft'
export const KEY_AUTO_REPAIR = 'scribble_live_auto_repair'
export const KEY_TARGET_HWND = 'scribble_live_target_hwnd'
export const KEY_MISTAKES = 'scribble_live_mistakes'
export const KEY_THINKING_PAUSES = 'scribble_live_thinking_pauses'
export const MAX_TYPING_CHARS = 100_000

export interface TypingSessionState {
  running: boolean
  paused: boolean
  countdownMs: number
  typed: number
  total: number
  wordIndex: number
  wordTotal: number
  currentWord: string
  repairs: number
  message: string
  error: string | null
}

const initialState: TypingSessionState = {
  running: false,
  paused: false,
  countdownMs: 0,
  typed: 0,
  total: 0,
  wordIndex: 0,
  wordTotal: 0,
  currentWord: '',
  repairs: 0,
  message: 'Ready',
  error: null,
}

let state = initialState
let activeText = ''
const listeners = new Set<() => void>()

function update(patch: Partial<TypingSessionState>): void {
  state = { ...state, ...patch }
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function typingSessionSnapshot(): TypingSessionState {
  return state
}

export function useTypingSession(): TypingSessionState {
  return useSyncExternalStore(subscribe, typingSessionSnapshot, typingSessionSnapshot)
}

export function useTypingRunning(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => state.running,
    () => state.running,
  )
}

function read(key: string): string {
  try {
    return localStorage.getItem(key) ?? ''
  } catch {
    return ''
  }
}

export async function startTypingSession(text: string, options: TypingStartOptions): Promise<void> {
  const payload = text.trimEnd()
  if (!payload.trim()) throw new Error('Paste source text first.')
  if (payload.length > MAX_TYPING_CHARS) {
    throw new Error(`Text is too long. Scribble supports up to ${MAX_TYPING_CHARS.toLocaleString()} characters per run.`)
  }
  if (state.running) return

  activeText = payload
  update({
    running: true,
    paused: false,
    countdownMs: options.startDelayMs ?? 0,
    typed: 0,
    total: payload.length,
    wordIndex: 0,
    wordTotal: payload.trim().split(/\s+/).length,
    currentWord: '',
    repairs: 0,
    message: options.startDelayMs ? 'Switch to your target window…' : 'Starting…',
    error: null,
  })

  try {
    await startTyping(payload, options)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    update({ running: false, paused: false, countdownMs: 0, message: `Failed to start: ${message}`, error: message })
    throw error
  }
}

export async function startSavedTypingSession(): Promise<void> {
  const text = read(KEY_LIVE_DRAFT)
  await startTypingSession(text, {
    wpm: loadSavedWpm(),
    startDelayMs: loadSavedDelayMs(),
    targetWindowHwnd: Number(read(KEY_TARGET_HWND)) || 0,
    autoRepair: read(KEY_AUTO_REPAIR) !== '0',
    mistakesEnabled: read(KEY_MISTAKES) === '1',
    thinkingPauses: read(KEY_THINKING_PAUSES) === '1',
    mistakeChance: 0.02,
  })
}

export async function stopTypingSession(): Promise<void> {
  await cancelTyping()
  update({ running: false, paused: false, countdownMs: 0, message: 'Stopped.' })
}

export async function toggleTypingSessionPause(): Promise<void> {
  const paused = await pauseTyping()
  update({ paused, message: paused ? 'Paused — F11 to resume' : 'Resumed typing' })
}

export function handleTypingCountdown(remainingMs: number): void {
  update({
    countdownMs: remainingMs,
    message: remainingMs > 0 ? `Switch to target window… ${(remainingMs / 1000).toFixed(1)}s` : 'Typing…',
  })
}

export function handleTypingProgress(progress: TypingProgress): void {
  const repairNote = progress.repairs ? ` · ${progress.repairs} fixes` : ''
  update({
    running: true,
    paused: progress.paused,
    countdownMs: 0,
    typed: progress.typed,
    total: progress.total,
    wordIndex: progress.wordIndex,
    wordTotal: progress.wordTotal,
    currentWord: progress.currentWord,
    repairs: progress.repairs,
    message: `${progress.paused ? 'Paused' : 'Typing'}… ${progress.wordIndex}/${progress.wordTotal} words${repairNote}`,
    error: null,
  })
}

export function handleTypingDone(done: TypingDone): void {
  const label = done.reason === 'completed' ? 'Finished' : done.reason === 'cancelled' ? 'Stopped' : 'Error'
  update({
    running: false,
    paused: false,
    countdownMs: 0,
    typed: done.reason === 'completed' ? done.total : state.typed,
    total: done.total,
    wordIndex: done.reason === 'completed' ? state.wordTotal : state.wordIndex,
    repairs: done.repairs,
    message: `${label}: ${done.reason === 'completed' ? state.wordTotal : state.wordIndex}/${state.wordTotal} words`,
  })
  if (done.reason === 'completed' && activeText) {
    void py('analytics.record', { text: activeText, source: 'live-typing' })
  }
  activeText = ''

  try {
    const queued = localStorage.getItem(LIVE_BUFFER_STORAGE_KEY)
    if (queued?.trim()) {
      localStorage.setItem(KEY_LIVE_DRAFT, queued)
      localStorage.removeItem(LIVE_BUFFER_STORAGE_KEY)
      window.dispatchEvent(new CustomEvent(LIVE_BUFFER_EVENT))
      update({ message: 'Queued text is ready in Live.' })
    }
  } catch {
    // The completed session is still valid if local storage is unavailable.
  }
}

export function handleTypingError(message: string): void {
  activeText = ''
  update({ running: false, paused: false, countdownMs: 0, message: `Engine error: ${message}`, error: message })
}

export function handleTypingPauseChange(paused: boolean): void {
  update({ paused, message: paused ? 'Paused — F11 to resume' : 'Typing…' })
}
