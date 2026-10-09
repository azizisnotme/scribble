import { describe, expect, it } from 'vitest'

import { parseAuthCallback } from '@/contexts/auth'

describe('desktop auth callback', () => {
  it('parses PKCE code and flow id', () => {
    expect(parseAuthCallback('scribble://auth/callback?code=abc&sb_flow_id=flow')).toEqual({
      code: 'abc',
      flowId: 'flow',
      error: null,
    })
  })

  it('rejects unrelated deep links', () => {
    expect(parseAuthCallback('scribble://other/callback?code=abc')).toBeNull()
  })

  it('surfaces OAuth errors', () => {
    expect(parseAuthCallback('scribble://auth/callback?error_description=Denied')?.error).toBe('Denied')
  })

  it('parses the local browser success page', () => {
    expect(parseAuthCallback('http://127.0.0.1:18765/auth/callback?code=abc&sb_flow_id=flow')).toEqual({
      code: 'abc',
      flowId: 'flow',
      error: null,
    })
  })
})

