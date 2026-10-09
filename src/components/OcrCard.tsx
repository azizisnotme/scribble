import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Check,
  ClipboardPaste,
  Copy,
  Download,
  Image as ImageIcon,
  Keyboard,
  Languages,
  Loader2,
  RotateCcw,
  ScanText,
  Sparkles,
  Trash2,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { extractText, OCR_LANGUAGES, type OcrLayout } from '@/lib/ocr'
import { listRecentUploads, pushRecentUpload, type RecentUpload } from '@/lib/local-engine'

interface OcrCardProps {
  className?: string
  onSendToLive?: (text: string) => void
  /** Show language / layout / enhance controls and the recent list. */
  advanced?: boolean
}

const LAYOUTS: { value: OcrLayout; label: string }[] = [
  { value: 'auto', label: 'Auto detect' },
  { value: 'block', label: 'Paragraph / block' },
  { value: 'line', label: 'Single line' },
  { value: 'sparse', label: 'Scattered text' },
]

function friendlyStatus(status: string): string {
  const s = status.toLowerCase()
  if (s.includes('preparing')) return 'Preparing image…'
  if (s.includes('core')) return 'Loading engine…'
  if (s.includes('language') || s.includes('traineddata')) return 'Loading language…'
  if (s.includes('initializing')) return 'Initializing…'
  if (s.includes('recognizing')) return 'Reading text…'
  return status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Working…'
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result))
    fr.onerror = () => reject(fr.error ?? new Error('read failed'))
    fr.readAsDataURL(file)
  })
}

function downloadText(text: string) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `extracted-text-${new Date().toISOString().slice(0, 10)}.txt`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function confidenceTone(c: number): string {
  if (c >= 85) return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
  if (c >= 60) return 'border-amber-500/40 bg-amber-500/10 text-amber-300'
  return 'border-rose-500/40 bg-rose-500/10 text-rose-300'
}

