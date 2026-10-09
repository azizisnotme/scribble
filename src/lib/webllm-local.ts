/**
 * Scribble AI engine — one built-in on-device brain (WebGPU in WebView2).
 * Users never pick models; the app loads the strongest brain this PC can run.
 */
import {
  CreateWebWorkerMLCEngine,
  type InitProgressCallback,
  ModelType,
  prebuiltAppConfig,
  type WebWorkerMLCEngine,
} from '@mlc-ai/web-llm'
import type { HardwareTier } from '@/lib/hardware-profile'

/** Scribble's built-in writing brain (small, fast first-run download). */
export const SCRIBBLE_BUILTIN_BRAIN = 'Llama-3.2-1B-Instruct-q4f16_1-MLC'
const QWEN3_8B = 'Qwen3-8B-q4f16_1-MLC'
const QWEN3_4B = 'Qwen3-4B-q4f16_1-MLC'
const QWEN3_1_7B = 'Qwen3-1.7B-q4f16_1-MLC'
const QWEN3_1_7B_F32 = 'Qwen3-1.7B-q4f32_1-MLC'

/** Silent fallback if the primary brain cannot load on this GPU. */
const SCRIBBLE_BUILTIN_FALLBACK = 'Llama-3.2-1B-Instruct-q4f32_1-MLC'

const DEFAULT_CONTEXT = 4096
const LARGE_CONTEXT = 8192

function brainsForTier(tier: HardwareTier): string[] {
  if (tier === 'high') return [QWEN3_8B, QWEN3_4B, QWEN3_1_7B, SCRIBBLE_BUILTIN_BRAIN]
  if (tier === 'mid') return [QWEN3_4B, QWEN3_1_7B, SCRIBBLE_BUILTIN_BRAIN]
  return [QWEN3_1_7B, SCRIBBLE_BUILTIN_BRAIN, QWEN3_1_7B_F32, SCRIBBLE_BUILTIN_FALLBACK]
}

function contextFor(brainId: string, tier: HardwareTier): number {
  return tier === 'high' && brainId.startsWith('Qwen3-') ? LARGE_CONTEXT : DEFAULT_CONTEXT
}

function isChatBrain(id: string): boolean {
  return prebuiltAppConfig.model_list.some((rec) => {
    if (rec.model_id !== id) return false
    if (rec.model_type === ModelType.embedding) return false
    if (rec.model_type === ModelType.VLM) return false
    return true
  })
}

async function supportsF16(): Promise<boolean> {
  try {
    const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' })
    return adapter?.features.has('shader-f16') ?? false
  } catch {
    return false
  }
}

let activeEngine: WebWorkerMLCEngine | null = null
let activeWorker: Worker | null = null
let activeBrainId: string | null = null
let activeContext = DEFAULT_CONTEXT

export function disposeLocalEngine(): void {
  try {
    void activeEngine?.unload()
  } catch {
    /* ignore */
  }
  activeEngine = null
  activeBrainId = null
  try {
    activeWorker?.terminate()
  } catch {
    /* ignore */
  }
  activeWorker = null
}

/** Load Scribble's built-in brain. No model selection — ever. */
export async function initScribbleEngine(onProgress: InitProgressCallback, tier: HardwareTier = 'low'): Promise<void> {
  disposeLocalEngine()

  const f16 = await supportsF16()
  const brains = brainsForTier(tier)
    .filter(isChatBrain)
    .filter((id) => f16 || !id.includes('q4f16'))
  if (!brains.length) {
    throw new Error('Scribble AI could not start.')
  }

  let lastErr: Error | null = null
  for (const brainId of brains) {
    const worker = new Worker(new URL('../workers/webllm-worker.ts', import.meta.url), {
      type: 'module',
    })
    const context = contextFor(brainId, tier)
    try {
      const engine = await CreateWebWorkerMLCEngine(
        worker,
        brainId,
        { initProgressCallback: onProgress },
        { context_window_size: context },
      )
      activeEngine = engine
      activeWorker = worker
      activeBrainId = brainId
      activeContext = context
      return
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e))
      try {
        worker.terminate()
      } catch {
        /* ignore */
      }
    }
  }

  throw lastErr ?? new Error('Scribble AI could not start.')
}

export function getActiveEngine(): WebWorkerMLCEngine | null {
  return activeEngine
}

export function getActiveBrainId(): string | null {
  return activeBrainId
}

export function getActiveContextWindow(): number {
  return activeContext
}

/** Qwen3 thinks out loud unless told not to; Scribble wants answers only. */
export function activeBrainThinks(): boolean {
  return activeBrainId?.startsWith('Qwen3-') ?? false
}
