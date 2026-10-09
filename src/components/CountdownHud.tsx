import { useEffect, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { Pause, Play, Square } from 'lucide-react'

import { cancelTyping, pauseTyping, readTypingProgress, type TypingCountdown, type TypingDone } from '@/lib/typing-engine'
import { initUiTheme } from '@/lib/theme'

export function CountdownHud() {
  const [seconds, setSeconds] = useState<number | null>(null)
  const [doneWords, setDoneWords] = useState(0)
  const [goalWords, setGoalWords] = useState(0)
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    const apply = () => initUiTheme()
    apply()
    window.addEventListener('storage', apply)
    let stopTheme = () => {}
    void listen('ui://theme', apply).then((stop) => {
      stopTheme = stop
    })
    return () => {
      window.removeEventListener('storage', apply)
      stopTheme()
    }
  }, [])

  useEffect(() => {
    const stops: Array<() => void> = []
    void listen<TypingCountdown>('typing://countdown', (event) => {
      const remaining = event.payload.remainingMs ?? (event.payload as { remaining_ms?: number }).remaining_ms ?? 0
      setSeconds(remaining > 0 ? Math.ceil(remaining / 1000) : null)
    }).then((stop) => stops.push(stop))
    void listen('typing://progress', (event) => {
      const progress = readTypingProgress(event.payload)
      setSeconds(null)
      setDoneWords(progress.wordIndex)
      setGoalWords(progress.wordTotal)
      setPaused(progress.paused)
    }).then((stop) => stops.push(stop))
    void listen<boolean>('typing://pause', (event) => {
      setPaused(Boolean(event.payload))
    }).then((stop) => stops.push(stop))
    void listen<TypingDone>('typing://done', () => {
      setSeconds(null)
      setDoneWords(0)
      setGoalWords(0)
      setPaused(false)
    }).then((stop) => stops.push(stop))
    return () => {
      for (const stop of stops) stop()
    }
  }, [])

  const progress = goalWords > 0 ? Math.round((doneWords / goalWords) * 100) : 0
  const counting = seconds != null
  if (!counting && goalWords === 0) return null
  const label = counting ? 'Get ready' : paused ? 'Paused' : 'Typing'
  const value = counting ? `${seconds}s` : `${doneWords}/${goalWords} words`

  return (
    <div className="flex h-screen w-screen items-center bg-transparent p-5">
      <div className="flex w-full flex-col gap-3 rounded-[22px] bg-card/80 px-3.5 py-3 text-card-foreground shadow-[0_16px_40px_-20px_hsl(var(--primary)/0.55)] ring-1 ring-primary/20 backdrop-blur-2xl">
        <div className="flex items-center gap-3">
          <span className="h-10 w-1 shrink-0 rounded-full bg-primary" />
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">{label}</p>
            <p className="font-display mt-1 text-[26px] leading-none tracking-tight">{value}</p>
          </div>
          <button
            type="button"
            className="grid h-9 w-9 place-items-center rounded-xl bg-secondary text-secondary-foreground"
            aria-label={paused ? 'Resume typing' : 'Pause typing'}
            onClick={() => void pauseTyping()}
          >
            {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
          </button>
          <button
            type="button"
            className="grid h-9 w-9 place-items-center rounded-xl bg-destructive/15 text-destructive"
            aria-label="Stop typing"
            onClick={() => void cancelTyping()}
          >
            <Square className="h-4 w-4" />
          </button>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-300"
            style={{ width: counting ? '100%' : `${progress}%` }}
          />
        </div>
      </div>
    </div>
  )
}
