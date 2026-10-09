/**
 * GitHub Releases updates. A newer signed build installs itself.
 * The release must be public at github.com/azizisnotme/scribble.
 */
import { inTauri } from '@/lib/ipc'

export type UpdatePromptResult = 'no_update' | 'installing' | 'unavailable'

export const UPDATE_EVENT = 'scribble:update'

function report(label: string | null) {
  window.dispatchEvent(new CustomEvent(UPDATE_EVENT, { detail: label }))
}

async function installUpdate(update: import('@tauri-apps/plugin-updater').Update): Promise<'installing'> {
  let downloaded = 0
  let total = 0
  report(`Downloading Scribble ${update.version}`)
  await update.downloadAndInstall(
    (event) => {
      if (event.event === 'Started') {
        total = event.data.contentLength ?? 0
        report(`Downloading Scribble ${update.version}`)
      } else if (event.event === 'Progress') {
        downloaded += event.data.chunkLength
        if (total > 0) {
          const pct = Math.min(100, Math.round((downloaded / total) * 100))
          report(`Downloading Scribble ${update.version} · ${pct}%`)
        }
      } else if (event.event === 'Finished') {
        report('Installing Scribble…')
      }
    },
    { timeout: 30 * 60 * 1000 },
  )
  report('Restarting Scribble…')
  const { relaunch } = await import('@tauri-apps/plugin-process')
  await relaunch()
  return 'installing'
}

/** Install a newer GitHub release immediately. Missing releases and offline checks do not block the app. */
export async function installAvailableUpdate(): Promise<UpdatePromptResult> {
  if (!inTauri) return 'unavailable'
  try {
    const { check } = await import('@tauri-apps/plugin-updater')
    const update = await check({ timeout: 30000 })
    if (!update) return 'no_update'
    return await installUpdate(update)
  } catch {
    report(null)
    return 'unavailable'
  }
}

/** Background check after startup. A found update covers the app and installs. */
export function scheduleStartupUpdateProbe(delayMs = 2500): () => void {
  if (!inTauri) return () => {}
  const id = window.setTimeout(() => {
    void installAvailableUpdate().catch(() => {
      report(null)
    })
  }, delayMs)
  return () => window.clearTimeout(id)
}