async function makeHistoryThumbnail(dataUrl: string): Promise<string> {
  const image = new Image()
  image.src = dataUrl
  await image.decode()
  const scale = Math.min(1, 480 / Math.max(image.naturalWidth, image.naturalHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
  canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.72)
}

export function OcrCard({ className, onSendToLive, advanced = true }: OcrCardProps) {
  const [dragOver, setDragOver] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [meta, setMeta] = useState<{ confidence: number; ms: number } | null>(null)
  const [progress, setProgress] = useState<{ label: string; pct: number } | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [recent, setRecent] = useState<RecentUpload[]>([])
  const [lang, setLang] = useState('eng')
  const [layout, setLayout] = useState<OcrLayout>('auto')
  const [enhance, setEnhance] = useState(true)
  const fileInput = useRef<HTMLInputElement>(null)

  const refreshRecent = useCallback(() => {
    try {
      setRecent(listRecentUploads())
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    refreshRecent()
  }, [refreshRecent])

  const runOcr = useCallback(
    async (file: File, name: string) => {
      setLoading(true)
      setError(null)
      setCopied(false)
      setText('')
      setMeta(null)
      setProgress({ label: 'Preparing image…', pct: 0 })

      let url: string
      try {
        url = await fileToDataUrl(file)
      } catch {
        setError('Could not read this file.')
        setLoading(false)
        setProgress(null)
        return
      }
      setPreview(url)

      try {
        const res = await extractText(url, {
          langs: lang,
          layout,
          enhance,
          onProgress: (status, p) => setProgress({ label: friendlyStatus(status), pct: Math.round(p * 100) }),
        })
        setText(res.text)
        setMeta({ confidence: res.confidence, ms: res.ms })
        if (!res.text.trim()) {
          setError('No readable text found. Try turning on Enhance, a sharper picture, or a different layout.')
        }
        const thumbnail = await makeHistoryThumbnail(url).catch(() => undefined)
        pushRecentUpload(name, res.text.trim() ? 'done' : 'ongoing', {
          text: res.text,
          imageDataUrl: thumbnail,
          confidence: res.confidence,
          ms: res.ms,
        })
        refreshRecent()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setLoading(false)
        setProgress(null)
      }
    },
    [lang, layout, enhance, refreshRecent],
  )

  const onClipboardImport = async () => {
    setError(null)
    try {
      if (!navigator.clipboard || !navigator.clipboard.read) {
        setError('Clipboard read is not available in this window.')
        return
      }
      const items = await navigator.clipboard.read()
      for (const clipboardItem of items) {
        for (const mime of clipboardItem.types) {
          if (mime.startsWith('image/')) {
            const blob = await clipboardItem.getType(mime)
            const ext = mime.includes('png') ? 'png' : mime.includes('jpeg') || mime.includes('jpg') ? 'jpg' : 'png'
            const file = new File([blob], `clipboard.${ext}`, { type: mime })
            await runOcr(file, file.name)
            return
          }
        }
      }
      setError('No image on the clipboard. Copy or screenshot a picture first, then try again.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Clipboard access denied or unavailable.')
    }
  }

  const copyResult = async () => {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  const clearResult = () => {
    setText('')
    setMeta(null)
    setError(null)
    setPreview(null)
    setCopied(false)
  }

  const restoreRecent = (item: RecentUpload) => {
    setText(item.text ?? '')
    setPreview(item.imageDataUrl ?? null)
    setMeta(item.confidence !== undefined && item.ms !== undefined ? { confidence: item.confidence, ms: item.ms } : null)
    setError(item.text ? null : 'This older history item did not store extracted text.')
  }

  const rerunRecent = async (item: RecentUpload) => {
    if (!item.imageDataUrl) {
      setError('This history item has no reusable image preview.')
      return
    }
    const response = await fetch(item.imageDataUrl)
    const file = new File([await response.blob()], item.name || 'recent-image.jpg', { type: 'image/jpeg' })
    await runOcr(file, item.name)
  }

  const words = text.trim() ? (text.trim().match(/\S+/g)?.length ?? 0) : 0
  const chars = text.length
  const hasResult = !!text || !!error

  return (
    <Card className={cn('flex h-full min-h-0 flex-col overflow-hidden border-border/60 bg-card', className)}>
      <div className="flex shrink-0 items-center justify-between gap-2 px-5 pb-3 pt-5">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary/15 text-primary">
            <ScanText className="h-[18px] w-[18px]" strokeWidth={2} />
          </span>
          <div>
            <h2 className="text-[14px] font-semibold tracking-tight text-foreground">Extract text from picture</h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">Runs locally — your images never leave this PC.</p>
          </div>
        </div>
        {meta && (
          <div className="flex shrink-0 items-center gap-1.5">
            <span className={cn('rounded-lg border px-2 py-0.5 font-mono text-[10px] tabular-nums', confidenceTone(meta.confidence))}>
              {meta.confidence}%
            </span>
            <span className="rounded-lg border border-border/60 bg-secondary/50 px-2 py-0.5 font-mono text-[10px] text-muted-foreground tabular-nums">
              {meta.ms} ms
            </span>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
        {advanced && (
          <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                <Languages className="h-3.5 w-3.5" /> Language
              </span>
              <Select value={lang} onValueChange={setLang}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OCR_LANGUAGES.map((l) => (
                    <SelectItem key={l.code} value={l.code}>
                      {l.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                <ScanText className="h-3.5 w-3.5" /> Layout
              </span>
              <Select value={layout} onValueChange={(v) => setLayout(v as OcrLayout)}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LAYOUTS.map((l) => (
                    <SelectItem key={l.value} value={l.value}>
                      {l.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <button
              type="button"
              onClick={() => setEnhance((v) => !v)}
              className={cn(
                'col-span-full flex items-center justify-between rounded-lg border px-3 py-2 text-[12px] transition-colors',
                enhance
                  ? 'border-primary/45 bg-primary/10 text-foreground'
                  : 'border-border/65 bg-secondary/30 text-muted-foreground hover:bg-secondary/60',
              )}
            >
              <span className="flex items-center gap-2 font-medium">
                <Sparkles className={cn('h-4 w-4', enhance ? 'text-primary' : '')} strokeWidth={2} />
                Enhance image (sharper, higher accuracy)
              </span>
              <span
                className={cn(
                  'relative h-5 w-9 shrink-0 rounded-full transition-colors',
                  enhance ? 'bg-primary' : 'bg-border',
                )}
              >
                <span
                  className={cn(
                    'absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all',
                    enhance ? 'left-[1.125rem]' : 'left-0.5',
                  )}
                />
              </span>
            </button>
          </div>
        )}

        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={async (e) => {
            e.preventDefault()
            setDragOver(false)
            const file = e.dataTransfer.files?.[0]
            if (!file) return
            await runOcr(file, file.name || 'dropped-image')
          }}
          className={cn(
            'relative flex min-h-[170px] flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed bg-secondary/30 px-4 py-7 transition-colors',
            dragOver ? 'border-primary/75 bg-primary/8' : 'border-border/75',
          )}
        >
          {loading && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-[inherit] bg-background/75 px-6 backdrop-blur-[2px]">
              <Loader2 className="h-7 w-7 animate-spin text-primary" strokeWidth={2} />
              <div className="w-full max-w-[240px]">
                <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>{progress?.label ?? 'Working…'}</span>
                  <span className="font-mono tabular-nums">{progress?.pct ?? 0}%</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-border/70">
                  <div
                    className="h-full rounded-full bg-primary transition-[width] duration-200"
                    style={{ width: `${progress?.pct ?? 0}%` }}
                  />
                </div>
              </div>
            </div>
          )}

          {preview && !loading ? (
            <img
              src={preview}
              alt="Selected"
              className="max-h-[150px] w-auto rounded-lg border border-border/60 object-contain shadow-sm"
            />
          ) : (
            <>
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-card text-muted-foreground shadow-inner">
                <ImageIcon className="h-6 w-6" strokeWidth={1.6} />
              </span>
              <div className="text-center">
                <div className="text-[13px] font-semibold text-foreground/95">Drag &amp; drop a picture</div>
                <div className="text-[12px] text-muted-foreground">PNG, JPG, screenshots, photos</div>
              </div>
            </>
          )}
        </div>

        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={async (e) => {
            const file = e.currentTarget.files?.[0]
            if (!file) return
            try {
              await runOcr(file, file.name || 'image')
            } finally {
              e.currentTarget.value = ''
            }
          }}
        />

        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button
            type="button"
            disabled={loading}
            className="h-10 rounded-xl text-[13px] font-semibold"
            onClick={() => fileInput.current?.click()}
          >
            Browse files
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={loading}
            className="h-10 rounded-xl border-border/70 bg-transparent text-[13px] font-semibold text-foreground hover:bg-secondary/70"
            onClick={() => void onClipboardImport()}
          >
            <ClipboardPaste className="mr-1.5 h-4 w-4" strokeWidth={2} />
            Paste image
          </Button>
        </div>

        {hasResult && (
          <div className="mt-5 rounded-2xl border border-border/65 bg-card/60 p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-semibold text-foreground">Extracted text</span>
                {!error && (
                  <span className="text-[11px] text-muted-foreground tabular-nums">
                    {words} words · {chars} chars
                  </span>
                )}
              </div>
              <div className="flex gap-1">
                {onSendToLive && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={!text.trim() || loading}
                    onClick={() => text.trim() && onSendToLive(text)}
                    className="h-8 gap-1.5 px-2 text-[12px]"
                  >
                    <Keyboard className="h-3.5 w-3.5" />
                    To Live
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={!text.trim() || loading}
                  onClick={() => downloadText(text)}
                  className="h-8 gap-1.5 px-2 text-[12px]"
                >
                  <Download className="h-3.5 w-3.5" />
                  .txt
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={!text.trim() || loading}
                  onClick={() => void copyResult()}
                  className="h-8 gap-1.5 px-2 text-[12px]"
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? 'Copied' : 'Copy'}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={loading}
                  onClick={clearResult}
                  className="h-8 gap-1.5 px-2 text-[12px] text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {error ? (
              <p className="mt-2 whitespace-pre-wrap text-[12px] leading-relaxed text-destructive">{error}</p>
            ) : (
              <>
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  spellCheck={false}
                  className="mt-2 max-h-[280px] min-h-[120px] w-full resize-y rounded-xl border border-border/60 bg-background/60 p-3 font-mono text-[12px] leading-relaxed text-foreground/90 outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/40"
                />
                <p className="mt-1.5 text-[11px] text-muted-foreground">Edit any mistakes above before copying or sending.</p>
              </>
            )}
          </div>
        )}

        {advanced && recent.length > 0 && (
          <div className="mt-6 border-t border-border/60 pt-4">
            <div className="text-[12px] font-semibold text-muted-foreground">Recent pictures</div>
            <ul className="mt-3 flex flex-col gap-2.5">
              {recent.map((item) => (
                <li key={item.id} className="flex items-center gap-3 rounded-xl px-1 py-0.5">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-secondary/70 text-muted-foreground/80">
                    <ImageIcon className="h-4 w-4" strokeWidth={1.8} />
                  </span>
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => restoreRecent(item)}>
                    <div className="truncate text-[12.5px] font-medium text-foreground">{item.name}</div>
                    <div className="text-[11px] text-muted-foreground">{item.age}</div>
                  </button>
                  {item.imageDataUrl && (
                    <Button type="button" size="icon" variant="ghost" className="h-8 w-8" aria-label={`Run OCR again for ${item.name}`} disabled={loading} onClick={() => void rerunRecent(item)}>
                      <RotateCcw />
                    </Button>
                  )}
                  <StatusPill status={item.status} />
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  )
}

function StatusPill({ status }: { status: RecentUpload['status'] }) {
  if (status === 'done') {
    return <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-primary shadow-[0_0_12px_2px_rgba(59,130,246,0.55)]" />
  }
  if (status === 'upload') {
    return <span className="shrink-0 text-[11px] font-semibold text-primary">Upload</span>
  }
  return <span className="shrink-0 text-[11px] font-medium text-muted-foreground">No text</span>
}
