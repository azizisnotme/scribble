/** Daily Scribble AI uses per account. The owner and anyone they pick are unlimited. */
import { useSyncExternalStore } from 'react'

import { supabase } from '@/lib/supabase'

export interface AiQuota {
  unlimited: boolean
  owner: boolean
  limit: number | null
  used: number
  remaining: number | null
  resetsAt: string | null
}

export interface AiUseResult {
  allowed: boolean
  quota: AiQuota | null
  message: string
}

let quota: AiQuota | null = null
const listeners = new Set<() => void>()

function publish(next: AiQuota | null) {
  quota = next
  listeners.forEach((listener) => listener())
}

function fromRow(row: Record<string, unknown> | null | undefined): AiQuota | null {
  if (!row) return null
  const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null)
  return {
    unlimited: row.unlimited === true,
    owner: row.owner === true,
    limit: num(row.limit),
    used: num(row.used) ?? 0,
    remaining: num(row.remaining),
    resetsAt: typeof row.resets_at === 'string' ? row.resets_at : null,
  }
}

export function resetTimeLabel(value: string | null): string {
  if (!value) return 'tomorrow'
  const when = new Date(value)
  if (Number.isNaN(when.getTime())) return 'tomorrow'
  return when.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })
}

export function outOfUsesMessage(current: AiQuota | null): string {
  const limit = current?.limit ?? 0
  if (limit <= 0) return 'Scribble AI is turned off for this account. Ask the app owner for access.'
  return `You've used all ${limit} Scribble AI uses for today. They come back ${resetTimeLabel(current?.resetsAt ?? null)}.`
}

export async function refreshAiQuota(): Promise<AiQuota | null> {
  if (!supabase) return null
  const { data, error } = await supabase.rpc('ai_quota')
  if (error) return quota
  publish(fromRow(data as Record<string, unknown>))
  return quota
}

/** Spend one use before Scribble AI answers. Unlimited accounts are never counted down. */
export async function spendAiUse(): Promise<AiUseResult> {
  if (!supabase) return { allowed: true, quota: null, message: '' }
  const { data, error } = await supabase.rpc('consume_ai_use')
  if (error) {
    if (quota?.unlimited) return { allowed: true, quota, message: '' }
    if (quota && (quota.remaining ?? 0) > 0) {
      publish({ ...quota, used: quota.used + 1, remaining: (quota.remaining ?? 1) - 1 })
      return { allowed: true, quota, message: '' }
    }
    return {
      allowed: false,
      quota,
      message: 'Scribble AI could not check your daily uses. Check your internet connection and try again.',
    }
  }
  const row = data as Record<string, unknown>
  publish(fromRow(row))
  const allowed = row?.allowed === true
  return { allowed, quota, message: allowed ? '' : outOfUsesMessage(quota) }
}

export function useAiQuota(): AiQuota | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => quota,
    () => quota,
  )
}
