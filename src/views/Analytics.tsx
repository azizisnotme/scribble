import { useEffect, useMemo, useState } from 'react'
import { Keyboard, Type, Activity, Calendar, Download } from 'lucide-react'

import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { py } from '@/lib/ipc'
import { cn } from '@/lib/utils'

interface DayBucket {
  date: string
  chars: number
  words: number
  sessions: number
}

interface UsageSummary {
  lifetime_chars: number
  lifetime_words: number
  lifetime_sessions: number
  today_chars: number
  today_words: number
  today_sessions: number
  first_seen: string | null
  last_typed: string | null
  recent_days: DayBucket[]
  recent_sessions: Array<{ ts: string; chars: number; words: number; source: string }>
}

const numberFormat = new Intl.NumberFormat('en-US')

function fmt(n: number | undefined | null): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '0'
  return numberFormat.format(n)
}

function formatRelative(iso: string | null): string {
  if (!iso) return 'never'
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return 'never'
  const sec = (Date.now() - then) / 1000
  if (sec < 60) return 'just now'
  if (sec < 3600) return `${Math.round(sec / 60)} min ago`
  if (sec < 86400) return `${Math.round(sec / 3600)} hr ago`
  return `${Math.round(sec / 86400)} days ago`
}

export function Analytics() {
  const [data, setData] = useState<UsageSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    py<UsageSummary>('analytics.stats', { days: 14 })
      .then((d) => {
        if (alive) {
          setData(d)
          setError(null)
        }
      })
      .catch((e) => {
        if (alive) setError(String(e?.message ?? e))
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  const peakDay = useMemo(() => {
    if (!data?.recent_days?.length) return 0
    return Math.max(1, ...data.recent_days.map((d) => d.words))
  }, [data])

  const exportStats = (format: 'json' | 'csv') => {
    if (!data) return
    const content =
      format === 'json'
        ? JSON.stringify(data, null, 2)
        : ['timestamp,source,words,characters', ...data.recent_sessions.map((item) => `${item.ts},${item.source},${item.words},${item.chars}`)].join('\n')
    const blob = new Blob([content], { type: format === 'json' ? 'application/json' : 'text/csv' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `scribble-analytics.${format}`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-5 px-6 pb-6 xl:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
      <Card className="flex h-full min-h-0 flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 pb-4 pt-5">
          <div>
            <h2 className="text-[14px] font-semibold tracking-tight text-foreground">
              Analytics
            </h2>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              How much Scribble has typed for you
            </p>
          </div>
          {data?.last_typed && (
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <span>last typed {formatRelative(data.last_typed)}</span>
              <Button type="button" size="sm" variant="ghost" className="h-8" onClick={() => exportStats('json')}>
                <Download />
                JSON
              </Button>
              <Button type="button" size="sm" variant="ghost" className="h-8" onClick={() => exportStats('csv')}>
                CSV
              </Button>
            </div>
          )}
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-hidden px-6 pb-6">
          <HeroWords loading={loading} value={data?.lifetime_words ?? 0} />

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatTile
              Icon={Type}
              label="Characters"
              value={fmt(data?.lifetime_chars)}
              hint="lifetime"
            />
            <StatTile
              Icon={Activity}
              label="Sessions"
              value={fmt(data?.lifetime_sessions)}
              hint="lifetime"
            />
            <StatTile
              Icon={Calendar}
              label="Today"
              value={`${fmt(data?.today_words)} words`}
              hint={`${fmt(data?.today_sessions)} sessions`}
            />
          </div>

          <Card className="flex min-h-0 flex-1 flex-col overflow-hidden bg-secondary/25 p-5">
            <div className="flex items-center justify-between">
              <div className="text-[13px] font-semibold text-foreground">Last 14 days</div>
              <div className="text-[11px] text-muted-foreground">words per day</div>
            </div>

            {error ? (
              <div className="mt-6 text-[12px] text-destructive">
                Couldn't load stats: {error}
              </div>
            ) : (
              <ChartBars days={data?.recent_days ?? []} peak={peakDay} />
            )}
          </Card>
        </div>
      </Card>

      <SidePanel data={data} className="min-h-[280px] xl:min-h-0" />
    </div>
  )
}

function HeroWords({ value, loading }: { value: number; loading: boolean }) {
  return (
    <Card className="flex flex-col gap-2 bg-gradient-to-br from-primary/15 via-primary/5 to-transparent p-6">
      <div className="flex items-center gap-2 text-[12px] font-medium uppercase tracking-wider text-primary/90">
        <Keyboard className="h-3.5 w-3.5" strokeWidth={2.2} />
        Words Scribble has typed for you
      </div>
      <div className="font-mono text-[clamp(40px,6vw,56px)] font-semibold tracking-tight text-foreground tabular-nums">
        {loading ? '\u2014' : fmt(value)}
      </div>
      <div className="text-[12px] text-muted-foreground">
        Counted automatically every time the typing engine ships text. Updates
        live as you use the app.
      </div>
    </Card>
  )
}

function StatTile({
  Icon,
  label,
  value,
  hint,
}: {
  Icon: typeof Keyboard
  label: string
  value: string
  hint: string
}) {
  return (
    <Card className="flex flex-col gap-1.5 p-4">
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3 w-3" strokeWidth={2} />
        {label}
      </div>
      <div className="text-[20px] font-semibold tabular-nums text-foreground">{value}</div>
      <div className="text-[11px] text-muted-foreground">{hint}</div>
    </Card>
  )
}

function ChartBars({ days, peak }: { days: DayBucket[]; peak: number }) {
  if (!days.length) {
    return (
      <div className="mt-6 grid h-[140px] place-items-center text-[12px] text-muted-foreground">
        No typing recorded yet. Run a session and the chart will fill in.
      </div>
    )
  }
  return (
    <div className="mt-5 flex h-[160px] items-end gap-1.5">
      {days.map((d) => {
        const ratio = peak > 0 ? d.words / peak : 0
        const height = `${Math.max(4, Math.round(ratio * 100))}%`
        return (
          <div
            key={d.date}
            className="group relative flex h-full flex-1 flex-col items-center justify-end"
            title={`${d.date} — ${fmt(d.words)} words`}
          >
            <div
              className="w-full rounded-t-sm bg-primary/80 transition-all group-hover:bg-primary"
              style={{ height }}
            />
            <div className="mt-1.5 hidden text-[9px] tabular-nums text-muted-foreground group-hover:block">
              {d.date.slice(5)}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function SidePanel({ data, className }: { data: UsageSummary | null; className?: string }) {
  return (
    <Card className={cn('flex h-full flex-col overflow-hidden', className)}>
      <div className="border-b border-border/60 px-5 py-4">
        <h2 className="text-[14px] font-semibold tracking-tight text-foreground">
          Account totals
        </h2>
        <p className="mt-0.5 text-[12px] text-muted-foreground">
          Since you first ran Scribble
        </p>
      </div>

      <div className="flex flex-col gap-3 px-5 py-5 text-[13px]">
        <Row label="First seen" value={data?.first_seen ? new Date(data.first_seen).toLocaleDateString() : '—'} />
        <Row label="Total words" value={fmt(data?.lifetime_words)} />
        <Row label="Total characters" value={fmt(data?.lifetime_chars)} />
        <Row label="Total sessions" value={fmt(data?.lifetime_sessions)} />
        <Row label="Today's words" value={fmt(data?.today_words)} />
        <Row label="Last typed" value={formatRelative(data?.last_typed ?? null)} />
      </div>

      {!!data?.recent_sessions.length && (
        <div className="border-t border-border/60 px-5 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Recent sessions</p>
          <div className="mt-3 space-y-2">
            {data.recent_sessions.slice(0, 5).map((session) => (
              <div key={`${session.ts}-${session.source}`} className="flex items-center justify-between text-[11px]">
                <span className="truncate text-muted-foreground">{session.source.replaceAll('-', ' ')}</span>
                <span className="font-mono text-foreground">{fmt(session.words)} words</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-auto border-t border-border/60 px-5 py-4 text-[11px] text-muted-foreground">
        Stats stay in Scribble's local WebView data and update after each completed typing session.
      </div>
    </Card>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border/40 pb-2 last:border-b-0 last:pb-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums text-foreground">{value}</span>
    </div>
  )
}
