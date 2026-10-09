/**
 * Scribble AI runtime — one built-in on-device brain for Writer + Chat.
 */
import { detectHardwareProfile } from '@/lib/hardware-profile'
import type { ScribbleMessage } from '@/lib/scribble-messages'
import {
  buildEssayUserPrompt as buildEssayPrompt,
  SCRIBBLE_ESSAY_SYSTEM,
  friendlyAiError,
  sanitizeLoadProgress,
  statusLoading,
  statusReady,
  type ScribbleEssayLength,
} from '@/lib/scribble-ai'
import {
  activeBrainThinks,
  disposeLocalEngine,
  getActiveBrainId,
  getActiveContextWindow,
  getActiveEngine,
  initScribbleEngine,
} from '@/lib/webllm-local'

const LEGACY_MODEL_KEYS = [
  'scribble_ai_preferred_webllm_model',
  'scribble_ai_source',
  'scribble_ai_ollama_url',
  'scribble_ai_ollama_model',
]

export type AiPhase = 'idle' | 'loading' | 'ready' | 'error'

export interface AiRuntimeSnapshot {
  phase: AiPhase
  detail: string
  progress: number
  loadLabel: string
  modelId: string | null
  hardwareTier: 'high' | 'mid' | 'low' | null
}

export type EssayLength = ScribbleEssayLength

export {
  SCRIBBLE_ESSAY_SYSTEM as ESSAY_SYSTEM_PROMPT,
  buildEssayPrompt as buildEssayUserPrompt,
}

export type { ScribbleMessage }

let snapshot: AiRuntimeSnapshot = {
  phase: 'idle',
  detail: '',
  progress: 0,
  loadLabel: '',
  modelId: null,
  hardwareTier: null,
}

const listeners = new Set<(s: AiRuntimeSnapshot) => void>()
let loadPromise: Promise<void> | null = null
let forceNextLoad = false

function emit(): void {
  for (const cb of listeners) cb(snapshot)
}

function setSnapshot(patch: Partial<AiRuntimeSnapshot>): void {
  snapshot = { ...snapshot, ...patch }
  emit()
}

function clearLegacyAiPrefs(): void {
  for (const key of LEGACY_MODEL_KEYS) {
    try {
      localStorage.removeItem(key)
    } catch {
      /* ignore */
    }
  }
}

export function subscribeAiRuntime(cb: (s: AiRuntimeSnapshot) => void): () => void {
  listeners.add(cb)
  cb(snapshot)
  return () => listeners.delete(cb)
}

export function getAiRuntimeSnapshot(): AiRuntimeSnapshot {
  return snapshot
}

export function requestAiRuntimeReload(): void {
  forceNextLoad = true
}

export async function resetScribbleChat(): Promise<void> {
  await getActiveEngine()?.resetChat(true).catch(() => {})
}

export function interruptScribbleGenerate(): void {
  getActiveEngine()?.interruptGenerate()
}

async function doLoad(): Promise<void> {
  const force = forceNextLoad
  forceNextLoad = false
  clearLegacyAiPrefs()

  if (!force && getActiveEngine()) {
    setSnapshot({
      phase: 'ready',
      detail: statusReady(),
      progress: 1,
      loadLabel: '',
    })
    return
  }

  if (!force && snapshot.phase === 'ready') return

  setSnapshot({
    phase: 'loading',
    detail: statusLoading(),
    progress: 0,
    loadLabel: sanitizeLoadProgress(''),
  })
  disposeLocalEngine()

  const hw = await detectHardwareProfile()
  setSnapshot({
    hardwareTier: hw.tier,
    detail: `Preparing the best local model for this ${hw.tier}-tier device. The first download can be large.`,
  })
  if (!hw.webgpuAvailable) {
    setSnapshot({
      phase: 'error',
      detail: friendlyAiError('WebGPU unavailable — update graphics drivers and Edge WebView2.'),
    })
    return
  }

  try {
    await initScribbleEngine((report) => {
      setSnapshot({
        progress: report.progress,
        loadLabel: sanitizeLoadProgress(report.text),
        detail: statusLoading(),
      })
    }, hw.tier)
    setSnapshot({
      phase: 'ready',
      detail: statusReady(),
      progress: 1,
      loadLabel: '',
      modelId: getActiveBrainId(),
    })
  } catch (e) {
    setSnapshot({
      phase: 'error',
      detail: friendlyAiError(e instanceof Error ? e.message : String(e)),
    })
  }
}

