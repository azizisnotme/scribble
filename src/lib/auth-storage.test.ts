import { describe, expect, it, vi } from 'vitest'

import { createAuthStorage } from '@/lib/auth-storage'

describe('desktop auth storage', () => {
  it('keeps PKCE verifiers readable after a local-only write', async () => {
    const memory = new Map<string, string>()
    const localStore = new Map<string, string>()
    const storage = createAuthStorage({
      memory,
      localStore: {
        getItem: (key) => localStore.get(key) ?? null,
        setItem: (key, value) => {
          localStore.set(key, value)
        },
        removeItem: (key) => {
          localStore.delete(key)
        },
      },
    })

    await storage.setItem('sb-test-code-verifier', '"verifier-1"')
    await expect(Promise.resolve(storage.getItem('sb-test-code-verifier'))).resolves.toBe('"verifier-1"')
  })

  it('recovers from webview storage after memory is cleared', async () => {
    const localStore = new Map<string, string>()
    const adapter = {
      getItem: (key: string) => localStore.get(key) ?? null,
      setItem: (key: string, value: string) => {
        localStore.set(key, value)
      },
      removeItem: (key: string) => {
        localStore.delete(key)
      },
    }

    const writer = createAuthStorage({ memory: new Map(), localStore: adapter })
    await writer.setItem('sb-test-flow-abc-code-verifier', '"kept"')

    const reader = createAuthStorage({ memory: new Map(), localStore: adapter })
    await expect(Promise.resolve(reader.getItem('sb-test-flow-abc-code-verifier'))).resolves.toBe('"kept"')
  })

  it('does not fail sign-in when OS credential storage rejects the write', async () => {
    const persist = vi.fn().mockRejectedValue(new Error('credential store unavailable'))
    const storage = createAuthStorage({ persist })

    await expect(storage.setItem('sb-test-code-verifier', '"ok"')).resolves.toBeUndefined()
    await expect(Promise.resolve(storage.getItem('sb-test-code-verifier'))).resolves.toBe('"ok"')
    expect(persist).toHaveBeenCalled()
  })
})
