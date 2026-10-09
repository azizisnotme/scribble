import { describe, expect, it } from 'vitest'

import { fitMessages, stripThinking } from '@/lib/ai-runtime'
import { fallbackPlan, looksLikeAction, parsePlan } from '@/lib/scribble-ai'

describe('planner output', () => {
  it('reads JSON wrapped in prose and code fences', () => {
    const plan = parsePlan('Sure!\n```json\n{"title":"Poem","reply":"On it.","steps":[{"tool":"open_app","input":"notepad"}]}\n```')
    expect(plan?.steps?.[0]).toEqual({ tool: 'open_app', input: 'notepad' })
  })

  it('repairs trailing commas and a cut-off ending', () => {
    expect(parsePlan('{"steps":[{"tool":"wait","input":"3"},]}')?.steps).toHaveLength(1)
    expect(parsePlan('{"title":"x","steps":[{"tool":"wait","input":"3"}')?.steps).toHaveLength(1)
  })

  it('returns null when there is no plan', () => {
    expect(parsePlan('I cannot do that.')).toBeNull()
  })
})

describe('action detection', () => {
  it('spots requests to act on the computer', () => {
    expect(looksLikeAction('open notepad and write a poem')).toBe(true)
    expect(looksLikeAction('write an essay about dogs in google docs')).toBe(true)
    expect(looksLikeAction('make a new google doc about the civil war')).toBe(true)
    expect(looksLikeAction('search for cheap flights to miami')).toBe(true)
  })

  it('leaves plain questions to chat', () => {
    expect(looksLikeAction('what is the capital of france')).toBe(false)
    expect(looksLikeAction('write me a poem about rain')).toBe(false)
  })
})

describe('fallback plans', () => {
  it('writes into the named app', () => {
    const plan = fallbackPlan('write a story about a dragon in notepad')
    expect(plan?.steps?.map((s) => s.tool)).toEqual(['open_app', 'wait', 'write', 'type_text'])
    expect(plan?.steps?.[2].input).toBe('a story about a dragon')
  })

  it('opens sites, apps, and searches', () => {
    expect(fallbackPlan('open youtube')?.steps?.[0]).toEqual({ tool: 'open_url', input: 'https://www.youtube.com' })
    expect(fallbackPlan('open calculator')?.steps?.[0]).toEqual({ tool: 'open_app', input: 'calculator' })
    expect(fallbackPlan('search for best pizza near me')?.steps?.[0].tool).toBe('search_web')
  })
})

describe('context fitting', () => {
  it('keeps the system prompt and the newest turns', () => {
    const long = 'x'.repeat(4000)
    const messages = [
      { role: 'system' as const, content: 'rules' },
      ...Array.from({ length: 10 }, (_, i) => ({ role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant', content: `${i} ${long}` })),
      { role: 'user' as const, content: 'latest question' },
    ]
    const fitted = fitMessages(messages, 4096, 1024)
    expect(fitted[0].content).toBe('rules')
    expect(fitted.at(-1)?.content).toBe('latest question')
    expect(fitted.length).toBeLessThan(messages.length)
    expect(fitted[1].role).toBe('user')
  })

  it('removes thinking blocks, even unfinished ones', () => {
    expect(stripThinking('<think>hmm</think>\n\nAnswer')).toBe('Answer')
    expect(stripThinking('Answer<think>still going')).toBe('Answer')
  })
})
