/** Desktop actions Scribble AI tasks use: open apps, find windows, press keys. */
import { invoke } from '@tauri-apps/api/core'

import { inTauri } from '@/lib/ipc'

export interface DesktopWindow {
  title: string
  hwnd: number
}

export interface GpuMemory {
  name: string
  dedicated_mb: number
  shared_mb: number
}

export const KNOWN_APPS = [
  'notepad',
  'word',
  'excel',
  'powerpoint',
  'outlook',
  'onenote',
  'calculator',
  'paint',
  'file explorer',
  'settings',
  'chrome',
  'edge',
  'firefox',
  'task manager',
  'spotify',
  'teams',
  'microsoft store',
  'photos',
  'camera',
  'clock',
] as const

function requireDesktop() {
  if (!inTauri) throw new Error('This step only works in the Scribble desktop app.')
}

export async function launchApp(name: string): Promise<{ name: string; window_hint: string }> {
  requireDesktop()
  return invoke('launch_app', { name })
}

export async function foregroundWindow(): Promise<DesktopWindow | null> {
  if (!inTauri) return null
  return invoke('foreground_window')
}

export async function focusWindow(title: string): Promise<DesktopWindow> {
  requireDesktop()
  return invoke('focus_window', { title })
}

export async function focusHwnd(hwnd: number): Promise<boolean> {
  if (!inTauri) return false
  return invoke('focus_hwnd', { hwnd })
}

export async function pressKeys(keys: string, hwnd?: number): Promise<void> {
  requireDesktop()
  await invoke('press_keys', { keys, hwnd: hwnd ?? null })
}

export async function gpuMemory(): Promise<GpuMemory | null> {
  if (!inTauri) return null
  try {
    return await invoke<GpuMemory>('gpu_memory')
  } catch {
    return null
  }
}
