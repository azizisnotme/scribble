// Text-from-picture engine. Runs entirely in the renderer (WebView2) via
// tesseract.js — nothing ever leaves the machine. Compared to a naive
// `createWorker().recognize()` call this adds:
//   * one cached, reused worker (no re-spawn per scan = much faster repeats)
//   * canvas preprocessing (upscale small images, grayscale, contrast
//     stretch) which dramatically improves accuracy on photos/screenshots
//   * page-segmentation + DPI hints tuned for documents
//   * live progress, confidence and word counts surfaced to the UI

type TesseractModule = typeof import('tesseract.js')
type OcrWorker = Awaited<ReturnType<TesseractModule['createWorker']>>

export type OcrLayout = 'auto' | 'block' | 'line' | 'sparse'

export interface OcrLanguage {
  code: string
  label: string
}

/** Languages offered in the UI. The traineddata is fetched from the
 *  tessdata CDN the first time a language is used, then cached. */
export const OCR_LANGUAGES: OcrLanguage[] = [
  { code: 'eng', label: 'English' },
  { code: 'eng+spa', label: 'English + Spanish' },
  { code: 'spa', label: 'Spanish' },
  { code: 'fra', label: 'French' },
  { code: 'deu', label: 'German' },
  { code: 'ita', label: 'Italian' },
  { code: 'por', label: 'Portuguese' },
  { code: 'nld', label: 'Dutch' },
]

export interface OcrOptions {
  langs?: string
  layout?: OcrLayout
  enhance?: boolean
  onProgress?: (status: string, progress: number) => void
}

export interface OcrResult {
  text: string
  confidence: number
  words: number
  ms: number
  /** The preprocessed image that was actually fed to the engine. */
  imageUsed: string
}

let modPromise: Promise<TesseractModule> | null = null
function loadTesseract(): Promise<TesseractModule> {
  if (!modPromise) modPromise = import('tesseract.js')
  return modPromise
}

let workerPromise: Promise<OcrWorker> | null = null
let workerLangs = ''
// The cached worker is created once; its logger forwards progress to whichever
// scan is currently running. Scans are serialized by the UI (buttons disable
// while loading), so a single shared callback is safe.
let activeProgress: ((status: string, progress: number) => void) | null = null

async function getWorker(langs: string): Promise<OcrWorker> {
  const { createWorker, OEM } = await loadTesseract()
  if (!workerPromise) {
    workerPromise = createWorker(langs, OEM.LSTM_ONLY, {
      logger: (m: { status: string; progress: number }) => {
        activeProgress?.(m.status, typeof m.progress === 'number' ? m.progress : 0)
      },
    })
    workerLangs = langs
    return workerPromise
  }
  const worker = await workerPromise
  if (langs !== workerLangs) {
    await worker.reinitialize(langs)
    workerLangs = langs
  }
  return worker
}

/** Free the cached worker (e.g. on teardown). Safe to call when idle. */
export async function disposeOcr(): Promise<void> {
  if (!workerPromise) return
  const p = workerPromise
  workerPromise = null
  workerLangs = ''
  try {
    const worker = await p
    await worker.terminate()
  } catch {
    /* already gone */
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('That file could not be read as an image.'))
    img.src = src
  })
}

const MIN_SIDE = 1000 // upscale anything smaller so glyphs are big enough
const MAX_SIDE = 3000 // ~36 MB RGBA ceiling before Tesseract's own buffers

/** Upscale tiny images, optionally grayscale + stretch contrast. Returns a
 *  PNG data URL plus the dimensions actually used. */
