import { beforeEach, describe, expect, it } from 'vitest'

import { readAnalyticsSummary, recordAnalyticsTyped } from '@/lib/local-engine'

describe('analytics', () => {
  beforeEach(() => localStorage.clear())

  it('counts words, characters, sessions, and source', () => {
    recordAnalyticsTyped('one two three', 'live-typing')
    const summary = readAnalyticsSummary() as {
      lifetime_chars: number
      lifetime_words: number
      lifetime_sessions: number
      recent_sessions: Array<{ source: string }>
    }
    expect(summary.lifetime_chars).toBe(13)
    expect(summary.lifetime_words).toBe(3)
    expect(summary.lifetime_sessions).toBe(1)
    expect(summary.recent_sessions[0]?.source).toBe('live-typing')
  })
})

