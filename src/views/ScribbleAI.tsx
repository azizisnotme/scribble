import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CircleAlert,
  Copy,
  Keyboard,
  MessageSquare,
  RefreshCcw,
  Send,
  Sparkles,
  Square,
  Trash2,
  Wand2,
} from 'lucide-react'

import { TaskCard } from '@/components/TaskCard'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { createTask, deleteTask, startTask } from '@/lib/tasks'
import { cn } from '@/lib/utils'
import {
  buildEssayUserPrompt,
  ensureAiRuntime,
  ESSAY_SYSTEM_PROMPT,
  interruptScribbleGenerate,
  requestAiRuntimeReload,
  resetScribbleChat,
  streamGenerate,
  subscribeAiRuntime,
  type AiRuntimeSnapshot,
  type EssayLength,
  type ScribbleMessage,
} from '@/lib/ai-runtime'
import {
  ESSAY_LENGTH_LABELS,
  extractTask,
  friendlyAiError,
  SCRIBBLE_AI_NAME,
  SCRIBBLE_AI_TAGLINE,
  SCRIBBLE_CHAT_SYSTEM,
  SCRIBBLE_PRIVATE_BADGE,
  visibleReply,
} from '@/lib/scribble-ai'

type AiTab = 'write' | 'chat'
type UiStatus = 'loading' | 'ready' | 'error' | 'sending'

const KEY_HISTORY = 'scribble_ai_history_v1'
const KEY_TAB = 'scribble_ai_tab'

const TONES = ['Academic', 'Casual', 'Persuasive', 'Professional'] as const
const LENGTHS: { id: EssayLength; label: string }[] = [
  { id: 'short', label: 'Short (~300 words)' },
  { id: 'medium', label: 'Medium (~600 words)' },
  { id: 'long', label: 'Long (~1000 words)' },
]
const MAX_TOKENS: Record<EssayLength, number> = {
  short: 4096,
  medium: 4096,
  long: 4096,
}

interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
  ts: number
  taskId?: string
  notice?: string
}

function loadHistory(): ChatTurn[] {
  try {
    const raw = localStorage.getItem(KEY_HISTORY)
    if (!raw) return []
    const data = JSON.parse(raw)
    return Array.isArray(data) ? (data as ChatTurn[]) : []
  } catch {
    return []
  }
}

function saveHistory(turns: ChatTurn[]): void {
  try {
    localStorage.setItem(KEY_HISTORY, JSON.stringify(turns.slice(-100)))
  } catch {
    /* quota */
  }
}

function loadTab(): AiTab {
  try {
    const t = localStorage.getItem(KEY_TAB)
    return t === 'chat' ? 'chat' : 'write'
  } catch {
    return 'write'
  }
}

function runtimeToUi(rt: AiRuntimeSnapshot): { status: UiStatus; detail: string; progress: number; label: string } {
  if (rt.phase === 'loading') {
    return { status: 'loading', detail: rt.detail, progress: rt.progress, label: rt.loadLabel }
  }
  if (rt.phase === 'error') {
    return { status: 'error', detail: rt.detail, progress: 0, label: '' }
  }
  if (rt.phase === 'ready') {
    return { status: 'ready', detail: rt.detail, progress: 1, label: '' }
  }
  return { status: 'loading', detail: 'Starting…', progress: 0, label: '' }
}

interface ScribbleAIProps {
  onSendToLive?: (text: string) => void
}

