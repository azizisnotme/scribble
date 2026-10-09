/**
 * Scribble AI engine — one built-in on-device brain (WebGPU in WebView2).
 * Users never pick models; the app loads Scribble's default brain only.
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
const SCRIBBLE_BALANCED_BRAIN = 'Llama-3.2-3B-Instruct-q4f16_1-MLC'
const SCRIBBLE_BEST_BRAIN = 'Qwen2.5-3B-Instruct-q4f16_1-MLC'

/** Silent fallback if the primary brain cannot load on this GPU. */
const SCRIBBLE_BUILTIN_FALLBACK = 'Llama-3.2-1B-Instruct-q4f32_1-MLC'

function brainsForTier(tier: HardwareTier): string[] {
  if (tier === 'high') return [SCRIBBLE_BEST_BRAIN, SCRIBBLE_BALANCED_BRAIN, SCRIBBLE_BUILTIN_BRAIN]
  if (tier === 'mid') return [SCRIBBLE_BALANCED_BRAIN, SCRIBBLE_BUILTIN_BRAIN]
  return [SCRIBBLE_BUILTIN_BRAIN, SCRIBBLE_BUILTIN_FALLBACK]
}

function isChatBrain(id: string): boolean {
  return prebuiltAppConfig.model_list.some((rec) => {
    if (rec.model_id !== id) return false
    if (rec.model_type === ModelType.embedding) return false
    if (rec.model_type === ModelType.VLM) return false
    return true
  })
}

let activeEngine: WebWorkerMLCEngine | null = null
let activeWorker: Worker | null = null
let activeBrainId: string | null = null

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

  const brains = brainsForTier(tier).filter(isChatBrain)
  if (!brains.length) {
    throw new Error('Scribble AI could not start.')
  }

  let lastErr: Error | null = null
  for (const brainId of brains) {
    const worker = new Worker(new URL('../workers/webllm-worker.ts', import.meta.url), {
      type: 'module',
    })
    try {
      const engine = await CreateWebWorkerMLCEngine(worker, brainId, {
        initProgressCallback: onProgress,
      })
      activeEngine = engine
      activeWorker = worker
      activeBrainId = brainId
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
