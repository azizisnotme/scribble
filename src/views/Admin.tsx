import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertCircle, Download, LoaderCircle, RefreshCw, Search, ShieldCheck, UserRound } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { AdminAiAccess } from '@/components/AdminAiAccess'
import { AdminPolicy } from '@/components/AdminPolicy'
import { refreshAiQuota } from '@/lib/ai-quota'
import { NOTICE_CHANGED_EVENT } from '@/components/NoticeBanner'
import { supabase } from '@/lib/supabase'

const OWNER_EMAIL = 'az.i.zisnotme@gmail.com'

interface AdminUser {
  id: string
  email: string
  display_name: string | null
  created_at: string
  last_sign_in_at: string | null
  status: 'active' | 'suspended' | 'banned'
  status_reason: string | null
  banned_until: string | null
  note: string | null
  ai_unlimited?: boolean
  ai_daily_limit?: number | null
}

interface AuditEntry {
  id: number
  actor_email: string
  action: string
  target_email: string | null
  detail: string | null
  created_at: string
}

interface BlockedEmail {
  email: string
  reason: string | null
  created_at: string
}

interface AppControls {
  signups_open?: boolean
  maintenance_on?: boolean
  maintenance_message?: string
  ai_daily_limit?: number
}

interface AdminDesk {
  users: AdminUser[]
  admins: string[]
  announcement: { title?: string; body?: string; active?: boolean; tone?: string }
  controls?: AppControls
  blocked?: BlockedEmail[]
  audit: AuditEntry[]
  ai_used_today?: Record<string, number>
  is_owner?: boolean
}

type Filter = 'all' | 'active' | 'suspended' | 'recent'
type Sort = 'newest' | 'seen' | 'name'
type Panel = 'people' | 'notice' | 'controls' | 'ai' | 'blocks' | 'admins' | 'activity'

function messageFrom(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message) return message
  }
  return 'That admin action failed.'
}