export function ScribbleAI({ onSendToLive }: ScribbleAIProps) {
  const [tab, setTab] = useState<AiTab>(() => loadTab())
  const [runtime, setRuntime] = useState<AiRuntimeSnapshot | null>(null)
  const [uiStatus, setUiStatus] = useState<UiStatus>('loading')
  const [statusDetail, setStatusDetail] = useState('')
  const [loadProgress, setLoadProgress] = useState(0)
  const [loadLabel, setLoadLabel] = useState('')

  // Write mode
  const [prompt, setPrompt] = useState('')
  const [tone, setTone] = useState<(typeof TONES)[number]>('Academic')
  const [length, setLength] = useState<EssayLength>('medium')
  const [draft, setDraft] = useState('')
  const [writeError, setWriteError] = useState('')
  const [generating, setGenerating] = useState(false)

  // Chat mode
  const [history, setHistory] = useState<ChatTurn[]>(() => loadHistory())
  const [chatInput, setChatInput] = useState('')
  const [streaming, setStreaming] = useState('')
  const [chatError, setChatError] = useState('')

  const abortRef = useRef<AbortController | null>(null)
  const transcriptRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => subscribeAiRuntime(setRuntime), [])
  useEffect(() => {
    void ensureAiRuntime().catch(() => {})
  }, [])

  useEffect(() => {
    if (!runtime) return
    const ui = runtimeToUi(runtime)
    if (uiStatus !== 'sending' && !generating) {
      setUiStatus(ui.status)
      setStatusDetail(ui.detail)
      setLoadProgress(ui.progress)
      setLoadLabel(ui.label)
    }
  }, [runtime, uiStatus, generating])

  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight
    }
  }, [history, streaming])

  const switchTab = (next: AiTab) => {
    setTab(next)
    try {
      localStorage.setItem(KEY_TAB, next)
    } catch {
      /* ignore */
    }
  }

  const reload = () => {
    requestAiRuntimeReload()
    void ensureAiRuntime()
  }

  const busy = generating || uiStatus === 'sending'
  const aiReady = uiStatus === 'ready'
  const aiLoading = uiStatus === 'loading'

  const generateEssay = useCallback(async () => {
    const topic = prompt.trim()
    if (!topic || generating || !aiReady) return

    setWriteError('')
    setDraft('')
    setGenerating(true)
    setUiStatus('sending')
    const ctl = new AbortController()
    abortRef.current = ctl

    try {
      await streamGenerate({
        messages: [
          { role: 'system', content: ESSAY_SYSTEM_PROMPT },
          {
            role: 'user',
            content: buildEssayUserPrompt(topic, ESSAY_LENGTH_LABELS[length], tone),
          },
        ],
        maxTokens: MAX_TOKENS[length],
        temperature: 0.75,
        topP: 0.92,
        signal: ctl.signal,
        onToken: (chunk) => setDraft((prev) => prev + chunk),
      })
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        setWriteError('Cancelled.')
      } else {
        setWriteError(friendlyAiError(e instanceof Error ? e.message : String(e)))
      }
    } finally {
      setGenerating(false)
      abortRef.current = null
      if (runtime?.phase === 'ready') setUiStatus('ready')
      else if (runtime?.phase === 'error') setUiStatus('error')
    }
  }, [aiReady, generating, length, prompt, runtime?.phase, tone])

  const messagesForSend = useCallback(
    (nextHistory: ChatTurn[]): ScribbleMessage[] => [
      { role: 'system', content: SCRIBBLE_CHAT_SYSTEM },
      ...nextHistory.map((t) => ({ role: t.role, content: t.content || t.notice || '…' })),
    ],
    [],
  )

  const sendChat = useCallback(async () => {
    const userText = chatInput.trim()
    if (!userText || uiStatus !== 'ready') return

    const turn: ChatTurn = { role: 'user', content: userText, ts: Date.now() }
    const nextHistory = [...history, turn]
    setHistory(nextHistory)
    saveHistory(nextHistory)
    setChatInput('')
    setChatError('')
    setStreaming('')
    setUiStatus('sending')

    const ctl = new AbortController()
    abortRef.current = ctl

    try {
      const acc = await streamGenerate({
        messages: messagesForSend(nextHistory),
        signal: ctl.signal,
        temperature: 0.65,
        topP: 0.92,
        maxTokens: 4096,
        onToken: (chunk) => setStreaming((prev) => prev + chunk),
      })
      const { text, task } = extractTask(acc)
      const reply: ChatTurn = { role: 'assistant', content: text, ts: Date.now() }
      if (task) {
        try {
          const created = createTask(userText, task)
          if (created) {
            reply.taskId = created.id
            if (!reply.content) reply.content = `On it: ${created.title}`
            startTask(created.id)
          }
        } catch (cause) {
          reply.notice = cause instanceof Error ? cause.message : 'That task could not start.'
        }
      }
      if (!reply.content && !reply.notice) reply.content = acc.trim()
      const final: ChatTurn[] = [...nextHistory, reply]
      setHistory(final)
      saveHistory(final)
      setStreaming('')
      setUiStatus('ready')
      setStatusDetail(runtime?.detail ?? `${SCRIBBLE_AI_NAME} is ready`)
    } catch (e) {
      setStreaming('')
      setUiStatus(runtime?.phase === 'error' ? 'error' : 'ready')
      if (e instanceof DOMException && e.name === 'AbortError') {
        setChatError('Cancelled.')
      } else {
        setChatError(friendlyAiError(e instanceof Error ? e.message : String(e)))
      }
    } finally {
      abortRef.current = null
    }
  }, [chatInput, history, messagesForSend, runtime?.detail, runtime?.phase, uiStatus])

  const stop = () => {
    abortRef.current?.abort()
    interruptScribbleGenerate()
  }

  const clearChat = () => {
    history.forEach((turn) => {
      if (turn.taskId) deleteTask(turn.taskId)
    })
    setHistory([])
    saveHistory([])
    setStreaming('')
    setChatError('')
    void resetScribbleChat()
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="shrink-0 space-y-3 border-b border-border/40 px-6 py-4">
        <div className="flex flex-wrap items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary">
            <Sparkles className="h-5 w-5" strokeWidth={2} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[15px] font-semibold text-foreground">{SCRIBBLE_AI_NAME}</h2>
              <StatusPill status={busy ? 'sending' : uiStatus} text={statusDetail} />
            </div>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{SCRIBBLE_AI_TAGLINE}</p>
            <p className="mt-2 inline-block rounded-lg border border-primary/35 bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary">
              {SCRIBBLE_PRIVATE_BADGE}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <TabButton active={tab === 'write'} onClick={() => switchTab('write')} icon={Wand2} label="Write" />
          <TabButton active={tab === 'chat'} onClick={() => switchTab('chat')} icon={MessageSquare} label="Chat" />
        </div>

        {aiLoading && (
          <div className="space-y-1.5 rounded-xl border border-border/55 bg-secondary/20 px-3 py-2.5" role="status" aria-live="polite">
            <div className="flex justify-between text-[11px] text-muted-foreground">
              <span>{loadLabel || 'Waking up Scribble AI…'}</span>
              <span>{Math.round(loadProgress * 100)}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full bg-primary transition-[width] duration-300"
                style={{ width: `${Math.min(100, Math.max(0, loadProgress * 100))}%` }}
              />
            </div>
          </div>
        )}

        {uiStatus === 'error' && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2.5" role="alert">
            <p className="text-[12px] text-destructive">{friendlyAiError(statusDetail)}</p>
            <Button type="button" size="sm" variant="secondary" className="h-7 rounded-lg" onClick={reload}>
              <RefreshCcw className="mr-1 h-3 w-3" strokeWidth={2} />
              Retry
            </Button>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-6 pb-6 pt-4">
        <div className="mx-auto flex max-w-4xl flex-col gap-4">
          {tab === 'write' ? (
            <WritePanel
              prompt={prompt}
              setPrompt={setPrompt}
              tone={tone}
              setTone={setTone}
              length={length}
              setLength={setLength}
              draft={draft}
              writeError={writeError}
              generating={generating}
              aiLoading={aiLoading}
              aiReady={aiReady}
              aiError={uiStatus === 'error'}
              onGenerate={() => void generateEssay()}
              onStop={stop}
              onRetry={reload}
              onSendToLive={onSendToLive}
            />
          ) : (
            <ChatPanel
              history={history}
              streaming={streaming}
              chatInput={chatInput}
              setChatInput={setChatInput}
              chatError={chatError}
              transcriptRef={transcriptRef}
              uiStatus={uiStatus}
              aiReady={aiReady}
              onSend={() => void sendChat()}
              onStop={stop}
              onClear={clearChat}
              onReload={reload}
              onSendToLive={onSendToLive}
            />
          )}
        </div>
      </div>
    </div>
  )
}

