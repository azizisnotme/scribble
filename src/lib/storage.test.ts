import { beforeEach, describe, expect, it } from 'vitest'

import { createBackup, restoreBackup, storageGetJson, storageSetJson } from '@/lib/storage'

describe('local storage safety', () => {
  beforeEach(() => localStorage.clear())

  it('round-trips versioned JSON values', () => {
    expect(storageSetJson('scribble_test', { value: 42 })).toBe(true)
    expect(storageGetJson('scribble_test', { value: 0 })).toEqual({ value: 42 })
  })

  it('recovers from corrupt JSON', () => {
    localStorage.setItem('scribble_test', '{bad')
    expect(storageGetJson('scribble_test', ['fallback'])).toEqual(['fallback'])
    expect(localStorage.getItem('scribble_test')).toBeNull()
  })

  it('backs up and restores only Scribble keys', () => {
    localStorage.setItem('scribble_draft', 'hello')
    localStorage.setItem('unrelated', 'secret')
    const backup = createBackup()
    localStorage.clear()
    expect(restoreBackup(backup)).toBe(1)
    expect(localStorage.getItem('scribble_draft')).toBe('hello')
    expect(localStorage.getItem('unrelated')).toBeNull()
  })
})

