import { Pause, Play, Square } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { stopTypingSession, toggleTypingSessionPause, useTypingSession } from '@/lib/typing-session'

interface StatusBarProps {
  message?: string
  progress?: number
  onOpenLive?: () => void
}

export function StatusBar({ message = 'idle', progress = 0, onOpenLive }: StatusBarProps) {
  const session = useTypingSession()
  const wordGoal = session.wordTotal
  const wordDone = wordGoal > 0 ? session.wordIndex : 0
  const sessionProgress = wordGoal > 0 ? wordDone / wordGoal : progress
  const pct = Math.min(100, Math.max(0, Math.round(sessionProgress * 100)))
  const visibleMessage = session.running || session.error ? session.message : message

  return (
    <footer
      className="flex shrink-0 items-center gap-3 border-t border-border/40 bg-sidebar px-4 py-2.5 sm:px-6"
      role="status"
      aria-live="polite"
    >
      <span
        className={
          session.running
            ? 'relative flex h-2 w-2'
            : 'h-2 w-2 rounded-full bg-muted-foreground/40'
        }
      >
        {session.running && (
          <>
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
          </>
        )}
      </span>
      <button
        type="button"
        className="min-w-0 flex-1 truncate text-left text-[12px] text-muted-foreground hover:text-foreground"
        onClick={session.running ? onOpenLive : undefined}
        disabled={!session.running}
      >
        {visibleMessage}
      </button>
      {session.running && (
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            aria-label={session.paused ? 'Resume typing' : 'Pause typing'}
            onClick={() => void toggleTypingSessionPause()}
          >
            {session.paused ? <Play /> : <Pause />}
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-destructive"
            aria-label="Stop typing"
            onClick={() => void stopTypingSession()}
          >
            <Square />
          </Button>
        </div>
      )}
      {wordGoal > 0 && (
        <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
          {wordDone.toLocaleString()}/{wordGoal.toLocaleString()} words
        </span>
      )}
      <div className="h-1.5 w-40 max-w-[35vw] overflow-hidden rounded-full bg-secondary">
        <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${pct}%` }} />
      </div>
    </footer>
  )
}