function TabButton({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: typeof Wand2
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex h-9 items-center gap-2 rounded-xl px-4 text-[13px] font-semibold transition-colors',
        active
          ? 'bg-primary text-primary-foreground shadow-[0_10px_24px_-12px_rgba(59,130,246,0.65)]'
          : 'border border-border/60 bg-secondary/40 text-muted-foreground hover:bg-secondary hover:text-foreground',
      )}
    >
      <Icon className="h-4 w-4" strokeWidth={2} />
      {label}
    </button>
  )
}

function WritePanel({
  prompt,
  setPrompt,
  tone,
  setTone,
  length,
  setLength,
  draft,
  writeError,
  generating,
  aiLoading,
  aiReady,
  aiError,
  onGenerate,
  onStop,
  onRetry,
  onSendToLive,
}: {
  prompt: string
  setPrompt: (v: string) => void
  tone: (typeof TONES)[number]
  setTone: (v: (typeof TONES)[number]) => void
  length: EssayLength
  setLength: (v: EssayLength) => void
  draft: string
  writeError: string
  generating: boolean
  aiLoading: boolean
  aiReady: boolean
  aiError: boolean
  onGenerate: () => void
  onStop: () => void
  onRetry: () => void
  onSendToLive?: (text: string) => void
}) {
  const blocked = !prompt.trim() || generating || aiLoading || !aiReady

  return (
    <>
      <Card className="space-y-4 border-border/60 p-5">
        <label className="block space-y-1.5">
          <span className="text-[12px] font-semibold text-muted-foreground">What should I write?</span>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={generating}
            rows={4}
            placeholder="e.g. Essay on climate change — causes, effects, and solutions"
            className="w-full resize-y rounded-xl border border-border/60 bg-secondary/30 p-3 text-[13px] leading-relaxed text-foreground outline-none ring-primary/30 focus:ring-2 disabled:opacity-60"
          />
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block space-y-1.5">
            <span className="text-[12px] font-semibold text-muted-foreground">Length</span>
            <select
              value={length}
              onChange={(e) => setLength(e.target.value as EssayLength)}
              disabled={generating}
              className="w-full rounded-xl border border-border/60 bg-secondary/30 px-3 py-2 text-[13px] text-foreground outline-none ring-primary/30 focus:ring-2 disabled:opacity-60"
            >
              {LENGTHS.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1.5">
            <span className="text-[12px] font-semibold text-muted-foreground">Tone</span>
            <select
              value={tone}
              onChange={(e) => setTone(e.target.value as (typeof TONES)[number])}
              disabled={generating}
              className="w-full rounded-xl border border-border/60 bg-secondary/30 px-3 py-2 text-[13px] text-foreground outline-none ring-primary/30 focus:ring-2 disabled:opacity-60"
            >
              {TONES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex flex-wrap gap-2">
          {!generating ? (
            <Button type="button" className="rounded-xl font-semibold" disabled={blocked} onClick={onGenerate}>
              <Sparkles className="mr-1.5 h-4 w-4" strokeWidth={2} />
              {aiLoading ? 'Starting…' : 'Generate'}
            </Button>
          ) : (
            <Button type="button" variant="destructive" className="rounded-xl" onClick={onStop}>
              <Square className="mr-1.5 h-4 w-4" strokeWidth={2} />
              Stop
            </Button>
          )}
          {aiError && (
            <Button type="button" variant="secondary" className="rounded-xl" onClick={onRetry}>
              Retry setup
            </Button>
          )}
        </div>

        {writeError && <p className="text-[13px] text-destructive">{writeError}</p>}
      </Card>

      {(draft || generating) && (
        <Card className="space-y-3 border-border/60 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-[14px] font-semibold text-foreground">Your draft</h3>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="rounded-lg"
                disabled={!draft.trim()}
                onClick={() => void navigator.clipboard.writeText(draft)}
              >
                <Copy className="mr-1 h-3.5 w-3.5" strokeWidth={2} />
                Copy
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="rounded-lg"
                disabled={!draft.trim() || generating}
                onClick={() => onSendToLive?.(draft)}
              >
                <Keyboard className="mr-1 h-3.5 w-3.5" strokeWidth={2} />
                To Live
              </Button>
            </div>
          </div>
          <div className="max-h-[min(52vh,520px)] min-h-[120px] overflow-y-auto whitespace-pre-wrap rounded-xl border border-border/60 bg-secondary/20 p-4 text-[13px] leading-relaxed text-foreground">
            {draft || (generating ? 'Writing…' : '')}
            {generating && (
              <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse rounded-sm bg-primary align-baseline" />
            )}
          </div>
        </Card>
      )}
    </>
  )
}

function ChatPanel({
  history,
  streaming,
  chatInput,
  setChatInput,
  chatError,
  transcriptRef,
  uiStatus,
  aiReady,
  onSend,
  onStop,
  onClear,
  onReload,
  onSendToLive,
}: {
  history: ChatTurn[]
  streaming: string
  chatInput: string
  setChatInput: (v: string) => void
  chatError: string
  transcriptRef: React.RefObject<HTMLDivElement | null>
  uiStatus: UiStatus
  aiReady: boolean
  onSend: () => void
  onStop: () => void
  onClear: () => void
  onReload: () => void
  onSendToLive?: (text: string) => void
}) {
  const sending = uiStatus === 'sending'
  const blocked = !chatInput.trim() || !aiReady || sending

  return (
    <Card className="flex min-h-[min(70vh,640px)] flex-col gap-3 border-border/60 p-5">
      <div className="flex shrink-0 items-center justify-between gap-3">
        <h3 className="text-[14px] font-semibold text-foreground">
          Chat <span className="text-muted-foreground">({history.length})</span>
        </h3>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="rounded-lg text-muted-foreground"
            onClick={onClear}
            disabled={history.length === 0 && !streaming}
          >
            <Trash2 className="mr-1 h-3.5 w-3.5" strokeWidth={2} />
            Clear
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-lg"
            disabled={uiStatus === 'loading'}
            onClick={onReload}
          >
            <RefreshCcw className="mr-1.5 h-3.5 w-3.5" strokeWidth={2} />
            Restart
          </Button>
        </div>
      </div>

      <div
        ref={transcriptRef}
        className="min-h-[200px] flex-1 overflow-y-auto rounded-xl border border-border/60 bg-secondary/20 p-3"
      >
        {history.length === 0 && !streaming ? (
          <p className="px-1 py-2 text-[12.5px] text-muted-foreground">
            Ask for help, brainstorm, or edit. You can also ask Scribble AI to do things, like “open my calendar” or “put this list into Live”.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {history.map((t, i) => (
              <MessageBubble
                key={`${t.ts}-${i}`}
                turn={t}
                onSendToLive={t.role === 'assistant' ? onSendToLive : undefined}
              />
            ))}
            {streaming && (
              <MessageBubble turn={{ role: 'assistant', content: visibleReply(streaming), ts: Date.now() }} isStreaming />
            )}
          </div>
        )}
      </div>

      <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-end">
        <textarea
          value={chatInput}
          onChange={(e) => setChatInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              onSend()
            }
          }}
          placeholder={`Message ${SCRIBBLE_AI_NAME}… (Ctrl+Enter)`}
          rows={3}
          disabled={sending}
          className="min-h-[72px] flex-1 resize-y rounded-xl border border-border/60 bg-secondary/30 p-3 text-[13px] leading-relaxed text-foreground outline-none ring-primary/30 focus:ring-2 disabled:opacity-60"
        />
        {!sending ? (
          <Button type="button" className="rounded-xl font-semibold sm:shrink-0" onClick={onSend} disabled={blocked}>
            <Send className="mr-1.5 h-4 w-4" strokeWidth={2} />
            Send
          </Button>
        ) : (
          <Button type="button" variant="destructive" className="rounded-xl sm:shrink-0" onClick={onStop}>
            <Square className="mr-1.5 h-4 w-4" strokeWidth={2} />
            Stop
          </Button>
        )}
      </div>

      {chatError && <p className="shrink-0 text-[13px] text-destructive">{chatError}</p>}
    </Card>
  )
}