function downloadUsers(users: AdminUser[]) {
  const lines = ['email,name,status,joined,last_sign_in,note']
  for (const user of users) {
    lines.push(
      [user.email, user.display_name ?? '', user.status, user.created_at, user.last_sign_in_at ?? '', user.note ?? '']
        .map((value) => `"${String(value).replaceAll('"', '""')}"`)
        .join(','),
    )
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'scribble-users.csv'
  anchor.click()
  URL.revokeObjectURL(url)
}

export function Admin() {
  const [desk, setDesk] = useState<AdminDesk | null>(null)
  const [needsSql, setNeedsSql] = useState(false)
  const [panel, setPanel] = useState<Panel>('people')
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<Sort>('newest')
  const [search, setSearch] = useState('')
  const [auditQuery, setAuditQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [noticeTitle, setNoticeTitle] = useState('')
  const [noticeBody, setNoticeBody] = useState('')
  const [noticeActive, setNoticeActive] = useState(false)
  const [noticeTone, setNoticeTone] = useState<'info' | 'warning'>('info')
  const [blockEmail, setBlockEmail] = useState('')
  const [blockReason, setBlockReason] = useState('')
  const [names, setNames] = useState<Record<string, string>>({})
  const [adminEmail, setAdminEmail] = useState('')
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [banHours, setBanHours] = useState<Record<string, string>>({})

  const loadDesk = useCallback(async () => {
    if (!supabase) return
    setLoading(true)
    setError(null)
    try {
      const { data, error: deskError } = await supabase.rpc('admin_desk')
      if (deskError) {
        if (
          deskError.code === 'PGRST202' ||
          /could not find the function/i.test(deskError.message) ||
          /schema cache/i.test(deskError.message)
        ) {
          setNeedsSql(true)
          setDesk(null)
          return
        }
        throw deskError
      }
      const next = data as AdminDesk
      setNeedsSql(false)
      setDesk(next)
      setNoticeTitle(next.announcement?.title ?? '')
      setNoticeBody(next.announcement?.body ?? '')
      setNoticeActive(Boolean(next.announcement?.active))
      setNoticeTone(next.announcement?.tone === 'warning' ? 'warning' : 'info')
      setNotes(Object.fromEntries(next.users.map((user) => [user.id, user.note ?? ''])))
      setNames(Object.fromEntries(next.users.map((user) => [user.id, user.display_name ?? ''])))
    } catch (loadError) {
      setError(messageFrom(loadError))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    queueMicrotask(() => void loadDesk())
  }, [loadDesk])

  const run = useCallback(
    async (id: string, action: () => PromiseLike<unknown>) => {
      setBusyId(id)
      setError(null)
      try {
        const { error: actionError } = (await action()) as { error: { message: string } | null }
        if (actionError) throw actionError
        if (id === 'notice' || id === 'controls' || id === 'policy') window.dispatchEvent(new Event(NOTICE_CHANGED_EVENT))
        if (id.startsWith('ai-')) void refreshAiQuota()
        await loadDesk()
      } catch (actionError) {
        setError(messageFrom(actionError))
      } finally {
        setBusyId(null)
      }
    },
    [loadDesk],
  )

  const visibleUsers = useMemo(() => {
    const query = search.trim().toLowerCase()
    return (desk?.users ?? []).filter((user) => {
      const matchesFilter =
        filter === 'all' ||
        (filter === 'active' && user.status === 'active') ||
        (filter === 'suspended' && user.status === 'suspended') ||
        (filter === 'recent' &&
          user.last_sign_in_at &&
          Date.now() - new Date(user.last_sign_in_at).getTime() < 7 * 86_400_000)
      const matchesQuery = !query || user.email.toLowerCase().includes(query) || user.display_name?.toLowerCase().includes(query)
      return matchesFilter && matchesQuery
    }).sort((a, b) => {
      if (sort === 'name') return (a.display_name || a.email).localeCompare(b.display_name || b.email)
      if (sort === 'seen') return new Date(b.last_sign_in_at ?? 0).getTime() - new Date(a.last_sign_in_at ?? 0).getTime()
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    })
  }, [desk, filter, search, sort])

  const joinedToday = desk?.users.filter((user) => Date.now() - new Date(user.created_at).getTime() < 86_400_000).length ?? 0
  const neverReturned = desk?.users.filter((user) => !user.last_sign_in_at).length ?? 0
  const visibleAudit = (desk?.audit ?? []).filter((entry) => {
    const query = auditQuery.trim().toLowerCase()
    if (!query) return true
    return [entry.action, entry.actor_email, entry.target_email, entry.detail].some((value) => value?.toLowerCase().includes(query))
  })

  const suspendedCount = desk?.users.filter((user) => user.status === 'suspended').length ?? 0
  const recentCount =
    desk?.users.filter(
      (user) => user.last_sign_in_at && Date.now() - new Date(user.last_sign_in_at).getTime() < 7 * 86_400_000,
    ).length ?? 0

  return (
    <div className="h-full min-h-0 overflow-auto px-6 pb-6">
      <div className="mx-auto flex max-w-5xl flex-col gap-5 py-2">
        <Card className="flex flex-wrap items-center justify-between gap-4 border-border/60 p-5">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/12 text-primary">
              <ShieldCheck className="h-5 w-5" />
            </span>
            <div>
              <p className="eyebrow">Owner desk</p>
              <h2 className="font-display mt-1 text-[24px] tracking-tight text-foreground">Administration</h2>
            </div>
          </div>
          <Button type="button" variant="outline" className="rounded-xl" disabled={loading} onClick={() => void loadDesk()}>
            <RefreshCw className={loading ? 'animate-spin' : ''} />
            Refresh
          </Button>
        </Card>

        {needsSql && (
          <Card className="border-primary/30 bg-primary/5 p-5 text-[13px] leading-relaxed text-muted-foreground">
            Open the Supabase SQL editor and run <span className="font-mono text-foreground">supabase/migrations/002_admin_controls.sql</span> once.
            The people, notice, admin, and activity controls turn on after that.
          </Card>
        )}

        {error && (
          <Card className="flex items-start gap-3 border-destructive/40 bg-destructive/5 p-4">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
            <p className="break-words text-[13px] text-muted-foreground">{error}</p>
          </Card>
        )}

        <Card className="grid grid-cols-2 gap-px overflow-hidden border-border/50 bg-border/40 p-px sm:grid-cols-3 lg:grid-cols-6">
          {[
            ['Users', desk?.users.length ?? 0],
            ['Today', joinedToday],
            ['This week', recentCount],
            ['Never back', neverReturned],
            ['Suspended', suspendedCount],
            ['Blocked', desk?.blocked?.length ?? 0],
          ].map(([label, value]) => (
            <div key={String(label)} className="bg-card px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
              <p className="mt-1 font-display text-[28px] leading-none text-foreground">{value}</p>
            </div>
          ))}
        </Card>

        <div className="flex flex-wrap gap-1 rounded-2xl border border-border/50 bg-card/70 p-1">
          {(
            [
              ['people', 'People'],
              ['notice', 'Notice'],
              ['controls', 'Policy'],
              ['ai', 'AI access'],
              ['blocks', 'Blocks'],
              ['admins', 'Admins'],
              ['activity', 'Activity'],
            ] as const
          ).map(([id, label]) => (
            <Button key={id} type="button" size="sm" variant={panel === id ? 'default' : 'ghost'} className="rounded-xl" onClick={() => setPanel(id)}>
              {label}
            </Button>
          ))}
        </div>

        {loading && !desk ? (
          <Card className="flex items-center justify-center gap-2 p-10 text-[13px] text-muted-foreground">
            <LoaderCircle className="h-5 w-5 animate-spin" />
            Loading the desk…
          </Card>
        ) : panel === 'people' ? (
          <Card className="overflow-hidden border-border/60">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 p-4">
              <div className="flex flex-wrap gap-2">
                {(['all', 'active', 'suspended', 'recent'] as const).map((item) => (
                  <Button key={item} type="button" size="sm" variant={filter === item ? 'default' : 'ghost'} className="rounded-full capitalize" onClick={() => setFilter(item)}>
                    {item}
                  </Button>
                ))}
              </div>
              <div className="flex gap-2">
                <label className="desk-field flex w-auto shrink-0 items-center gap-2">
                  <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search" className="w-36 bg-transparent text-[13px] outline-none" />
                </label>
                <select value={sort} onChange={(event) => setSort(event.target.value as Sort)} className="desk-field w-auto">
                  <option value="newest">Newest</option>
                  <option value="seen">Last seen</option>
                  <option value="name">Name</option>
                </select>
                <Button type="button" size="sm" variant="outline" className="rounded-xl" disabled={needsSql || busyId === 'signout-all'} onClick={() => { if (window.confirm('Sign everyone else out of Scribble?')) void run('signout-all', () => supabase!.rpc('admin_sign_out_others')) }}>
                  Sign out others
                </Button>
                <Button type="button" size="sm" variant="outline" className="rounded-xl" disabled={needsSql || busyId === 'restore-all'} onClick={() => void run('restore-all', () => supabase!.rpc('admin_restore_all'))}>
                  Restore all
                </Button>
                <Button type="button" size="sm" variant="outline" className="rounded-xl" onClick={() => downloadUsers(visibleUsers)}>
                  <Download />
                  Export
                </Button>
              </div>
            </div>
            {visibleUsers.length === 0 ? (
              <p className="p-8 text-center text-[13px] text-muted-foreground">No accounts match this view.</p>
            ) : (
              <div className="divide-y divide-border/40">
                {visibleUsers.map((user) => (
                  <div key={user.id} className="space-y-4 p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-[15px] font-semibold">{user.display_name || user.email}</p>
                          <span className={user.status === 'active' ? 'rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-500' : 'rounded-full bg-destructive/15 px-2 py-0.5 text-[11px] text-destructive'}>
                            {user.status === 'banned'
                              ? user.banned_until
                                ? `Temp ban until ${new Date(user.banned_until).toLocaleString()}`
                                : 'Banned'
                              : user.status === 'suspended'
                                ? 'Suspended'
                                : 'Active'}
                          </span>
                          {user.email === OWNER_EMAIL ? (
                            <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-primary">Owner</span>
                          ) : (
                            desk?.admins.includes(user.email) && <span className="rounded-full bg-primary/12 px-2 py-0.5 text-[11px] text-primary">Admin</span>
                          )}
                        </div>
                        <p className="mt-1 truncate text-[13px] text-muted-foreground">{user.email}</p>
                        <p className="mt-1 text-[12px] text-muted-foreground">
                          Joined {new Date(user.created_at).toLocaleDateString()}
                          {user.last_sign_in_at ? ` · last seen ${new Date(user.last_sign_in_at).toLocaleString()}` : ' · has not come back'}
                        </p>
                        {user.status_reason && <p className="mt-1 text-[12px] text-muted-foreground">Reason: {user.status_reason}</p>}
                      </div>
                    </div>
                    <div className="grid gap-2 md:grid-cols-3">
                      <input
                        value={names[user.id] ?? ''}
                        onChange={(event) => setNames((current) => ({ ...current, [user.id]: event.target.value }))}
                        placeholder="Display name"
                        className="desk-field"
                      />
                      <input
                        value={notes[user.id] ?? ''}
                        onChange={(event) => setNotes((current) => ({ ...current, [user.id]: event.target.value }))}
                        placeholder="Private note"
                        className="desk-field"
                      />
                      <input
                        value={reasons[user.id] ?? ''}
                        onChange={(event) => setReasons((current) => ({ ...current, [user.id]: event.target.value }))}
                        placeholder="Ban reason"
                        className="desk-field"
                      />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" size="sm" variant="secondary" className="rounded-xl" disabled={busyId === user.id || needsSql} onClick={() => void run(user.id, () => supabase!.rpc('admin_rename', { target_id: user.id, next_name: names[user.id] ?? '' }))}>
                        Save name
                      </Button>
                      <Button type="button" size="sm" variant="secondary" className="rounded-xl" disabled={busyId === user.id || needsSql} onClick={() => void run(user.id, () => supabase!.rpc('admin_set_note', { target_id: user.id, next_note: notes[user.id] ?? '' }))}>
                        Save note
                      </Button>
                      <Button type="button" size="sm" variant="outline" className="rounded-xl" disabled={busyId === user.id || needsSql || user.email === OWNER_EMAIL} onClick={() => void run(user.id, () => supabase!.rpc('admin_sign_out', { target_id: user.id }))}>
                        Sign out
                      </Button>
                      {user.status === 'banned' ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          className="rounded-xl"
                          disabled={busyId === user.id || needsSql || user.email === OWNER_EMAIL}
                          onClick={() => void run(user.id, () => supabase!.rpc('admin_unban', { target_id: user.id }))}
                        >
                          Unban
                        </Button>
                      ) : (
                        <>
                          <input
                            type="number"
                            min={1}
                            value={banHours[user.id] ?? '24'}
                            onChange={(event) => setBanHours((current) => ({ ...current, [user.id]: event.target.value }))}
                            className="desk-field w-24"
                            aria-label="Temporary ban hours"
                          />
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="rounded-xl"
                            disabled={busyId === user.id || needsSql || user.email === OWNER_EMAIL}
                            onClick={() => {
                              const hours = Math.max(1, Number.parseInt(banHours[user.id] ?? '24', 10) || 24)
                              void run(user.id, () =>
                                supabase!.rpc('admin_temp_ban', {
                                  target_id: user.id,
                                  reason: reasons[user.id] ?? '',
                                  hours,
                                }),
                              )
                            }}
                          >
                            Temporary ban
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="rounded-xl"
                            disabled={busyId === user.id || needsSql || user.email === OWNER_EMAIL}
                            onClick={() => {
                              if (window.confirm(`Permanently ban ${user.email}? Scribble closes on their account and on every computer they use until you unban them.`)) {
                                void run(user.id, () => supabase!.rpc('admin_ban', { target_id: user.id, reason: reasons[user.id] ?? '' }))
                              }
                            }}
                          >
                            Ban
                          </Button>
                        </>
                      )}
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="rounded-xl text-destructive"
                        disabled={busyId === user.id || needsSql || user.email === OWNER_EMAIL}
                        onClick={() => {
                          if (window.confirm(`Remove ${user.email} from Scribble?`)) {
                            void run(user.id, () => supabase!.rpc('admin_remove_user', { target_id: user.id }))
                          }
                        }}
                      >
                        Remove account
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        ) : panel === 'notice' ? (
          <Card className="space-y-3 border-border/60 p-5">
            <h3 className="text-[15px] font-semibold">App notice</h3>
            <p className="text-[13px] text-muted-foreground">
              Check “Show this notice”, then save. A bar appears under the title at the top of Scribble for everyone, including you.
            </p>
            <input value={noticeTitle} onChange={(event) => setNoticeTitle(event.target.value)} placeholder="Title" className="desk-field" />
            <textarea value={noticeBody} onChange={(event) => setNoticeBody(event.target.value)} placeholder="Message" className="desk-field min-h-28" />
            <label className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={noticeActive} onChange={(event) => setNoticeActive(event.target.checked)} />
              Show this notice
            </label>
            <label className="flex items-center gap-2 text-[13px]">
              Tone
              <select value={noticeTone} onChange={(event) => setNoticeTone(event.target.value as 'info' | 'warning')} className="desk-field w-auto">
                <option value="info">Info</option>
                <option value="warning">Warning</option>
              </select>
            </label>
            <Button type="button" className="rounded-xl" disabled={needsSql || busyId === 'notice'} onClick={() => void run('notice', () => supabase!.rpc('admin_save_notice', { next_title: noticeTitle, next_body: noticeBody, is_active: noticeActive, next_tone: noticeTone }))}>
              Save notice
            </Button>
          </Card>
        ) : panel === 'controls' ? (
          <AdminPolicy
            controls={desk?.controls as Record<string, unknown> | undefined}
            disabled={needsSql}
            busy={busyId === 'policy'}
            onSave={(payload) => void run('policy', () => supabase!.rpc('admin_save_policy', { payload }))}
          />
        ) : panel === 'ai' ? (
          <AdminAiAccess
            users={desk?.users ?? []}
            ownerEmail={OWNER_EMAIL}
            isOwner={desk?.is_owner === true}
            defaultLimit={desk?.controls?.ai_daily_limit ?? 25}
            usedToday={desk?.ai_used_today ?? {}}
            busyId={busyId}
            disabled={needsSql}
            onSaveDefault={(limit) => void run('ai-default', () => supabase!.rpc('admin_set_ai_default', { daily_limit: limit }))}
            onSaveUser={(id, unlimited, dailyLimit) =>
              void run(`ai-${id}`, () => supabase!.rpc('admin_set_ai_access', { target_id: id, unlimited, daily_limit: dailyLimit }))
            }
            onResetUser={(id) => void run(`ai-${id}`, () => supabase!.rpc('admin_reset_ai_usage', { target_id: id }))}
          />
        ) : panel === 'blocks' ? (
          <Card className="space-y-4 border-border/60 p-5">
            <h3 className="text-[15px] font-semibold">Blocked emails</h3>
            <p className="text-[13px] text-muted-foreground">A blocked address is signed out and cannot stay signed in. Your owner account cannot be blocked.</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input value={blockEmail} onChange={(event) => setBlockEmail(event.target.value)} placeholder="name@email.com" className="desk-field min-w-0 flex-1" />
              <input value={blockReason} onChange={(event) => setBlockReason(event.target.value)} placeholder="Reason" className="desk-field min-w-0 flex-1" />
              <Button type="button" className="rounded-xl" disabled={needsSql || busyId === 'block' || blockEmail.trim().toLowerCase() === OWNER_EMAIL} onClick={() => void run('block', () => supabase!.rpc('admin_block_email', { target_email: blockEmail, reason: blockReason }))}>
                Block
              </Button>
            </div>
            {(desk?.blocked ?? []).length === 0 ? (
              <p className="text-[13px] text-muted-foreground">No blocked emails.</p>
            ) : (
              <div className="divide-y divide-border/40 rounded-xl border border-border/60">
                {desk?.blocked?.map((entry) => (
                  <div key={entry.email} className="flex items-center justify-between gap-3 px-3 py-2">
                    <div>
                      <p className="text-[13px]">{entry.email}</p>
                      {entry.reason && <p className="text-[12px] text-muted-foreground">{entry.reason}</p>}
                    </div>
                    <Button type="button" size="sm" variant="ghost" disabled={needsSql || busyId === entry.email} onClick={() => void run(entry.email, () => supabase!.rpc('admin_unblock_email', { target_email: entry.email }))}>
                      Unblock
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </Card>
        ) : panel === 'admins' ? (
          <Card className="space-y-4 border-border/60 p-5">
            <h3 className="text-[15px] font-semibold">Admin allowlist</h3>
            <div className="flex gap-2">
              <input value={adminEmail} onChange={(event) => setAdminEmail(event.target.value)} placeholder="name@email.com" className="desk-field min-w-0 flex-1" />
              <Button type="button" className="rounded-xl" disabled={needsSql || busyId === 'grant'} onClick={() => void run('grant', () => supabase!.rpc('admin_grant', { target_email: adminEmail }))}>
                Grant
              </Button>
            </div>
            <div className="divide-y divide-border/40 rounded-xl border border-border/60">
              {(desk?.admins ?? []).map((email) => (
                <div key={email} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="flex items-center gap-2 text-[13px]">
                    <UserRound className="h-4 w-4 text-muted-foreground" />
                    {email}
                    {email === OWNER_EMAIL && <span className="text-[11px] text-primary">Owner</span>}
                  </span>
                  <Button type="button" size="sm" variant="ghost" className="text-destructive" disabled={needsSql || email === OWNER_EMAIL || busyId === email} onClick={() => void run(email, () => supabase!.rpc('admin_revoke', { target_email: email }))}>
                    Revoke
                  </Button>
                </div>
              ))}
            </div>
          </Card>
        ) : (
          <Card className="border-border/60 p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-[15px] font-semibold">Activity</h3>
              <div className="flex gap-2">
                <input value={auditQuery} onChange={(event) => setAuditQuery(event.target.value)} placeholder="Filter the log" className="desk-field w-44" />
                <Button type="button" size="sm" variant="outline" className="rounded-xl" disabled={needsSql || busyId === 'audit'} onClick={() => void run('audit', () => supabase!.rpc('admin_clear_audit'))}>
                  Clear log
                </Button>
              </div>
            </div>
            {visibleAudit.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">No admin actions yet.</p>
            ) : (
              <div className="divide-y divide-border/40">
                {visibleAudit.map((entry) => (
                  <div key={entry.id} className="py-3 text-[13px]">
                    <p className="font-medium text-foreground">
                      {entry.action}
                      {entry.target_email ? ` · ${entry.target_email}` : ''}
                    </p>
                    <p className="mt-1 text-[12px] text-muted-foreground">
                      {entry.actor_email} · {new Date(entry.created_at).toLocaleString()}
                      {entry.detail ? ` · ${entry.detail}` : ''}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}
      </div>
    </div>
  )
}
