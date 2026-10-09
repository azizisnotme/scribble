// Thin shim around the local engine. We used to support an optional
// Python sidecar via JSON-RPC over stdio; that path was removed in the
// 0.2 refactor so the entire stack is now native Rust + WebView2 + a
// React renderer talking to localStorage / built-in Scribble AI / tesseract.js.

import { dispatch as localDispatch } from '@/lib/local-engine'

/** Backwards-compatible name kept so existing view code does not have to change. */
export async function py<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  return (await localDispatch(method, params)) as T
}

/** OCR helper: convert a File the user dropped into a data URL the local
 *  engine can hand to tesseract.js. The old API also accepted a fs path
 *  (for EasyOCR); that branch is gone, so we always need a File now. */
export async function prepareOcrParams(path: string, file?: File | null): Promise<Record<string, unknown>> {
  const base: Record<string, unknown> = { path }
  if (file) {
    base.imageDataUrl = await fileToDataUrl(file)
  }
  return base
}

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result))
    fr.onerror = () => reject(fr.error)
    fr.readAsDataURL(file)
  })
}

export const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

/** Always-on local engine; kept as a function for API parity with 0.1. */
export function usingPythonRpc(): boolean {
  return false
}
