import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Gauge, Keyboard, Monitor, Pause, Play, RefreshCw, Sparkles, Square, Timer, Trash2, Zap } from 'lucide-react'

import { LiveShortcutsMenu } from '@/components/LiveShortcutsMenu'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { useAuth } from '@/contexts/auth'
import { useAppPolicy } from '@/lib/app-policy'
import { py } from '@/lib/ipc'
import { LIVE_BUFFER_EVENT, LIVE_BUFFER_STORAGE_KEY } from '@/lib/live-buffer-bridge'
import {
  clampWpm,
  loadAppWpm,
  saveAppWpm,
  estimatedMinutes,
  KEY_LIVE_DELAY_MS,
  KEY_LIVE_WPM,
  LIVE_DELAY_PRESETS,
  LIVE_WPM_MAX,
  LIVE_WPM_MIN,
  LIVE_WPM_PRESETS,
  loadSavedDelayMs,
  loadSavedWpm,
} from '@/lib/live-speed'
import {
  listTargetWindows,
  type TargetWindowInfo,
} from '@/lib/typing-engine'
import {
  KEY_AUTO_REPAIR,
  KEY_LIVE_DRAFT,
  KEY_MISTAKES,
  KEY_TARGET_HWND,
  KEY_THINKING_PAUSES,
  startTypingSession,
  stopTypingSession,
  toggleTypingSessionPause,
  useTypingSession,
} from '@/lib/typing-session'

interface LiveProps {
  onStatus: (message: string, progress?: number) => void
}

const FOCUSED_TARGET_LABEL = '(focused window after countdown)'

function loadDraft(): string {
  try {
    return localStorage.getItem(KEY_LIVE_DRAFT) ?? ''
  } catch {
    return ''
  }
}

