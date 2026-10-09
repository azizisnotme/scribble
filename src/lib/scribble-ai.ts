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

function today(): string {
  return new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
}

/** Chat / AI Core persona */
export function scribbleChatSystem(): string {
  return `You are ${SCRIBBLE_AI_NAME}, the personal assistant built into the Scribble desktop app on Windows. Today is ${today()}.

How you answer:
- You are part of Scribble — not ChatGPT, not Claude, not a generic "language model", and you never name outside AI products or model vendors.
- Think the problem through, then give the answer first. Be specific and correct; show working for math and logic.
- Use short paragraphs, bullet lists for steps, and code blocks for code.
- You help with writing, editing, brainstorming, studying, school or work documents, quizzes, tests, and assignments. Answer those completely. Do not refuse them.
- If you are not sure of a fact, say so briefly instead of inventing it.
- Match the person's tone unless they ask otherwise.

Scribble can also act on this computer: open apps and websites, type text into other windows, and press shortcut keys. If the person asks for that, reply with one short sentence and then a task block, for example:
\`\`\`task
{"title":"Poem in Notepad","steps":[{"tool":"open_app","input":"notepad"},{"tool":"wait","input":"3"},{"tool":"write","input":"A short poem about rain"},{"tool":"type_text","input":"{{written}}"}]}
\`\`\`
Never say you cannot use the computer.`
}

/** @deprecated Use scribbleChatSystem() so the date stays current. */
export const SCRIBBLE_CHAT_SYSTEM = scribbleChatSystem()

const PLANNER_TOOLS = `Tools:
- open_app: input is one app name: ${'notepad, word, excel, powerpoint, outlook, onenote, calculator, paint, file explorer, settings, chrome, edge, firefox, task manager, spotify, teams, microsoft store, photos, camera, clock'}.
- open_url: input is a full https:// link. Use it for websites and web apps. Useful links: new Google Doc https://docs.new, new Google Sheet https://sheets.new, new Google Slides https://slides.new, Gmail https://mail.google.com, YouTube search https://www.youtube.com/results?search_query=WORDS.
- search_web: input is the words to search for.
- wait: input is seconds to wait (1-30) for an app or page to finish loading.
- focus_window: input is a word from the title of an already open window, to switch to it.
- write: input is instructions for text Scribble AI should write (essay, email, answers, list, code). The result is saved for the next type_text step.
- type_text: input is the exact text to type into the active window. Use {{written}} for what the last write step produced, or {{last_reply}} for Scribble AI's previous chat answer.
- press_keys: input is shortcut keys such as ctrl+s, enter, tab, ctrl+a. Separate several with commas.
- to_live: input is text to put in Scribble's Live typewriter. Only use this when the person mentions Live.
- note: input is a short message to show the person.`

/** Turns one request into a plan of real computer actions. */
export function scribblePlannerSystem(): string {
  return `You are the planner inside ${SCRIBBLE_AI_NAME}, a Windows desktop assistant. Turn the person's request into actions Scribble will actually perform on their computer. Today is ${today()}.

Reply with JSON only. No other text. Use this shape:
{"title":"short title","reply":"one friendly sentence saying what you are doing","steps":[{"tool":"tool name","input":"value"}]}

${PLANNER_TOOLS}

Rules:
- Do the job; do not describe how to do it. Use the fewest steps that finish it.
- After open_app add a wait of 3 seconds; after open_url or search_web add a wait of 6 seconds before typing or pressing keys.
- When the person wants something written somewhere, use write and then type_text with {{written}}.
- Put everything the writer needs into the write input: topic, length, tone, format.
- If the request is only a question or a chat message and needs no action on the computer, return {"title":"","reply":"","steps":[]}.`
}

/** Short worked examples so small on-device models follow the plan format. */
export const PLANNER_EXAMPLES: Array<{ role: 'user' | 'assistant'; content: string }> = [
  { role: 'user', content: 'open notepad and write a short poem about rain' },
  {
    role: 'assistant',
    content:
      '{"title":"Rain poem in Notepad","reply":"Opening Notepad and writing your poem.","steps":[{"tool":"open_app","input":"notepad"},{"tool":"wait","input":"3"},{"tool":"write","input":"A short poem about rain, 8-12 lines"},{"tool":"type_text","input":"{{written}}"}]}',
  },
  { role: 'user', content: 'make a google doc with a 500 word essay on climate change' },
  {
    role: 'assistant',
    content:
      '{"title":"Climate change essay in Google Docs","reply":"Opening a new Google Doc and writing your essay there.","steps":[{"tool":"open_url","input":"https://docs.new"},{"tool":"wait","input":"8"},{"tool":"write","input":"A 500 word essay on climate change with a title, introduction, three body paragraphs, and a conclusion"},{"tool":"type_text","input":"{{written}}"}]}',
  },
  { role: 'user', content: 'look up the weather in chicago' },
  {
    role: 'assistant',
    content:
      '{"title":"Chicago weather","reply":"Searching for the weather in Chicago.","steps":[{"tool":"search_web","input":"weather in Chicago"}]}',
  },
  { role: 'user', content: 'what is the capital of france' },
  { role: 'assistant', content: '{"title":"","reply":"","steps":[]}' },
]

