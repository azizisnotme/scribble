import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

import { Button } from '@/components/ui/button'
import { inTauri } from '@/lib/ipc'
import { pushTextToLiveBuffer } from '@/lib/live-buffer-bridge'
import { policySnapshot, useAppPolicy } from '@/lib/app-policy'
import { useTypingRunning } from '@/lib/typing-session'

interface ClipboardOffer {
  text: string
  preview: string
}

export function DesktopPresence({ onOpenLive }: { onOpenLive: () => void }) {
  const running = useTypingRunning()
  const policy = useAppPolicy()
  const [offer, setOffer] = useState<ClipboardOffer | null>(null)

  useEffect(() => {
    if (!inTauri) return
    void invoke('overlay_set_visible', { visible: running && policy.overlayOn }).catch(() => {})
  }, [policy.overlayOn, running])

  useEffect(() => {
    if (!inTauri) return
    let stop = () => {}
    void listen<ClipboardOffer>('clipboard://offer', (event) => {
      if (policySnapshot().clipboardOn && event.payload?.text) setOffer(event.payload)
    }).then((unlisten) => {
      stop = unlisten
    })
    return () => stop()
  }, [])

  if (!offer) return null

  return (
    <div className="pointer-events-none absolute bottom-16 right-5 z-40 w-[min(22rem,calc(100vw-2rem))]">
      <div className="pointer-events-auto rounded-2xl border border-primary/30 bg-card/95 p-4 shadow-2xl">
        <p className="text-[12px] font-semibold text-foreground">Copied text is ready</p>
        <p className="mt-1 line-clamp-3 text-[12px] leading-relaxed text-muted-foreground">{offer.preview}</p>
        <div className="mt-3 flex gap-2">
          <Button
            type="button"
            size="sm"
            className="rounded-xl"
            onClick={() => {
              pushTextToLiveBuffer(offer.text, onOpenLive)
              setOffer(null)
            }}
          >
            Send to Live
          </Button>
          <Button type="button" size="sm" variant="ghost" className="rounded-xl" onClick={() => setOffer(null)}>
            Dismiss
          </Button>
        </div>
      </div>
    </div>
  )
}
