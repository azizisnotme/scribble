import { useState } from 'react'
import { Keyboard, ChevronDown } from 'lucide-react'

import { cn } from '@/lib/utils'

const SHORTCUTS = [
  { keys: 'F9', action: 'Start typing', note: 'Focus target window first' },
  { keys: 'F10', action: 'Stop', note: 'Cancels immediately' },
  { keys: 'F11', action: 'Pause / resume', note: 'Hold position in text' },
] as const

export function LiveShortcutsMenu({ className }: { className?: string }) {
  const [open, setOpen] = useState(false)

  return (
    <div className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-9 items-center gap-2 rounded-xl border border-border/60 bg-secondary/50 px-3 text-[12px] font-semibold text-foreground shadow-sm hover:bg-secondary"
      >
        <Keyboard className="h-4 w-4 text-primary" strokeWidth={2} />
        Shortcuts
        <ChevronDown className={cn('h-3.5 w-3.5 opacity-60 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 cursor-default"
            aria-label="Close shortcuts menu"
            onClick={() => setOpen(false)}
          />
          <div className="absolute left-0 top-full z-50 mt-2 w-[min(320px,calc(100vw-3rem))] rounded-xl border border-border/60 bg-card p-3 shadow-xl">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Live typing keys
            </p>
            <ul className="space-y-2">
              {SHORTCUTS.map((s) => (
                <li key={s.keys} className="flex items-start justify-between gap-3 text-[12px]">
                  <div>
                    <p className="font-medium text-foreground">{s.action}</p>
                    <p className="text-[11px] text-muted-foreground">{s.note}</p>
                  </div>
                  <kbd className="shrink-0 rounded-md border border-border/70 bg-secondary/80 px-2 py-0.5 font-mono text-[11px] font-semibold text-foreground">
                    {s.keys}
                  </kbd>
                </li>
              ))}
            </ul>
            <p className="mt-3 border-t border-border/50 pt-2 text-[11px] leading-relaxed text-muted-foreground">
              F10/F11 work from any screen while a session is active. Pick a target window on Live, or use the
              focused window after the think-time countdown.
            </p>
          </div>
        </>
      )}
    </div>
  )
}
