import { useEffect, useState } from 'react'
import { Megaphone } from 'lucide-react'

import { LIVE_EVENT } from '@/lib/live-events'
import { supabase } from '@/lib/supabase'

interface Notice {
  title: string
  body: string
  active: boolean
  tone?: string
}

export const NOTICE_CHANGED_EVENT = 'scribble:notice-changed'

export function NoticeBanner() {
  const [notice, setNotice] = useState<Notice | null>(null)

  useEffect(() => {
    const client = supabase
    if (!client) return
    let alive = true
    const load = () => {
      void client
        .from('announcements')
        .select('title,body,active,tone')
        .eq('id', 1)
        .maybeSingle()
        .then(({ data, error }) => {
          if (!alive || error) return
          if (!data?.active || !data.body?.trim()) {
            setNotice(null)
            return
          }
          setNotice(data as Notice)
        })
    }
    load()
    const timer = window.setInterval(load, 30000)
    const refresh = () => load()
    window.addEventListener('focus', refresh)
    window.addEventListener(NOTICE_CHANGED_EVENT, refresh)
    window.addEventListener(LIVE_EVENT, refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      alive = false
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
      window.removeEventListener(NOTICE_CHANGED_EVENT, refresh)
      window.removeEventListener(LIVE_EVENT, refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [])

  if (!notice) return null

  return (
    <div className={notice.tone === 'warning' ? 'mx-6 mt-3 flex items-start gap-3 rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3' : 'mx-6 mt-3 flex items-start gap-3 rounded-2xl border border-primary/30 bg-primary/10 px-4 py-3'}>
      <Megaphone className={notice.tone === 'warning' ? 'mt-0.5 h-4 w-4 shrink-0 text-destructive' : 'mt-0.5 h-4 w-4 shrink-0 text-primary'} />
      <div className="min-w-0">
        {notice.title && <p className="text-[13px] font-semibold text-foreground">{notice.title}</p>}
        <p className="text-[13px] leading-relaxed text-muted-foreground">{notice.body}</p>
      </div>
    </div>
  )
}
