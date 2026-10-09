/** Push assistant text into the Live typing buffer (same tab + after navigation). */

export const LIVE_BUFFER_STORAGE_KEY = 'scribble_live_buffer_from_ai'
export const LIVE_BUFFER_EVENT = 'scribble-live-buffer'

export function pushTextToLiveBuffer(text: string, afterPush?: () => void): void {
  const t = text.replace(/\r\n/g, '\n')
  if (!t.trim()) return
  try {
    localStorage.setItem(LIVE_BUFFER_STORAGE_KEY, t)
  } catch {
    /* quota */
  }
  window.dispatchEvent(new Event(LIVE_BUFFER_EVENT))
  afterPush?.()
}