function MessageBubble({
  turn,
  isStreaming = false,
  onSendToLive,
}: {
  turn: ChatTurn
  isStreaming?: boolean
  onSendToLive?: (text: string) => void
}) {
  const isUser = turn.role === 'user'
  const showLive = !isUser && !isStreaming && !turn.taskId && onSendToLive && turn.content.trim().length > 0

  return (
    <div className={`flex flex-col gap-1 ${isUser ? 'items-end' : 'items-start'}`}>
      <div
        className={`max-w-[90%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed ${
          isUser ? 'bg-primary/85 text-primary-foreground' : 'border border-border/55 bg-card text-foreground'
        }`}
      >
        {turn.content || (isStreaming ? '…' : '')}
        {isStreaming && (
          <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse rounded-sm bg-current align-baseline" />
        )}
      </div>
      {turn.notice && <p className="max-w-[90%] text-[12px] text-muted-foreground">{turn.notice}</p>}
      {turn.taskId && (
        <div className="w-full max-w-[90%]">
          <TaskCard taskId={turn.taskId} />
        </div>
      )}
      {showLive && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 rounded-lg px-2 text-[11px] text-muted-foreground"
          onClick={() => onSendToLive?.(turn.content)}
        >
          <Keyboard className="mr-1 h-3 w-3" strokeWidth={2} />
          To Live
        </Button>
      )}
    </div>
  )
}

function StatusPill({ status, text }: { status: UiStatus; text: string }) {
  const tone: Record<UiStatus, string> = {
    loading: 'bg-primary/12 text-primary border-primary/30',
    ready: 'bg-primary/12 text-primary border-primary/30',
    error: 'bg-destructive/12 text-destructive border-destructive/30',
    sending: 'bg-primary/12 text-primary border-primary/30',
  }
  const label: Record<UiStatus, string> = {
    loading: 'starting…',
    ready: 'ready',
    error: 'error',
    sending: 'working…',
  }
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${tone[status]}`}
      title={text}
    >
      {status === 'error' && <CircleAlert className="h-3 w-3 shrink-0" strokeWidth={2.5} />}
      <span>{label[status]}</span>
    </span>
  )
}