export function Live({ onStatus }: LiveProps) {
  const session = useTypingSession()
  const policy = useAppPolicy()
  const { isAdmin } = useAuth()
  const { running, paused, countdownMs, wordIndex, wordTotal, currentWord, repairs } = session
  const [text, setText] = useState(loadDraft)
  const [wpm, setWpm] = useState(() => loadSavedWpm())
  const [startDelayMs, setStartDelayMs] = useState(() => loadSavedDelayMs())
  const [targetHwnd, setTargetHwnd] = useState(() => {
    try {
      return localStorage.getItem(KEY_TARGET_HWND) ?? ''
    } catch {
      return ''
    }
  })
  const [windows, setWindows] = useState<TargetWindowInfo[]>([])
  const [mistakesEnabled, setMistakesEnabled] = useState(() => {
    try {
      return localStorage.getItem(KEY_MISTAKES) === '1'
    } catch {
      return false
    }
  })
  const [thinkingPauses, setThinkingPauses] = useState(() => {
    try {
      return localStorage.getItem(KEY_THINKING_PAUSES) === '1'
    } catch {
      return false
    }
  })
  const [autoRepair, setAutoRepair] = useState(() => {
    try {
      return localStorage.getItem(KEY_AUTO_REPAIR) !== '0'
    } catch {
      return true
    }
  })
  const [lastMessage, setLastMessage] = useState<string | null>(null)

  const { chars, words } = useMemo(() => {
    const c = text.length
    const w = text.trim() ? text.trim().split(/\s+/).length : 0
    return { chars: c, words: w }
  }, [text])

  const refreshWindows = useCallback(async () => {
    try {
      const list = await listTargetWindows()
      setWindows(list)
    } catch {
      setWindows([])
    }
  }, [])

  useEffect(() => {
    void refreshWindows()
  }, [refreshWindows])

  const beginTyping = useCallback(async () => {
    const payload = policy.maxChars > 0 ? text.slice(0, policy.maxChars) : text
    if (!isAdmin && (!policy.typingOn || policy.readOnly)) {
      onStatus('The owner turned typing off.', 0)
      setLastMessage('The owner turned typing off.')
      return
    }
    if (!payload.trim()) {
      onStatus('Paste source text first.', 0)
      setLastMessage('Nothing to type yet.')
      return
    }
    setLastMessage(null)
    const speed = !isAdmin && policy.defaultWpm > 0 ? policy.defaultWpm : wpm
    const cappedSpeed = !isAdmin && policy.maxWpm > 0 ? Math.min(speed, policy.maxWpm) : speed
    const delayMs = !isAdmin && policy.defaultCountdownSec > 0 ? policy.defaultCountdownSec * 1000 : startDelayMs

    const delayNote =
      delayMs > 0
        ? `Switch to your document — ${(delayMs / 1000).toFixed(1)}s countdown. `
        : ''
    try {
      onStatus(`${delayNote}F10 stop · F11 pause.`, 0.05)
      const picked = windows.find((w) => String(w.hwnd) === targetHwnd)
      await startTypingSession(payload, {
        wpm: cappedSpeed,
        autoRepair: policy.forceRepair || autoRepair,
        startDelayMs: delayMs,
        targetWindowHwnd: targetHwnd ? Number(targetHwnd) : 0,
        targetWindowTitle: picked?.title ?? '',
        mistakesEnabled: policy.allowTypos && mistakesEnabled,
        thinkingPauses: policy.allowPauses && thinkingPauses,
        mistakeChance: 0.02,
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setLastMessage(msg)
      onStatus(`Failed to start: ${msg}`, 0)
    }
  }, [autoRepair, isAdmin, mistakesEnabled, onStatus, policy, startDelayMs, targetHwnd, text, thinkingPauses, windows, wpm])

  const stopTyping = useCallback(async () => {
    try {
      await stopTypingSession()
      onStatus('Stopped.', 0)
    } finally {
      setLastMessage('Stopped.')
    }
  }, [onStatus])

  const togglePause = useCallback(async () => {
    await toggleTypingSessionPause()
    const now = !paused
    onStatus(now ? 'Paused — F11 to resume' : 'Resumed typing', running ? 0.5 : 0)
  }, [onStatus, paused, running])

  const recordPractice = useCallback(async () => {
    if (!text.trim()) {
      onStatus('Paste text first before recording stats.', 0)
      return
    }
    try {
      await py('analytics.record', { text, source: 'live-practice' })
      onStatus(`Recorded ${words} words / ${chars} chars`, 1)
      window.setTimeout(() => onStatus('Ready', 0), 1800)
    } catch (e) {
      onStatus(`Could not record stats: ${e instanceof Error ? e.message : String(e)}`, 0)
    }
  }, [chars, onStatus, text, words])

  const pullFromBridge = useCallback((forceWhileRunning = false) => {
    try {
      const p = localStorage.getItem(LIVE_BUFFER_STORAGE_KEY)
      if (!p?.trim()) return
      if (running && !forceWhileRunning) {
        onStatus('New text queued — loads when this session ends.', 0)
        return
      }
      localStorage.removeItem(LIVE_BUFFER_STORAGE_KEY)
      setText(p)
      onStatus('Text loaded — set target window and press F9.', 0)
    } catch {
      /* ignore */
    }
  }, [onStatus, running])

  const onStatusRef = useRef(onStatus)
  onStatusRef.current = onStatus

  useEffect(() => {
    if (session.running) return
    if (session.error) setLastMessage(session.error)
    onStatusRef.current(session.message, 0)
  }, [session.error, session.message, session.running])

  useEffect(() => {
    pullFromBridge()
    const onBridge = () => pullFromBridge()
    window.addEventListener(LIVE_BUFFER_EVENT, onBridge)
    return () => window.removeEventListener(LIVE_BUFFER_EVENT, onBridge)
  }, [pullFromBridge])

  useEffect(() => {
    const id = window.setTimeout(() => {
      try {
        localStorage.setItem(KEY_LIVE_DRAFT, text)
      } catch {
        /* quota */
      }
    }, 400)
    return () => window.clearTimeout(id)
  }, [text])

  const sessionMatchesDraft = wordTotal > 0 && wordTotal === words
  const doneWords = sessionMatchesDraft ? wordIndex : 0
  const goalWords = words
  const progressPct = goalWords > 0 ? Math.round((doneWords / goalWords) * 100) : 0

  const targetTitle = windows.find((window) => String(window.hwnd) === targetHwnd)?.title ?? 'focused window'

  const setWpmPersisted = (next: number) => {
    const v = clampWpm(next)
    setWpm(v)
    saveAppWpm(targetTitle, v)
    try {
      localStorage.setItem(KEY_LIVE_WPM, String(v))
    } catch {
      /* ignore */
    }
  }

  const setDelayPersisted = (ms: number) => {
    const v = Math.min(30_000, Math.max(0, Math.round(ms)))
    setStartDelayMs(v)
    try {
      localStorage.setItem(KEY_LIVE_DELAY_MS, String(v))
    } catch {
      /* ignore */
    }
  }

  const setTargetPersisted = (hwnd: string) => {
    setTargetHwnd(hwnd)
    const title = windows.find((window) => String(window.hwnd) === hwnd)?.title ?? 'focused window'
    const remembered = loadAppWpm(title)
    if (remembered != null) {
      setWpm(remembered)
      try {
        localStorage.setItem(KEY_LIVE_WPM, String(remembered))
      } catch {
        /* ignore */
      }
    }
    try {
      localStorage.setItem(KEY_TARGET_HWND, hwnd)
    } catch {
      /* ignore */
    }
  }

  const eta = estimatedMinutes(chars, wpm)
  const showCountdown = running && countdownMs > 0

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="relative shrink-0 border-b border-border/40 px-6 py-3">
        <LiveShortcutsMenu />
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-6 pb-6 pt-4">
        <div className="mx-auto flex max-w-4xl flex-col gap-5">
          <Card className="border-border/60 p-5">
            <div className="flex items-start gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary">
                <Keyboard className="h-4 w-4" strokeWidth={2} />
              </span>
              <div>
                <h2 className="text-[15px] font-semibold text-foreground">Live typing</h2>
                <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                  Paste your text, pick a target window (or use the focused one), set a think-time countdown if you
                  need to switch apps, then press{' '}
                  <kbd className="rounded border border-border/60 bg-secondary/60 px-1.5 py-0.5 font-mono text-[11px]">
                    F9
                  </kbd>
                  . Scribble keeps the target in front until you stop.
                </p>
              </div>
            </div>
          </Card>

          <Card className="flex flex-col gap-4 border-border/60 p-5">
            <div className="flex flex-wrap items-center gap-4 text-[12px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5 font-mono tabular-nums">
                <Gauge className="h-3.5 w-3.5" strokeWidth={2} />
                {chars.toLocaleString()} chars
              </span>
              <span className="inline-flex items-center gap-1.5 font-mono tabular-nums">
                <Timer className="h-3.5 w-3.5" strokeWidth={2} />
                {words.toLocaleString()} words
              </span>
              {running && (
                <span className="ml-auto flex flex-wrap items-center justify-end gap-2">
                  {currentWord && (
                    <span className="rounded-full border border-border/60 bg-secondary/40 px-2.5 py-0.5 font-mono text-[11px] text-foreground">
                      Word: <strong className="font-semibold">{currentWord}</strong>
                    </span>
                  )}
                  <span className="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-0.5 font-mono text-[11px] text-primary tabular-nums">
                    {doneWords.toLocaleString()}/{goalWords.toLocaleString()} words
                    {repairs > 0 && ` · ${repairs} fixes`}
                  </span>
                </span>
              )}
            </div>

            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={running}
              placeholder="Paste source text here…"
              className="min-h-[200px] resize-y rounded-xl border border-border/60 bg-secondary/25 p-4 font-mono text-[13px] leading-relaxed text-foreground outline-none ring-primary/40 focus:ring-2 disabled:opacity-60"
            />

            <div className="space-y-3 rounded-xl border border-border/55 bg-secondary/15 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-foreground">
                  <Monitor className="h-3.5 w-3.5 text-primary" strokeWidth={2} />
                  Target window
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 rounded-lg px-2 text-[11px]"
                  disabled={running}
                  onClick={() => void refreshWindows()}
                >
                  <RefreshCw className="h-3 w-3" strokeWidth={2} />
                  Refresh list
                </Button>
              </div>
              <select
                value={targetHwnd}
                disabled={running}
                onChange={(e) => setTargetPersisted(e.target.value)}
                className="w-full rounded-lg border border-border/60 bg-secondary/40 px-3 py-2 text-[13px] text-foreground outline-none ring-primary/40 focus:ring-2 disabled:opacity-60"
              >
                <option value="">{FOCUSED_TARGET_LABEL}</option>
                {windows.map((w) => (
                  <option key={w.hwnd} value={String(w.hwnd)}>
                    {w.title}
                  </option>
                ))}
              </select>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Pick a window by title, or leave as focused. Scribble remembers a separate speed for each app.
              </p>
            </div>

            <div className="space-y-3 rounded-xl border border-border/55 bg-secondary/15 p-4">
              <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-foreground">
                <Sparkles className="h-3.5 w-3.5 text-primary" strokeWidth={2} />
                Think time (switch-app countdown)
              </span>
              <div className="flex flex-wrap gap-1.5">
                {LIVE_DELAY_PRESETS.map((p) => (
                  <button
                    key={p.ms}
                    type="button"
                    disabled={running}
                    onClick={() => setDelayPersisted(p.ms)}
                    className={cn(
                      'rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-colors',
                      startDelayMs === p.ms
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border/60 bg-card/60 text-muted-foreground hover:bg-secondary hover:text-foreground',
                    )}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">
                Use 2–5s to alt-tab into Word, Google Docs, Notepad, etc. before typing begins.
              </p>
            </div>

            <div className="space-y-2 rounded-xl border border-border/55 bg-secondary/15 p-4">
              <p className="text-[12px] font-semibold text-foreground">Realism</p>
              <label className="flex cursor-pointer items-center gap-2 text-[12px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={mistakesEnabled}
                  disabled={running}
                  onChange={(e) => {
                    const v = e.target.checked
                    setMistakesEnabled(v)
                    try {
                      localStorage.setItem(KEY_MISTAKES, v ? '1' : '0')
                    } catch {
                      /* ignore */
                    }
                  }}
                  className="accent-primary"
                />
                <span>
                  <strong className="font-semibold text-foreground">Human typos</strong> — wrong keys, pause,
                  backspace, then correct.
                </span>
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-[12px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={thinkingPauses}
                  disabled={running}
                  onChange={(e) => {
                    const v = e.target.checked
                    setThinkingPauses(v)
                    try {
                      localStorage.setItem(KEY_THINKING_PAUSES, v ? '1' : '0')
                    } catch {
                      /* ignore */
                    }
                  }}
                  className="accent-primary"
                />
                <span>
                  <strong className="font-semibold text-foreground">Thinking pauses</strong> — brief random pauses
                  while typing.
                </span>
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-[12px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={autoRepair}
                  disabled={running}
                  onChange={(e) => {
                    const v = e.target.checked
                    setAutoRepair(v)
                    try {
                      localStorage.setItem(KEY_AUTO_REPAIR, v ? '1' : '0')
                    } catch {
                      /* ignore */
                    }
                  }}
                  className="accent-primary"
                />
                <span>
                  <strong className="font-semibold text-foreground">Auto-fix deletions</strong> — if you erase text
                  in the target field, Scribble retypes the missing part.
                </span>
              </label>
            </div>

            <div className="space-y-3 rounded-xl border border-border/55 bg-secondary/15 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-foreground">
                  <Zap className="h-3.5 w-3.5 text-primary" strokeWidth={2} />
                  Typing speed
                </span>
                <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                  Est. {eta} at {wpm} WPM
                </span>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {LIVE_WPM_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    disabled={running}
                    title={p.hint}
                    onClick={() => setWpmPersisted(p.wpm)}
                    className={cn(
                      'rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-colors',
                      wpm === p.wpm
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border/60 bg-card/60 text-muted-foreground hover:bg-secondary hover:text-foreground',
                    )}
                  >
                    {p.label}
                    <span className="ml-1 font-mono font-normal opacity-80">{p.wpm}</span>
                  </button>
                ))}
              </div>

              <label className="flex flex-col gap-1.5 text-[12px] text-muted-foreground">
                <span className="font-semibold">
                  Fine-tune WPM ({LIVE_WPM_MIN}–{LIVE_WPM_MAX})
                </span>
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    type="range"
                    min={LIVE_WPM_MIN}
                    max={LIVE_WPM_MAX}
                    step={5}
                    value={wpm}
                    onChange={(e) => setWpmPersisted(Number(e.target.value))}
                    className="min-w-[140px] flex-1 accent-primary"
                    disabled={running}
                  />
                  <input
                    type="number"
                    min={LIVE_WPM_MIN}
                    max={LIVE_WPM_MAX}
                    step={5}
                    value={wpm}
                    onChange={(e) => setWpmPersisted(Number(e.target.value))}
                    disabled={running}
                    className="w-[72px] rounded-lg border border-border/60 bg-secondary/40 px-2 py-1 text-right font-mono text-[13px] text-foreground tabular-nums"
                  />
                </div>
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {!running ? (
                <Button
                  type="button"
                  className="rounded-xl font-semibold"
                  onClick={() => void beginTyping()}
                  disabled={!text.trim()}
                >
                  <Play className="mr-1.5 h-4 w-4" strokeWidth={2} />
                  Start (F9 in target window)
                </Button>
              ) : (
                <>
                  <Button
                    type="button"
                    variant="secondary"
                    className="rounded-xl font-semibold"
                    onClick={() => void togglePause()}
                  >
                    <Pause className="mr-1.5 h-4 w-4" strokeWidth={2} />
                    {paused ? 'Resume (F11)' : 'Pause (F11)'}
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    className="rounded-xl font-semibold"
                    onClick={() => void stopTyping()}
                  >
                    <Square className="mr-1.5 h-4 w-4" strokeWidth={2} />
                    Stop (F10)
                  </Button>
                </>
              )}

              <Button
                type="button"
                variant="outline"
                className="rounded-xl"
                onClick={() => {
                  setText('')
                  try {
                    localStorage.removeItem(KEY_LIVE_DRAFT)
                  } catch {
                    /* ignore */
                  }
                }}
                disabled={running}
              >
                <Trash2 className="mr-1.5 h-4 w-4" strokeWidth={2} />
                Clear
              </Button>

              <Button
                type="button"
                variant="ghost"
                className="rounded-xl text-muted-foreground"
                onClick={() => void recordPractice()}
                disabled={running || !text.trim()}
              >
                Just record stats
              </Button>

              <div className="ml-auto text-[12px] text-muted-foreground">
                {showCountdown
                  ? `Countdown… ${(countdownMs / 1000).toFixed(1)}s — switch to your document`
                  : running
                    ? paused
                      ? 'Paused — F11 to resume, F10 to stop'
                      : 'Typing in locked window…'
                    : lastMessage || ''}
              </div>
            </div>

            {showCountdown && (
              <div className="rounded-xl border border-primary/40 bg-primary/10 px-4 py-3 text-center">
                <p className="text-[13px] font-semibold text-primary">Switch to your target window</p>
                <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-foreground">
                  {(countdownMs / 1000).toFixed(1)}s
                </p>
              </div>
            )}

            {goalWords > 0 && (
              <div className="flex items-center gap-3">
                <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-secondary/60">
                  <div
                    className={cn(
                      'h-full transition-[width] duration-150 ease-out',
                      paused ? 'bg-muted-foreground' : 'bg-primary',
                    )}
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                <span className="shrink-0 font-mono text-[12px] tabular-nums text-muted-foreground">
                  {doneWords.toLocaleString()}/{goalWords.toLocaleString()} words
                </span>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}
