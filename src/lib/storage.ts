export const STORAGE_ERROR_EVENT = 'scribble:storage-error'
const SCHEMA_KEY = 'scribble_storage_schema'
const CURRENT_SCHEMA = 1

export interface ScribbleBackup {
  app: 'scribble'
  version: 1
  exportedAt: string
  values: Record<string, string>
}

function reportStorageError(message: string): void {
  window.dispatchEvent(new CustomEvent(STORAGE_ERROR_EVENT, { detail: message }))
}

export function initializeStorage(): void {
  try {
    const version = Number(localStorage.getItem(SCHEMA_KEY) ?? '0')
    if (version < CURRENT_SCHEMA) {
      // Version 1 adopts existing scribble_* keys in place, so no destructive copy is needed.
      localStorage.setItem(SCHEMA_KEY, String(CURRENT_SCHEMA))
    }
  } catch {
    reportStorageError('Scribble could not initialize local storage.')
  }
}

export function storageGetString(key: string, fallback = ''): string {
  try {
    return localStorage.getItem(key) ?? fallback
  } catch {
    reportStorageError(`Could not read ${key}.`)
    return fallback
  }
}

export function storageSetString(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value)
    return true
  } catch {
    reportStorageError('Local storage is full or unavailable. Export a backup before clearing data.')
    return false
  }
}

export function storageRemove(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    reportStorageError(`Could not remove ${key}.`)
  }
}

export function storageGetJson<T>(key: string, fallback: T): T {
  const raw = storageGetString(key)
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    storageSetString(`${key}_corrupt_${Date.now()}`, raw)
    storageRemove(key)
    reportStorageError(`Recovered from damaged local data in ${key}.`)
    return fallback
  }
}

export function storageSetJson<T>(key: string, value: T): boolean {
  return storageSetString(key, JSON.stringify(value))
}

export function createBackup(): ScribbleBackup {
  const values: Record<string, string> = {}
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index)
    if (!key?.startsWith('scribble_')) continue
    const value = localStorage.getItem(key)
    if (value !== null) values[key] = value
  }
  return { app: 'scribble', version: 1, exportedAt: new Date().toISOString(), values }
}

export function restoreBackup(input: unknown): number {
  if (!input || typeof input !== 'object') throw new Error('Backup is not a JSON object.')
  const backup = input as Partial<ScribbleBackup>
  if (backup.app !== 'scribble' || backup.version !== 1 || !backup.values || typeof backup.values !== 'object') {
    throw new Error('This is not a supported Scribble backup.')
  }
  const entries = Object.entries(backup.values).filter(
    ([key, value]) => key.startsWith('scribble_') && typeof value === 'string',
  )
  for (const [key, value] of entries) {
    if (!storageSetString(key, value)) throw new Error('Not enough local storage to restore this backup.')
  }
  return entries.length
}

