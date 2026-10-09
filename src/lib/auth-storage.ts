import { invoke } from '@tauri-apps/api/core'

const LOCAL_PREFIX = 'scribble.auth.'

export interface AuthStorageAdapter {
  getItem(key: string): string | Promise<string | null> | null
  setItem(key: string, value: string): void | Promise<void>
  removeItem(key: string): void | Promise<void>
}

export interface AuthStorageOptions {
  memory?: Map<string, string>
  localStore?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null
  persist?: (key: string, value: string) => Promise<void>
  restore?: (key: string) => Promise<string | null>
  forget?: (key: string) => Promise<void>
}

function readLocal(store: AuthStorageOptions['localStore'], key: string): string | null {
  if (!store) return null
  try {
    return store.getItem(LOCAL_PREFIX + key)
  } catch {
    return null
  }
}

function writeLocal(store: AuthStorageOptions['localStore'], key: string, value: string): void {
  if (!store) return
  try {
    store.setItem(LOCAL_PREFIX + key, value)
  } catch {
    // WebView storage can be unavailable after a profile reset; memory still holds the PKCE verifier.
  }
}

function deleteLocal(store: AuthStorageOptions['localStore'], key: string): void {
  if (!store) return
  try {
    store.removeItem(LOCAL_PREFIX + key)
  } catch {
    // Ignore quota / privacy-mode failures.
  }
}

export function createAuthStorage(options: AuthStorageOptions = {}): AuthStorageAdapter {
  const memory = options.memory ?? new Map<string, string>()
  const localStore = options.localStore ?? (typeof localStorage === 'undefined' ? null : localStorage)

  return {
    getItem(key: string) {
      const cached = memory.get(key)
      if (cached !== undefined) return cached

      const local = readLocal(localStore, key)
      if (local !== null) {
        memory.set(key, local)
        return local
      }

      if (!options.restore) return null
      return options.restore(key).then((value) => {
        if (value !== null) {
          memory.set(key, value)
          writeLocal(localStore, key, value)
        }
        return value
      })
    },

    setItem(key: string, value: string) {
      memory.set(key, value)
      writeLocal(localStore, key, value)
      return options.persist?.(key, value).catch((error) => {
        console.warn('[scribble] auth credential persist failed', error)
      })
    },

    removeItem(key: string) {
      memory.delete(key)
      deleteLocal(localStore, key)
      return options.forget?.(key).catch((error) => {
        console.warn('[scribble] auth credential remove failed', error)
      })
    },
  }
}

export function createDesktopAuthStorage(): AuthStorageAdapter {
  const tauriAvailable = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
  if (!tauriAvailable) return createAuthStorage()

  return createAuthStorage({
    persist: (key, value) => invoke('auth_storage_set', { key, value }),
    restore: (key) => invoke<string | null>('auth_storage_get', { key }),
    forget: (key) => invoke('auth_storage_remove', { key }),
  })
}