/** Messages that probably ask Scribble to act on the computer, not just answer. */
const ACTION_REQUEST =
  /\b(open|launch|start up|go to|navigate to|visit|search (?:for|up)|look up|google|type (?:it|this|that|out|in|into)|press|hit enter|save (?:it|this|the)|switch to|focus|play|put (?:it|this|that)|paste)\b|\b(?:in|into|on|inside) (?:a |the |my |an? new )?(?:notepad|word|microsoft word|excel|powerpoint|google docs?|docs|a doc|gmail|outlook|chrome|edge|firefox|the browser|onenote|live)\b|\b(?:make|create|start) (?:a |an |me a |me an )?(?:new )?(?:google )?(?:doc|document|spreadsheet|sheet|presentation|slides?)\b/i

export function looksLikeAction(message: string): boolean {
  return ACTION_REQUEST.test(message)
}

export interface PlannedTask {
  title?: string
  reply?: string
  steps?: Array<{ title?: string; tool?: string; input?: string }>
}

/** Pull the first balanced JSON object out of model output and parse it leniently. */
export function parsePlan(raw: string): PlannedTask | null {
  const text = raw.replace(/```(?:json|task)?/gi, '')
  const start = text.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escaped = false
  let end = -1
  for (let index = start; index < text.length; index += 1) {
    const ch = text[index]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) {
        end = index
        break
      }
    }
  }
  const body = end > 0 ? text.slice(start, end + 1) : text.slice(start)
  const attempts = [body, body.replace(/,\s*([}\]])/g, '$1'), `${body.replace(/,\s*$/, '')}]}`]
  for (const candidate of attempts) {
    try {
      const parsed = JSON.parse(candidate) as PlannedTask
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.steps)) return parsed
    } catch {
      /* try the next repair */
    }
  }
  return null
}

const SITES: Record<string, string> = {
  youtube: 'https://www.youtube.com',
  gmail: 'https://mail.google.com',
  'google docs': 'https://docs.new',
  'google doc': 'https://docs.new',
  'google sheets': 'https://sheets.new',
  'google slides': 'https://slides.new',
  'google drive': 'https://drive.google.com',
  'google calendar': 'https://calendar.google.com',
  google: 'https://www.google.com',
  netflix: 'https://www.netflix.com',
  amazon: 'https://www.amazon.com',
  reddit: 'https://www.reddit.com',
  twitter: 'https://x.com',
  facebook: 'https://www.facebook.com',
  instagram: 'https://www.instagram.com',
  wikipedia: 'https://www.wikipedia.org',
  canvas: 'https://canvas.instructure.com',
  'google classroom': 'https://classroom.google.com',
}

const APP_WORDS =
  /\b(notepad|microsoft word|word|excel|powerpoint|outlook|onenote|calculator|paint|file explorer|settings|chrome|edge|firefox|task manager|spotify|teams|microsoft store|photos|camera|clock)\b/i

/** Rule-based plan for common requests when the model's plan cannot be read. */
export function fallbackPlan(message: string): PlannedTask | null {
  const text = message.trim()
  const search = text.match(/\b(?:search(?: for| up)?|look up|google)\s+(.+)/i)
  const writeWhere = text.match(/\b(?:write|type|draft|make)\s+(.+?)\s+(?:in|into|on)\s+(?:a |the |my |an? new )?(notepad|microsoft word|word|google docs?|a doc|docs)\b/i)
  if (writeWhere) {
    const target = writeWhere[2].toLowerCase()
    const opener =
      /doc/.test(target)
        ? [{ tool: 'open_url', input: 'https://docs.new' }, { tool: 'wait', input: '8' }]
        : [{ tool: 'open_app', input: target.includes('word') ? 'word' : 'notepad' }, { tool: 'wait', input: target.includes('word') ? '6' : '3' }]
    return {
      title: `Write in ${target}`,
      reply: `Opening ${target} and writing it for you.`,
      steps: [...opener, { tool: 'write', input: writeWhere[1] }, { tool: 'type_text', input: '{{written}}' }],
    }
  }
  if (search) {
    return { title: `Search: ${search[1]}`, reply: `Searching for ${search[1]}.`, steps: [{ tool: 'search_web', input: search[1] }] }
  }
  const openMatch = text.match(/\b(?:open|launch|start|go to|visit)\s+(?:up\s+)?(.+)/i)
  if (openMatch) {
    const what = openMatch[1].replace(/[.!?]+$/, '').trim()
    const url = what.match(/https?:\/\/\S+/)?.[0] ?? (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(what) ? `https://${what}` : null)
    if (url) return { title: `Open ${what}`, reply: `Opening ${what}.`, steps: [{ tool: 'open_url', input: url }] }
    const site = Object.keys(SITES).find((name) => what.toLowerCase().includes(name))
    if (site) return { title: `Open ${site}`, reply: `Opening ${site}.`, steps: [{ tool: 'open_url', input: SITES[site] }] }
    const app = what.match(APP_WORDS)?.[1]
    if (app) return { title: `Open ${app}`, reply: `Opening ${app}.`, steps: [{ tool: 'open_app', input: app.toLowerCase() }] }
  }
  return null
}

/** Writer used by a task's write step. */
export const SCRIBBLE_TASK_WRITER_SYSTEM = `You are ${SCRIBBLE_AI_NAME}'s writer. Write exactly the text requested, ready to be typed straight into a document.
- Output only the finished text. No intro like "Here is", no notes, no markdown symbols such as ** or #.
- Follow the requested length, tone, and format.
- Do not refuse quizzes, tests, essays, or assignments.`

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
