// File picker that returns null whenever we don't have a Tauri host;
// the OcrCard falls back to a hidden <input type="file"> in that case.
//
// We always read the bytes through a `File` object (drag-drop or input)
// because OCR runs in-process via tesseract.js — no filesystem read on
// the Rust side is needed.

export async function pickImagePath(): Promise<string | null> {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
    return null
  }
  // We *could* use the dialog plugin here to get a real path, but
  // tesseract.js wants the bytes anyway. Returning null forces the
  // standard <input type="file"> picker, which gives us a File the
  // engine can read directly.
  return null
}

export function filePathHint(file: File): string | null {
  const p = (file as File & { path?: string }).path
  if (typeof p === 'string' && p.length > 0) return p
  return null
}