async function preprocessImage(
  dataUrl: string,
  enhance: boolean,
): Promise<{ dataUrl: string; width: number; height: number }> {
  const img = await loadImage(dataUrl)
  const w0 = img.naturalWidth || img.width
  const h0 = img.naturalHeight || img.height
  if (!w0 || !h0) return { dataUrl, width: 0, height: 0 }

  const minSide = Math.min(w0, h0)
  const maxSide = Math.max(w0, h0)
  let scale = 1
  if (minSide < MIN_SIDE) scale = Math.min(3, MIN_SIDE / minSide)
  if (maxSide * scale > MAX_SIDE) scale = MAX_SIDE / maxSide
  if (maxSide > MAX_SIDE) scale = MAX_SIDE / maxSide

  const w = Math.max(1, Math.round(w0 * scale))
  const h = Math.max(1, Math.round(h0 * scale))

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return { dataUrl, width: w0, height: h0 }
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, w, h)

  if (enhance) {
    const imageData = ctx.getImageData(0, 0, w, h)
    const d = imageData.data
    const hist = new Array<number>(256).fill(0)
    for (let i = 0; i < d.length; i += 4) {
      const g = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0
      d[i] = d[i + 1] = d[i + 2] = g
      hist[g]++
    }
    // Clip the darkest/brightest 2% then stretch to the full 0..255 range.
    const total = w * h
    const cut = total * 0.02
    let acc = 0
    let lo = 0
    for (let v = 0; v < 256; v++) {
      acc += hist[v]
      if (acc >= cut) {
        lo = v
        break
      }
    }
    acc = 0
    let hi = 255
    for (let v = 255; v >= 0; v--) {
      acc += hist[v]
      if (acc >= cut) {
        hi = v
        break
      }
    }
    if (hi <= lo) {
      lo = 0
      hi = 255
    }
    const range = hi - lo || 1
    for (let i = 0; i < d.length; i += 4) {
      let v = ((d[i] - lo) / range) * 255
      v = v < 0 ? 0 : v > 255 ? 255 : v
      d[i] = d[i + 1] = d[i + 2] = v
    }
    ctx.putImageData(imageData, 0, 0)
  }

  return { dataUrl: canvas.toDataURL('image/png'), width: w, height: h }
}

const WORD_RE = /\S+/g
function countWords(text: string): number {
  const m = text.match(WORD_RE)
  return m ? m.length : 0
}

function cleanText(raw: string): string {
  return raw
    .replace(/[ \t]+\n/g, '\n') // trailing spaces
    .replace(/\n{3,}/g, '\n\n') // collapse big gaps
    .trim()
}

async function recognizeText(imageDataUrl: string, opts: OcrOptions = {}): Promise<OcrResult> {
  const t0 = performance.now()
  const langs = opts.langs && opts.langs.trim() ? opts.langs.trim() : 'eng'
  const enhance = opts.enhance ?? true

  opts.onProgress?.('preparing image', 0)
  const prepped = await preprocessImage(imageDataUrl, enhance)

  const { PSM } = await loadTesseract()
  const psm =
    opts.layout === 'block'
      ? PSM.SINGLE_BLOCK
      : opts.layout === 'line'
        ? PSM.SINGLE_LINE
        : opts.layout === 'sparse'
          ? PSM.SPARSE_TEXT
          : PSM.AUTO

  const worker = await getWorker(langs)
  activeProgress = opts.onProgress ?? null
  try {
    await worker.setParameters({
      tessedit_pageseg_mode: psm,
      preserve_interword_spaces: '1',
      user_defined_dpi: '300',
    })
    const { data } = await worker.recognize(prepped.dataUrl)
    const text = cleanText(data.text || '')
    return {
      text,
      confidence: Math.max(0, Math.min(100, Math.round(data.confidence ?? 0))),
      words: countWords(text),
      ms: Math.round(performance.now() - t0),
      imageUsed: prepped.dataUrl,
    }
  } finally {
    activeProgress = null
  }
}

let scanQueue: Promise<void> = Promise.resolve()

/** Recognize text in an image. Calls are queued globally so two mounted OCR cards cannot compete for one worker. */
export function extractText(imageDataUrl: string, opts: OcrOptions = {}): Promise<OcrResult> {
  const run = scanQueue.then(() => recognizeText(imageDataUrl, opts))
  scanQueue = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}
