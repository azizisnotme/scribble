import { useEffect, useRef, useState } from 'react'
import { Database, Download, Info, RotateCcw, Upload } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { installAvailableUpdate } from '@/lib/auto-update'
import { useAuth } from '@/contexts/auth'
import { useAppPolicy } from '@/lib/app-policy'
import { getUiTheme, setUiTheme, type UiThemeId } from '@/lib/theme'
import { inTauri } from '@/lib/ipc'
import { createBackup, restoreBackup } from '@/lib/storage'
import { resetOnboarding } from '@/lib/onboarding'

interface AppInfo {
  name: string
  version: string
  rust_version: string
  target_triple: string
}

const THEMES: { id: UiThemeId; label: string; note: string; swatch: string; paper: string; sidebar: string }[] = [
  { id: 'cobalt', label: 'Cobalt', note: 'Midnight ink', swatch: '#4F7CFF', paper: '#0B1220', sidebar: '#070B14' },
  { id: 'bloodlust', label: 'Bloodlust', note: 'Warm red night', swatch: '#F0435A', paper: '#14080B', sidebar: '#0C0507' },
  { id: 'toxic', label: 'Toxic', note: 'Ink green', swatch: '#22C55E', paper: '#07140F', sidebar: '#04110C' },
  { id: 'hearth', label: 'Hearth', note: 'Amber fire', swatch: '#F5A524', paper: '#1A1008', sidebar: '#100A05' },
  { id: 'tide', label: 'Tide', note: 'Deep sea', swatch: '#22C3D6', paper: '#06141A', sidebar: '#041016' },
  { id: 'noir', label: 'Noir', note: 'Silver on black', swatch: '#E8E8E8', paper: '#101010', sidebar: '#0A0A0A' },
  { id: 'sketch', label: 'Sketch', note: 'Graphite, sharp edges', swatch: '#C5CED6', paper: '#12161C', sidebar: '#0E1116' },
  { id: 'classic_light', label: 'Classic Light', note: 'Warm paper desk', swatch: '#2F62C4', paper: '#FBF7F0', sidebar: '#EFE6D8' },
  { id: 'frost', label: 'Frost', note: 'Cool daylight', swatch: '#0E8FCB', paper: '#F4F8FC', sidebar: '#E7EEF5' },
  { id: 'parchment', label: 'Parchment', note: 'Ink on cream', swatch: '#9A4E2C', paper: '#FBF6EA', sidebar: '#E8DCC8' },
  { id: 'classic_dark', label: 'Classic Dark', note: 'Violet night', swatch: '#B57BFF', paper: '#140F1C', sidebar: '#0C0812' },
]