/** Load (or reuse) Scribble AI. Safe to call from multiple views. */
export async function ensureAiRuntime(): Promise<void> {
  if (snapshot.phase === 'ready' && !forceNextLoad) return
  if (loadPromise) {
    await loadPromise
    return
  }
  loadPromise = doLoad().finally(() => {
    loadPromise = null
  })
  await loadPromise
  if (snapshot.phase === 'error') {
    throw new Error(friendlyAiError(snapshot.detail || 'Scribble AI failed to start'))
  }
}

export interface StreamGenerateOpts {
  messages: ScribbleMessage[]
  onToken?: (chunk: string) => void
  signal?: AbortSignal
  maxTokens?: number
  temperature?: number
  topP?: number
}

const MIN_REPLY_TOKENS = 256

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.2) + 8
}

/**
 * Keep the system prompt and the newest turns that fit the model's memory.
 * Sending a whole long chat overflows the context window and the model refuses to answer.
 */
export function fitMessages(messages: ScribbleMessage[], contextWindow: number, replyTokens: number): ScribbleMessage[] {
  const system = messages.filter((m) => m.role === 'system')
  const rest = messages.filter((m) => m.role !== 'system')
  let budget = contextWindow - replyTokens - system.reduce((sum, m) => sum + estimateTokens(m.content), 0)
  const kept: ScribbleMessage[] = []
  for (let index = rest.length - 1; index >= 0; index -= 1) {
    const message = rest[index]
    const cost = estimateTokens(message.content)
    if (cost > budget) {
      if (kept.length === 0) {
        const room = Math.max(200, Math.floor(budget * 3.2) - 40)
        kept.unshift({ ...message, content: message.content.slice(-room) })
      }
      break
    }
    kept.unshift(message)
    budget -= cost
  }
  while (kept.length > 1 && kept[0].role === 'assistant') kept.shift()
  return [...system, ...kept]
}

/** Remove any thinking the model wrote before its answer, including an unfinished block. */
export function stripThinking(text: string): string {
  const withoutClosed = text.replace(/<think>[\s\S]*?<\/think>\s*/g, '')
  const open = withoutClosed.indexOf('<think>')
  return (open < 0 ? withoutClosed : withoutClosed.slice(0, open)).replace(/^\s+/, '')
}

/** Stream a reply from Scribble AI. Retries once on failure. */
export async function streamGenerate(opts: StreamGenerateOpts): Promise<string> {
  const run = async (): Promise<string> => {
    await ensureAiRuntime()
    const s = getAiRuntimeSnapshot()
    if (s.phase !== 'ready') {
      throw new Error(s.detail || 'Scribble AI is not ready')
    }

    const engine = getActiveEngine()
    if (!engine) throw new Error('Scribble AI stopped — tap Retry.')

    const temperature = opts.temperature ?? 0.7
    const topP = opts.topP ?? 0.9
    const contextWindow = getActiveContextWindow()
    const wanted = Math.min(opts.maxTokens ?? 4096, Math.floor(contextWindow * 0.6))
    const messages = fitMessages(opts.messages, contextWindow, wanted)
    const promptTokens = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0)
    const maxTokens = Math.max(MIN_REPLY_TOKENS, Math.min(wanted, contextWindow - promptTokens - 64))

    let raw = ''
    let shown = ''
    const stream = await engine.chat.completions.create({
      messages,
      temperature,
      top_p: topP,
      stream: true,
      max_tokens: maxTokens,
      ...(activeBrainThinks() ? { extra_body: { enable_thinking: false } } : {}),
    })

    for await (const chunk of stream) {
      if (opts.signal?.aborted) {
        engine.interruptGenerate()
        break
      }
      const piece = chunk.choices[0]?.delta?.content ?? ''
      if (!piece) continue
      raw += piece
      const visible = stripThinking(raw)
      if (visible.length > shown.length && visible.startsWith(shown)) {
        opts.onToken?.(visible.slice(shown.length))
        shown = visible
      }
    }
    const acc = stripThinking(raw)
    if (!acc.trim()) {
      throw new Error('Scribble AI returned nothing — try a shorter prompt or Retry.')
    }
    return acc
  }

  try {
    return await run()
  } catch (first) {
    if (opts.signal?.aborted) throw first
    requestAiRuntimeReload()
    disposeLocalEngine()
    setSnapshot({ phase: 'idle', detail: 'Retrying…', progress: 0, loadLabel: '' })
    try {
      return await run()
    } catch (second) {
      throw new Error(friendlyAiError(second instanceof Error ? second.message : String(second)))
    }
  }
}

export { friendlyAiError, sanitizeLoadProgress } from '@/lib/scribble-ai'
