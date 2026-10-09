import { useEffect, useMemo, useState } from 'react'
import { Send } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { storageGetString, storageSetString } from '@/lib/storage'

const INITIAL_DOC = `Scribble scratchpad

Use this space to draft text before sending it to the Live view.
The native typing engine (Rust + enigo) will inject keystrokes
into whatever window has focus, so you can:

• Draft an email here, switch to your mail client, press F9.
• Compose a paragraph and let it type into Google Docs.
• Practise material at a chosen WPM before a transcription test.

Press F9 in Live to start, F10 anywhere to cancel.`

const DRAFT_KEY = 'scribble_dashboard_draft_v1'

export function DraftingCard({ onSendToLive, title = 'Quick draft' }: { onSendToLive: (text: string) => void; title?: string }) {
  const [body, setBody] = useState(() => storageGetString(DRAFT_KEY, INITIAL_DOC))
  const lineCount = useMemo(() => Math.max(1, body.split('\n').length), [body])

  useEffect(() => {
    const timer = window.setTimeout(() => storageSetString(DRAFT_KEY, body), 300)
    return () => window.clearTimeout(timer)
  }, [body])

  return (
    <Card className="relative flex h-full min-h-0 flex-col overflow-hidden border-border/60 bg-card">
      <div className="flex items-center justify-between border-b border-border/50 px-5 py-4">
        <h2 className="text-[14px] font-semibold tracking-tight text-foreground">
          Drafting: <span className="text-foreground/95">{title}</span>
        </h2>

        <div className="flex items-center gap-1.5">
          <Button size="sm" className="h-8 rounded-xl px-3 text-[12px]" disabled={!body.trim()} onClick={() => onSendToLive(body)}>
            <Send className="h-3.5 w-3.5" />
            Send to Live
          </Button>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <textarea
          spellCheck={false}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className="min-h-[320px] flex-1 resize-none border-0 bg-transparent px-5 py-5 font-mono text-[13px] leading-[1.75] text-foreground/92 outline-none ring-0 placeholder:text-muted-foreground focus:ring-0"
          aria-label="Draft document"
        />
        <div className="shrink-0 border-t border-border/40 px-5 py-2 text-[11px] text-muted-foreground">
          {lineCount} lines · saved automatically on this device
        </div>
      </div>
    </Card>
  )
}
