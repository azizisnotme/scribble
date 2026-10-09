/** Browser-side hardware hints (WebGPU check for built-in Scribble AI). */
import { gpuMemory } from '@/lib/desktop'

export type HardwareTier = 'high' | 'mid' | 'low'

export interface HardwareProfile {
  tier: HardwareTier
  webgpuAvailable: boolean
  /** Chrome-style device RAM (GiB), when exposed */
  deviceMemoryGiB?: number
  hardwareConcurrency: number
  /** From GPUAdapter.limits — correlates with GPU class, not 1:1 VRAM */
  maxStorageBufferBindingSize?: number
  gpuVendor?: string
  gpuArchitecture?: string
  gpuDevice?: string
  /** Dedicated video memory reported by Windows, when known */
  vramMB?: number
}

/** WebView2 caps navigator.deviceMemory at 8, so real video memory decides the tier when Windows reports it. */
function tierFromVram(vramMB: number): HardwareTier {
  if (vramMB >= 7000) return 'high'
  if (vramMB >= 3800) return 'mid'
  return 'low'
}

function navMemGiB(): number | undefined {
  const dm = (navigator as Navigator & { deviceMemory?: number }).deviceMemory
  if (typeof dm === 'number' && dm > 0) return dm
  return undefined
}

export async function detectHardwareProfile(): Promise<HardwareProfile> {
  const hardwareConcurrency =
    typeof navigator.hardwareConcurrency === 'number' && navigator.hardwareConcurrency > 0
      ? navigator.hardwareConcurrency
      : 4
  const deviceMemoryGiB = navMemGiB()

  if (!navigator.gpu?.requestAdapter) {
    return {
      tier: 'low',
      webgpuAvailable: false,
      deviceMemoryGiB,
      hardwareConcurrency,
    }
  }

  let adapter: GPUAdapter | null = null
  try {
    adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })
    adapter ??= await navigator.gpu.requestAdapter()
  } catch {
    adapter = null
  }

  if (!adapter) {
    return {
      tier: deviceMemoryGiB !== undefined && deviceMemoryGiB >= 8 ? 'mid' : 'low',
      webgpuAvailable: false,
      deviceMemoryGiB,
      hardwareConcurrency,
    }
  }

  const limits = adapter.limits
  const maxBind = limits.maxStorageBufferBindingSize

  let gpuVendor: string | undefined
  let gpuArchitecture: string | undefined
  let gpuDevice: string | undefined
  try {
    const extended = adapter as GPUAdapter & {
      requestAdapterInfo?: () => Promise<{ vendor?: string; architecture?: string; device?: string }>
    }
    const info = await extended.requestAdapterInfo?.()
    if (info) {
      gpuVendor = info.vendor || undefined
      gpuArchitecture = info.architecture || undefined
      gpuDevice = info.device || undefined
    }
  } catch {
    /* optional in some WebViews */
  }

  const mem = deviceMemoryGiB ?? 8
  const vLower = (gpuVendor ?? '').toLowerCase()
  const integratedHint =
    /intel|apple|amd\s*radeon\s*\(/i.test(vLower) || /ANGLE \(Intel/i.test(gpuDevice ?? '')

  let tier: HardwareTier = 'mid'
  if (mem >= 8 && hardwareConcurrency >= 8 && maxBind >= 1024 * 1024 * 1024 && !integratedHint) {
    tier = 'high'
  } else if (mem >= 8 && maxBind >= 128 * 1024 * 1024) {
    tier = 'mid'
  } else {
    tier = 'low'
  }

  const vram = await gpuMemory()
  const vramMB = vram && vram.dedicated_mb > 0 ? vram.dedicated_mb : undefined
  if (vramMB !== undefined) tier = tierFromVram(vramMB)

  return {
    tier,
    webgpuAvailable: true,
    deviceMemoryGiB,
    hardwareConcurrency,
    maxStorageBufferBindingSize: maxBind,
    gpuVendor,
    gpuArchitecture,
    gpuDevice,
    vramMB,
  }
}
