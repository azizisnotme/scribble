import { ArrowUpRight, Bot, FileText, Keyboard, ScanText } from 'lucide-react'

import { OcrCard } from '@/components/OcrCard'
import { DraftingCard } from '@/components/DraftingCard'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import type { NavId } from '@/components/Sidebar'
import { readAnalyticsSummary } from '@/lib/local-engine'
import { getAiRuntimeSnapshot } from '@/lib/ai-runtime'
import { useAppPolicy } from '@/lib/app-policy'
import { KEY_LIVE_DRAFT, useTypingSession } from '@/lib/typing-session'

interface DashboardProps {
  onNavigate: (id: NavId) => void
  onSendToLive: (text: string) => void
}

export function Dashboard({ onNavigate, onSendToLive }: DashboardProps) {
  const session = useTypingSession()
  const policy = useAppPolicy()
  const stats = readAnalyticsSummary(1) as { today_words?: number; today_sessions?: number; lifetime_words?: number }
  const liveDraft = localStorage.getItem(KEY_LIVE_DRAFT) ?? ''
  const ai = getAiRuntimeSnapshot()

  return (
    <div className="flex h-full min-h-0 flex-col gap-5 overflow-auto px-6 pb-6 pt-4">
      <Card className="relative shrink-0 overflow-hidden border-border/50 p-6 sm:p-7">
        <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-primary/15 blur-3xl" />
        <div className="pointer-events-none absolute bottom-0 right-10 h-24 w-40 rounded-full bg-paper/10 blur-2xl" />
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl space-y-3">
            {(policy.welcomeTitle || policy.welcomeBody) && (
              <div className="rounded-2xl border border-primary/30 bg-primary/10 px-4 py-3">
                {policy.welcomeTitle && <p className="text-[13px] font-semibold text-foreground">{policy.welcomeTitle}</p>}
                {policy.welcomeBody && <p className="mt-1 text-[13px] text-muted-foreground">{policy.welcomeBody}</p>}
              </div>
            )}
            <p className="eyebrow">{policy.dashboardKicker || 'Midnight ink'}</p>
            <h2 className="font-display text-[clamp(1.7rem,2.4vw+0.8rem,2.6rem)] leading-[1.05] tracking-tight text-foreground">
              {policy.dashboardHeadline || 'Type anything, anywhere.'}
            </h2>
            <p className="max-w-xl text-[14px] leading-relaxed text-muted-foreground">
              Paste a draft, switch windows, and let Scribble type it for you. Extract text from pictures and keep
              optional AI on this computer only.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" className="rounded-full px-5 font-semibold" onClick={() => onNavigate('live')}>
              Open Live
              <ArrowUpRight className="h-4 w-4" />
            </Button>
            <Button type="button" variant="secondary" className="rounded-full px-4" onClick={() => onNavigate('ocr')}>
              Extract text
            </Button>
            <Button type="button" variant="outline" className="rounded-full px-4" onClick={() => onNavigate('scribble-ai')}>
              Scribble AI
            </Button>
          </div>
        </div>
      </Card>

      <div className="grid shrink-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          {
            id: 'live' as const,
            Icon: Keyboard,
            title: session.running ? 'Typing now' : 'Live draft',
            detail: session.running
              ? `${session.typed}/${session.total} characters`
              : liveDraft
                ? `${liveDraft.length} characters ready`
                : 'Start a new typing run',
          },
          {
            id: 'analytics' as const,
            Icon: FileText,
            title: 'Today',
            detail: `${stats.today_words ?? 0} words · ${stats.today_sessions ?? 0} sessions`,
          },
          {
            id: 'ocr' as const,
            Icon: ScanText,
            title: 'Extract text',
            detail: 'Read an image locally',
          },
          {
            id: 'scribble-ai' as const,
            Icon: Bot,
            title: 'Scribble AI',
            detail: ai.phase === 'ready' ? 'Local model ready' : 'Optional local writing help',
          },
        ].map(({ id, Icon, title, detail }) => (
          <button key={id} type="button" className="text-left" onClick={() => onNavigate(id)}>
            <Card className="h-full border-border/50 p-4 transition-all hover:-translate-y-0.5 hover:border-primary/40">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary/12 text-primary">
                <Icon className="h-4 w-4" />
              </span>
              <p className="mt-3 text-[13px] font-semibold text-foreground">{title}</p>
              <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{detail}</p>
            </Card>
          </button>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-5 xl:grid-cols-[minmax(260px,340px)_minmax(0,1fr)]">
        <OcrCard className="min-h-[380px] xl:min-h-0" advanced={false} onSendToLive={onSendToLive} />
        <DraftingCard onSendToLive={onSendToLive} />
      </div>
    </div>
  )
}
