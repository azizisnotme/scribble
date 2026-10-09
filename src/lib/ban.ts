import { invoke } from '@tauri-apps/api/core'

import { inTauri } from '@/lib/ipc'
import { supabase } from '@/lib/supabase'

const CACHE_KEY = 'scribble_ban_cache'
const LOCAL_DEVICE_KEY = 'scribble_device_id'

export interface AppLock {
  banned: boolean
  reason: string
}

let devicePromise: Promise<string> | null = null

async function deviceId(): Promise<string> {
  if (devicePromise) return devicePromise
  devicePromise = readDeviceId()
  return devicePromise
}

async function readDeviceId(): Promise<string> {
  if (inTauri) {
    try {
      const id = await invoke<string>('machine_id')
      if (id && id !== 'unknown-pc') return id
    } catch {
      // Fall through to a local id if the machine id cannot be read.
    }
  }
  try {
    const existing = localStorage.getItem(LOCAL_DEVICE_KEY)
    if (existing) return existing
    const created = crypto.randomUUID()
    localStorage.setItem(LOCAL_DEVICE_KEY, created)
    return created
  } catch {
    return 'browser'
  }
}

function cachedLock(): AppLock | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as AppLock
    return parsed.banned ? parsed : null
  } catch {
    return null
  }
}

function remember(lock: AppLock) {
  try {
    if (lock.banned) localStorage.setItem(CACHE_KEY, JSON.stringify(lock))
    else localStorage.removeItem(CACHE_KEY)
  } catch {
    // The live check still applies for this session.
  }
}

export async function checkAppLock(): Promise<AppLock> {
  const client = supabase
  const device = await deviceId()
  if (!client) return cachedLock() ?? { banned: false, reason: '' }
  const { data, error } = await client.rpc('app_lock', { device_id: device })
  if (error || !data) return cachedLock() ?? { banned: false, reason: '' }
  const row = data as { banned?: boolean; reason?: string | null }
  const lock = {
    banned: row.banned === true,
    reason: row.reason?.trim() || 'This copy of Scribble is banned.',
  }
  remember(lock)
  if (lock.banned) {
    window.dispatchEvent(new CustomEvent('scribble:pc-locked', { detail: lock }))
  }
  return lock
}

export function cachedBan(): AppLock | null {
  return cachedLock()
}

export async function registerDevice(): Promise<void> {
  const client = supabase
  if (!client) return
  const device = await deviceId()
  await client.rpc('register_device', { device_id: device })
}
