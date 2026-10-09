import { useEffect, useMemo, useState } from 'react'
import { Infinity as InfinityIcon, Search } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

export interface AiAccessUser {
  id: string
  email: string
  display_name: string | null
  ai_unlimited?: boolean
  ai_daily_limit?: number | null
}

interface AdminAiAccessProps {
  users: AiAccessUser[]
  ownerEmail: string
  isOwner: boolean
  defaultLimit: number
  usedToday: Record<string, number>
  busyId: string | null
  disabled: boolean
  onSaveDefault: (limit: number) => void
  onSaveUser: (id: string, unlimited: boolean, dailyLimit: number | null) => void
  onResetUser: (id: string) => void
}

function parseLimit(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number.parseInt(trimmed, 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

export function AdminAiAccess({
  users,
  ownerEmail,
  isOwner,
  defaultLimit,
  usedToday,
  busyId,
  disabled,
  onSaveDefault,
  onSaveUser,
  onResetUser,
}: AdminAiAccessProps) {
  const [defaultDraft, setDefaultDraft] = useState(String(defaultLimit))
  const [limits, setLimits] = useState<Record<string, string>>({})
  const [unlimited, setUnlimited] = useState<Record<string, boolean>>({})
  const [search, setSearch] = useState('')
  const locked = disabled || !isOwner

  useEffect(() => setDefaultDraft(String(defaultLimit)), [defaultLimit])
  useEffect(() => {
    setLimits(Object.fromEntries(users.map((user) => [user.id, user.ai_daily_limit == null ? '' : String(user.ai_daily_limit)])))
    setUnlimited(Object.fromEntries(users.map((user) => [user.id, Boolean(user.ai_unlimited)])))
  }, [users])

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase()
    return users
      .filter((user) => !query || user.email.toLowerCase().includes(query) || user.display_name?.toLowerCase().includes(query))
      .sort((a, b) => Number(b.email === ownerEmail) - Number(a.email === ownerEmail) || Number(Boolean(b.ai_unlimited)) - Number(Boolean(a.ai_unlimited)))
  }, [ownerEmail, search, users])

  const unlimitedCount = users.filter((user) => user.ai_unlimited || user.email === ownerEmail).length

  return (
    <Card className="overflow-hidden border-border/60">
      <div className="space-y-3 border-b border-border/50 p-5">
        <div>
          <h3 className="text-[15px] font-semibold">Scribble AI access</h3>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Each chat message or Write run uses one. Your owner account is always unlimited. Turn on Unlimited for anyone else you pick.
            Uses come back every day at midnight UTC.
          </p>
          {!isOwner && <p className="mt-2 text-[13px] text-primary">Only the owner can change these settings.</p>}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="space-y-1">
            <span className="block text-[12px] font-semibold text-muted-foreground">Daily uses for everyone else</span>
            <input
              type="number"
              min={0}
              value={defaultDraft}
              onChange={(event) => setDefaultDraft(event.target.value)}
              className="desk-field w-32"
              disabled={locked}
            />
          </label>
          <Button
            type="button"
            className="rounded-xl"
            disabled={locked || busyId === 'ai-default' || parseLimit(defaultDraft) === null}
            onClick={() => onSaveDefault(parseLimit(defaultDraft) ?? 0)}
          >
            Save default
          </Button>
          <p className="pb-2 text-[12px] text-muted-foreground">0 turns Scribble AI off for people without their own limit. {unlimitedCount} unlimited.</p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 border-b border-border/50 px-5 py-3">
        <label className="desk-field flex w-auto shrink-0 items-center gap-2">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search people" className="w-44 bg-transparent text-[13px] outline-none" />
        </label>
      </div>

      {visible.length === 0 ? (
        <p className="p-8 text-center text-[13px] text-muted-foreground">No accounts match.</p>
      ) : (
        <div className="divide-y divide-border/40">
          {visible.map((user) => {
            const owner = user.email === ownerEmail
            const isUnlimited = owner || unlimited[user.id]
            const used = usedToday[user.id] ?? 0
            const ownLimit = parseLimit(limits[user.id] ?? '')
            const effective = ownLimit ?? defaultLimit
            const busy = busyId === `ai-${user.id}`
            return (
              <div key={user.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 truncate text-[14px] font-semibold">
                    {user.display_name || user.email}
                    {owner && <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-primary">Owner</span>}
                    {isUnlimited && <InfinityIcon className="h-4 w-4 text-primary" aria-label="Unlimited" />}
                  </p>
                  <p className="truncate text-[12px] text-muted-foreground">
                    {user.email} · {isUnlimited ? `${used} used today · unlimited` : `${used} of ${effective} used today`}
                  </p>
                </div>
                {owner ? (
                  <p className="text-[12px] text-muted-foreground">Always unlimited</p>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-2 text-[13px]">
                      <input
                        type="checkbox"
                        checked={Boolean(unlimited[user.id])}
                        disabled={locked}
                        onChange={(event) => setUnlimited((current) => ({ ...current, [user.id]: event.target.checked }))}
                      />
                      Unlimited
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={limits[user.id] ?? ''}
                      placeholder={`Default (${defaultLimit})`}
                      disabled={locked || Boolean(unlimited[user.id])}
                      onChange={(event) => setLimits((current) => ({ ...current, [user.id]: event.target.value }))}
                      className="desk-field w-32"
                      aria-label="Daily uses for this person"
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="rounded-xl"
                      disabled={locked || busy}
                      onClick={() => onSaveUser(user.id, Boolean(unlimited[user.id]), ownLimit)}
                    >
                      Save
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="rounded-xl"
                      disabled={locked || busy || used === 0}
                      onClick={() => onResetUser(user.id)}
                    >
                      Reset today
                    </Button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}