export function Settings() {
  const { isAdmin } = useAuth()
  const policy = useAppPolicy()
  const backupsAllowed = isAdmin || policy.backupOn
  const [theme, setTheme] = useState<UiThemeId>(() => getUiTheme())
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [updateBusy, setUpdateBusy] = useState(false)
  const [updateNote, setUpdateNote] = useState<string | null>(null)
  const [dataNote, setDataNote] = useState<string | null>(null)
  const backupInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!inTauri) return
    let alive = true
    import('@tauri-apps/api/core').then(({ invoke }) => {
      invoke('app_info').then((data) => {
        if (alive) setInfo(data as AppInfo)
      })
    })
    return () => {
      alive = false
    }
  }, [])

  const choose = (id: UiThemeId) => {
    setUiTheme(id)
    setTheme(id)
  }

  const exportBackup = () => {
    const blob = new Blob([JSON.stringify(createBackup(), null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `scribble-backup-${new Date().toISOString().slice(0, 10)}.json`
    anchor.click()
    URL.revokeObjectURL(url)
    setDataNote('Backup exported.')
  }

  const importBackup = async (file: File) => {
    try {
      const count = restoreBackup(JSON.parse(await file.text()))
      setDataNote(`Restored ${count} local items. Restart Scribble to refresh every view.`)
    } catch (error) {
      setDataNote(error instanceof Error ? error.message : 'Could not import this backup.')
    }
  }

  return (
    <div className="h-full min-h-0 overflow-auto px-6 pb-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-5 py-2">
        <Card className="overflow-hidden border-border/60">
          <div className="flex items-start gap-3 border-b border-border/55 px-6 py-5">
            <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary">
              <Info className="h-4 w-4" strokeWidth={2} />
            </span>
            <div>
              <h2 className="text-[15px] font-semibold tracking-tight text-foreground">About this build</h2>
              <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                Native Tauri shell. Typing is driven by a Rust engine (enigo). Extract Text from Picture runs in
                WebAssembly via Tesseract. <strong className="font-medium text-foreground/90">Scribble AI</strong> is
                built into the app and runs entirely on your device — no cloud, no separate AI install. No Python
                runtime is bundled.
              </p>
              {info && (
                <p className="mt-3 font-mono text-[11px] text-muted-foreground">
                  {info.name} v{info.version} · rust ≥ {info.rust_version} · {info.target_triple}
                </p>
              )}
            </div>
          </div>
        </Card>

        <Card className="overflow-hidden border-border/60">
          <div className="border-b border-border/55 px-6 py-4">
            <h2 className="text-[15px] font-semibold text-foreground">Personalization</h2>
            <p className="mt-1 text-[13px] text-muted-foreground">Theme presets, stored locally.</p>
          </div>
          <div className="grid gap-2 px-6 py-5 sm:grid-cols-2">
            {THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => choose(t.id)}
                className={`flex items-center gap-3 rounded-2xl border px-3 py-3 text-left transition-colors ${
                  theme === t.id ? 'border-primary bg-primary/10 shadow-[0_0_0_1px_hsl(var(--primary)/0.35)]' : 'border-border/60 hover:border-primary/40'
                }`}
              >
                <span className="grid h-12 w-16 shrink-0 grid-cols-[14px_1fr] overflow-hidden rounded-lg border border-black/15" style={{ background: t.paper }}>
                  <span style={{ background: t.sidebar }} />
                  <span className="flex flex-col justify-end gap-1 p-1.5">
                    <span className="h-1.5 w-7 rounded-full opacity-40" style={{ background: t.swatch }} />
                    <span className="h-2.5 rounded-sm" style={{ background: t.swatch }} />
                  </span>
                </span>
                <span>
                  <span className="block text-[13px] font-semibold text-foreground">{t.label}</span>
                  <span className="block text-[11px] text-muted-foreground">{t.note}</span>
                </span>
              </button>
            ))}
          </div>
        </Card>

        <Card className="overflow-hidden border-border/60">
          <div className="flex items-start gap-3 border-b border-border/55 px-6 py-5">
            <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary">
              <Database className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-[15px] font-semibold text-foreground">Local data and onboarding</h2>
              <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                Back up or restore drafts, scribbles, templates, OCR history, analytics, and preferences.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="secondary" className="rounded-xl" disabled={!backupsAllowed} onClick={exportBackup}>
                  <Download />
                  Export backup
                </Button>
                <Button type="button" size="sm" variant="outline" className="rounded-xl" disabled={!backupsAllowed} onClick={() => backupInput.current?.click()}>
                  <Upload />
                  Import backup
                </Button>
                <Button type="button" size="sm" variant="ghost" className="rounded-xl" onClick={resetOnboarding}>
                  <RotateCcw />
                  Show onboarding
                </Button>
                <input
                  ref={backupInput}
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0]
                    if (file) void importBackup(file)
                    event.currentTarget.value = ''
                  }}
                />
              </div>
              {dataNote && <p className="mt-3 text-[12px] text-muted-foreground">{dataNote}</p>}
            </div>
          </div>
        </Card>

        {inTauri && (
          <Card className="overflow-hidden border-border/60">
            <div className="flex items-start gap-3 border-b border-border/55 px-6 py-5">
              <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary">
                <Download className="h-4 w-4" strokeWidth={2} />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-[15px] font-semibold tracking-tight text-foreground">Updates</h2>
                <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                  Scribble checks GitHub when it opens. A newer release installs itself and restarts. There is no
                  skip. The public repo is github.com/azizisnotme/scribble.
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={updateBusy}
                    className="rounded-xl"
                    onClick={() => {
                      setUpdateNote(null)
                      setUpdateBusy(true)
                      void installAvailableUpdate()
                        .then((r) =>
                          setUpdateNote(
                            r === 'unavailable'
                              ? 'No GitHub release is published yet, or GitHub could not be reached.'
                              : r === 'no_update'
                                ? 'This is already the newest Scribble release.'
                                : 'Installing… Scribble will restart.',
                          ),
                        )
                        .catch((e: unknown) =>
                          setUpdateNote(e instanceof Error ? e.message : 'Update check failed — see console.'),
                        )
                        .finally(() => setUpdateBusy(false))
                    }}
                  >
                    {updateBusy ? 'Checking…' : 'Check for updates'}
                  </Button>
                  {updateNote && (
                    <p className="text-[12px] text-muted-foreground">{updateNote}</p>
                  )}
                </div>
              </div>
            </div>
          </Card>
        )}

      </div>
    </div>
  )
}


