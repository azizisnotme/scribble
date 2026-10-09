import { ScanText } from 'lucide-react'

import { OcrCard } from '@/components/OcrCard'
import { Card } from '@/components/ui/card'

interface OcrScannerProps {
  onSendToLive?: (text: string) => void
}

export function OcrScanner({ onSendToLive }: OcrScannerProps) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-4 px-6 pb-6">
      <Card className="flex shrink-0 items-center gap-3 border-border/60 bg-card/80 px-5 py-4 backdrop-blur-sm">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/15 text-primary">
          <ScanText className="h-5 w-5" strokeWidth={2} />
        </span>
        <div className="min-w-0">
          <h2 className="text-[14px] font-semibold tracking-tight text-foreground">Extract text from picture</h2>
          <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
            Drop a photo, screenshot, or scan and pull out the words. Everything runs on your computer — images never
            leave the app.
          </p>
        </div>
      </Card>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(320px,460px)_minmax(0,1fr)] lg:gap-5">
        <OcrCard className="min-h-[460px] xl:min-h-0" onSendToLive={onSendToLive} />
        <Card className="hidden min-h-0 flex-col overflow-hidden border-dashed border-border/75 bg-secondary/25 lg:flex">
          <div className="border-b border-border/55 px-5 py-4">
            <div className="text-[13px] font-semibold text-foreground">Get the cleanest text</div>
            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
              The first scan downloads a small language model (~10 MB) once, then caches it for instant reuse.
            </p>
          </div>
          <ul className="list-disc space-y-2.5 px-9 py-5 text-[12px] text-muted-foreground marker:text-primary/80">
            <li>
              Keep <strong className="font-medium text-foreground/90">Enhance image</strong> on — it sharpens and
              boosts contrast for noticeably better accuracy.
            </li>
            <li>Pick the matching <strong className="font-medium text-foreground/90">Language</strong> for non-English text (or English + Spanish for mixed pages).</li>
            <li>
              Use the <strong className="font-medium text-foreground/90">Layout</strong> hint: <em>Single line</em> for
              labels, <em>Scattered text</em> for receipts and screenshots.
            </li>
            <li>Higher-contrast, straight, well-lit pictures always read best.</li>
            <li>Results are editable — fix a stray character, then <strong className="font-medium text-foreground/90">Copy</strong>, save as <strong className="font-medium text-foreground/90">.txt</strong>, or send <strong className="font-medium text-foreground/90">To Live</strong>.</li>
          </ul>
        </Card>
      </div>
    </div>
  )
}
