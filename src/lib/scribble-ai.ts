/**
 * Scribble AI — product identity, prompts, and user-facing copy.
 * Inference runs on-device inside the app; this module is what users experience as "their" AI.
 */

export const SCRIBBLE_AI_NAME = 'Scribble AI'

export const SCRIBBLE_AI_TAGLINE =
  'Your private writing brain — built into Scribble, runs only on this computer, never sent to the cloud.'

/** Shown on AI screens — private, local, no account. Never mention API keys in the UI. */
export const SCRIBBLE_PRIVATE_BADGE = 'Private · On your PC · No sign-in'

/** @deprecated Use SCRIBBLE_PRIVATE_BADGE */
export const SCRIBBLE_NO_API_KEY_BADGE = SCRIBBLE_PRIVATE_BADGE

/** Chat / AI Core persona */
export const SCRIBBLE_CHAT_SYSTEM = `You are ${SCRIBBLE_AI_NAME}, the personal assistant built into the Scribble desktop app.

Rules:
- You are part of Scribble — not ChatGPT, not Claude, not a generic "language model", and you never name outside AI products or model vendors.
- Be helpful, clear, and direct. Use short paragraphs; use bullet lists for steps.
- You help with writing, typing workflows, editing, brainstorming, school or work documents, quizzes, tests, and assignments.
- Answer those requests completely. Do not refuse a quiz, test, essay, or assignment.
- If unsure, say so briefly instead of inventing facts.
- Match the user's tone unless they ask otherwise.

You can also do things on this computer. When the user asks you to open pages, put text into Live for typing, or carry out steps, reply with one short sentence and then a task block like this:
\`\`\`task
{"title":"Check email","steps":[{"title":"Open Gmail","tool":"open_url","input":"https://mail.google.com"},{"title":"Look for new mail","tool":"note","input":"Read the newest messages at the top of the inbox."}]}
\`\`\`
Tools:
- open_url: input is a full https link.
- type_text: input is the exact text to put into Live. The person presses F9 to type it into the focused window.
- note: input is a tip or finding to show the person.
Only add a task block when the user wants something done.`

export interface ExtractedTask {
  title?: string
  steps?: Array<{ title?: string; tool?: string; input?: string }>
}

const TASK_FENCE = /```\s*(?:task|json)?\s*(\{[\s\S]*?"steps"[\s\S]*\})\s*```/i
const TASK_START = /```\s*task|\{\s*"(?:title|steps)"/i

/** Split a chat reply into the text to show and the task block, if Scribble AI wrote one. */
export function extractTask(reply: string): { text: string; task: ExtractedTask | null } {
  const fenced = reply.match(TASK_FENCE)
  const start = fenced ? reply.indexOf(fenced[0]) : reply.search(TASK_START)
  if (start < 0) return { text: reply.trim(), task: null }
  const raw = fenced ? fenced[1] : reply.slice(start).match(/\{[\s\S]*\}/)?.[0]
  const text = (reply.slice(0, start) + (fenced ? reply.slice(start + fenced[0].length) : '')).trim()
  if (!raw) return { text: reply.trim(), task: null }
  try {
    const parsed = JSON.parse(raw) as ExtractedTask
    if (!Array.isArray(parsed.steps)) return { text: reply.trim(), task: null }
    return { text, task: parsed }
  } catch {
    return { text: reply.trim(), task: null }
  }
}

/** Hide a task block while it is still streaming in. */
export function visibleReply(partial: string): string {
  const start = partial.search(TASK_START)
  return (start < 0 ? partial : partial.slice(0, start)).trimEnd()
}

/** Essay / AI Writer persona */
export const SCRIBBLE_ESSAY_SYSTEM = `You are ${SCRIBBLE_AI_NAME}, Scribble's built-in writing engine.

The user gives a topic or assignment. Write the complete essay, answer set, or document they asked for.
- No meta commentary ("Here is your essay", "As an AI", etc.).
- No mention of other companies or models.
- Do not refuse quizzes, tests, or assignments.
- Clear paragraphs, appropriate length and tone for the request.`

export function buildEssayUserPrompt(topic: string, lengthLabel: string, tone: string): string {
  return `Write an essay on this topic.

Topic: ${topic.trim()}

Target length: ${lengthLabel}.
Tone: ${tone}.

Write the full essay now:`
}

export const ESSAY_LENGTH_LABELS = {
  short: 'about 300 words',
  medium: 'about 600 words',
  long: 'about 1000 words',
} as const

export type ScribbleEssayLength = keyof typeof ESSAY_LENGTH_LABELS

const VENDOR_NOISE =
  /api\s*key|apikey|api_key|hf_token|huggingface|openai\.com|bearer|unauthorized|invalid token|authentication required|401|403/i

/** Hide vendor/model names, URLs, and library auth noise from progress strings. */
export function sanitizeLoadProgress(raw: string): string {
  const t = raw.trim()
  if (!t || /https?:\/\//i.test(t) || /huggingface|openai|ollama|llama|mlc-ai/i.test(t)) {
    return 'Setting up Scribble AI (first time only)…'
  }
  if (VENDOR_NOISE.test(t)) {
    return 'Setting up Scribble AI (first time only)…'
  }
  if (/download|fetch|cache|load/i.test(t)) return 'Setting up Scribble AI (first time only)…'
  if (/complete|ready|finish/i.test(t)) return 'Almost ready…'
  return 'Waking up Scribble AI…'
}

/**
 * Never show raw library/network errors (they often mention Hugging Face or auth tokens).
 */
export function friendlyAiError(raw: string): string {
  const t = raw.trim()
  if (!t) return statusError()

  const lower = t.toLowerCase()
  if (VENDOR_NOISE.test(lower)) {
    return 'Scribble AI runs on your computer only. Setup could not finish — check your internet connection and tap Retry.'
  }
  if (/webgpu|gpu|webgl|adapter/.test(lower)) {
    return statusError(
      'Scribble AI needs GPU acceleration in this app. Update graphics drivers and Edge WebView2, then tap Retry.',
    )
  }
  if (/fetch|network|failed to load|download|enotfound|timed out|abort/i.test(lower)) {
    return 'Scribble AI could not finish its one-time setup. Check your internet connection and tap Retry.'
  }
  if (/llama|ollama|mlc|web-llm|webllm|openai|hugging/i.test(lower)) {
    return 'Scribble AI hit a setup error. Tap Retry.'
  }
  if (t.length > 140 || VENDOR_NOISE.test(t)) {
    return 'Scribble AI encountered an error. Tap Retry.'
  }
  return t
}

export function statusReady(): string {
  return `${SCRIBBLE_AI_NAME} is ready · private, on-device`
}

export function statusLoading(): string {
  return 'Waking up Scribble AI…'
}

export function statusError(hint?: string): string {
  return hint ?? `${SCRIBBLE_AI_NAME} could not start. Update GPU drivers / WebView2, then tap Retry.`
}
