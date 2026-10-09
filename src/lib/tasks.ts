import { open } from '@tauri-apps/plugin-shell'

import { streamGenerate } from '@/lib/ai-runtime'
import { policySnapshot } from '@/lib/app-policy'
import { focusHwnd, focusWindow, foregroundWindow, launchApp, pressKeys, type DesktopWindow } from '@/lib/desktop'
import { inTauri } from '@/lib/ipc'
import { pushTextToLiveBuffer } from '@/lib/live-buffer-bridge'
import { clampWpm, loadSavedWpm } from '@/lib/live-speed'
import { SCRIBBLE_TASK_WRITER_SYSTEM } from '@/lib/scribble-ai'
import {
  KEY_AUTO_REPAIR,
  KEY_MISTAKES,
  KEY_THINKING_PAUSES,
  startTypingSession,
  stopTypingSession,
  typingSessionSnapshot,
  waitForTypingSession,
} from '@/lib/typing-session'

export type TaskStatus = 'ready' | 'running' | 'paused' | 'awaiting' | 'completed' | 'cancelled' | 'blocked'
export type StepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped'
export type TaskToolId =
  | 'open_app'
  | 'open_url'
  | 'search_web'
  | 'wait'
  | 'focus_window'
  | 'write'
  | 'type_text'
  | 'press_keys'
  | 'to_live'
  | 'note'
  | 'confirm'

export interface TaskStep {
  id: string
  title: string
  tool: TaskToolId
  input: string
  sensitive: boolean
  approved: boolean
  status: StepStatus
  attempts: number
  result: string
  error: string
}

export interface ScribbleTask {
  id: string
  instruction: string
  title: string
  status: TaskStatus
  steps: TaskStep[]
  cursor: number
  result: string
  createdAt: string
  updatedAt: string
  /** Text the last write step produced, typed by {{written}}. */
  written?: string
  /** Scribble AI's previous chat answer, typed by {{last_reply}}. */
  context?: string
  /** Window the task opened or switched to; typing and keys go here. */
  targetHwnd?: number
  targetTitle?: string
}

export interface TaskDraft {
  title?: string
  steps?: Array<{ title?: string; tool?: string; input?: string }>
}

const STORAGE_KEY = 'scribble_tasks_v1'
const SENSITIVE = /\b(submit|turn in|hand in|send|email|message|delete|remove|purchase|buy|pay|order|checkout)\b/i
const TOOLS = new Set<TaskToolId>([
  'open_app',
  'open_url',
  'search_web',
  'wait',
  'focus_window',
  'write',
  'type_text',
  'press_keys',
  'to_live',
  'note',
  'confirm',
])
const TOOL_ALIASES: Record<string, TaskToolId> = {
  launch_app: 'open_app',
  open_application: 'open_app',
  open_website: 'open_url',
  browse: 'open_url',
  search: 'search_web',
  google: 'search_web',
  sleep: 'wait',
  switch_window: 'focus_window',
  generate: 'write',
  compose: 'write',
  type: 'type_text',
  keys: 'press_keys',
  hotkey: 'press_keys',
  shortcut: 'press_keys',
  live: 'to_live',
  message: 'note',
}
const NO_RETRY = new Set<TaskToolId>(['type_text', 'press_keys', 'open_app', 'open_url', 'search_web'])
const MAX_HISTORY = 200
const MAX_ATTEMPTS = 3
const WINDOW_WAIT_MS = 15_000
const UNTARGETED_TYPING_DELAY_MS = 5_000

let tasks: ScribbleTask[] = load()
let activeId: string | null = tasks.find((task) => task.status === 'paused' || task.status === 'awaiting')?.id ?? null
const listeners = new Set<() => void>()
let pauseFlag = false
let cancelFlag = false
let runningId: string | null = null
let typingAsAdmin = false

/** Admins skip the app owner's typing rules, the same as in Live. */
export function setTaskTypingAccess(isAdmin: boolean) {
  typingAsAdmin = isAdmin
}

function load(): ScribbleTask[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') as ScribbleTask[]
    if (!Array.isArray(parsed)) return []
    return parsed.map((task) => {
      if (task.status === 'running') {
        task.status = 'paused'
        task.steps.forEach((item) => {
          if (item.status === 'running') item.status = 'pending'
        })
      }
      if ((task.status as string) === 'planning') {
        task.status = 'blocked'
        task.result = 'Scribble closed before this task was ready. Ask Scribble AI again.'
      }
      return task
    })
  } catch {
    return []
  }
}

function uid() {
  return crypto.randomUUID()
}

let snapshot: { tasks: ScribbleTask[]; activeId: string | null; runningId: string | null } = { tasks, activeId, runningId }

function emit() {
  snapshot = { tasks, activeId, runningId }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks.slice(0, MAX_HISTORY)))
  listeners.forEach((listener) => listener())
}

function touch(task: ScribbleTask) {
  task.updatedAt = new Date().toISOString()
  tasks = tasks.map((item) => (item.id === task.id ? task : item))
  emit()
}

export function subscribeTasks(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function taskSnapshot() {
  return snapshot
}

function defaultTitle(tool: TaskToolId, input: string): string {
  const short = input.length > 48 ? `${input.slice(0, 45)}…` : input
  switch (tool) {
    case 'open_app':
      return `Open ${short}`
    case 'open_url':
      return `Open ${short.replace(/^https?:\/\//, '')}`
    case 'search_web':
      return `Search for “${short}”`
    case 'wait':
      return `Wait ${input || '2'} seconds`
    case 'focus_window':
      return `Switch to ${short}`
    case 'write':
      return `Write: ${short}`
    case 'type_text':
      return /\{\{\s*(written|last_reply)\s*\}\}/.test(input) ? 'Type it out' : `Type “${short}”`
    case 'press_keys':
      return `Press ${short}`
    case 'to_live':
      return 'Put text in Live'
    case 'confirm':
      return 'Check with you'
    default:
      return 'Note'
  }
}

function step(title: string, tool: TaskToolId, input: string): TaskStep {
  const checked = tool === 'type_text' || tool === 'write' ? title : `${title} ${input}`
  return {
    id: uid(),
    title: title || defaultTitle(tool, input),
    tool,
    input,
    sensitive: tool === 'confirm' || SENSITIVE.test(checked),
    approved: false,
    status: 'pending',
    attempts: 0,
    result: '',
    error: '',
  }
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

async function waitInterruptibly(ms: number) {
  const until = Date.now() + ms
  while (Date.now() < until) {
    if (cancelFlag) return
    await wait(Math.min(200, until - Date.now()))
  }
}

/** After opening something, wait for its window to come to the front and remember it. */
async function adoptForegroundWindow(task: ScribbleTask, hint: string, previous: DesktopWindow | null) {
  const wanted = hint.trim().toLowerCase()
  const until = Date.now() + WINDOW_WAIT_MS
  while (Date.now() < until && !cancelFlag) {
    const current = await foregroundWindow().catch(() => null)
    const fresh = current && (!previous || current.hwnd !== previous.hwnd || current.title !== previous.title)
    if (current && (wanted ? current.title.toLowerCase().includes(wanted) : fresh)) {
      task.targetHwnd = current.hwnd
      task.targetTitle = current.title
      return current
    }
    await wait(300)
  }
  return null
}

function resolveText(task: ScribbleTask, input: string): string {
  return input
    .replace(/\{\{\s*written\s*\}\}/gi, task.written ?? '')
    .replace(/\{\{\s*last_reply\s*\}\}/gi, task.context ?? '')
    .replace(/\\n/g, '\n')
}

function cleanWriting(text: string): string {
  return text
    .replace(/^\s*(?:sure|okay|ok|certainly)[^\n]*\n+/i, '')
    .replace(/^\s*here(?:'s| is)[^\n]*:\s*\n+/i, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .trim()
}

function readFlag(key: string): string {
  try {
    return localStorage.getItem(key) ?? ''
  } catch {
    return ''
  }
}

async function typeIntoTarget(task: ScribbleTask, text: string): Promise<string> {
  if (!text.trim()) throw new Error('There is nothing to type yet. Add a write step first.')
  const policy = policySnapshot()
  if (!typingAsAdmin && (!policy.typingOn || policy.readOnly)) {
    throw new Error('Typing is turned off for this account by the app owner.')
  }
  if (typingSessionSnapshot().running) await waitForTypingSession()
  const payload = !typingAsAdmin && policy.maxChars > 0 ? text.slice(0, policy.maxChars) : text
  const saved = loadSavedWpm()
  const speed = !typingAsAdmin && policy.defaultWpm > 0 ? policy.defaultWpm : saved
  const wpm = clampWpm(!typingAsAdmin && policy.maxWpm > 0 ? Math.min(speed, policy.maxWpm) : speed)

  let hwnd = task.targetHwnd ?? 0
  if (hwnd && !(await focusHwnd(hwnd))) {
    const again = task.targetTitle ? await focusWindow(task.targetTitle).catch(() => null) : null
    hwnd = again?.hwnd ?? 0
    task.targetHwnd = hwnd || undefined
  }
  await startTypingSession(payload, {
    wpm,
    startDelayMs: hwnd ? 400 : UNTARGETED_TYPING_DELAY_MS,
    targetWindowHwnd: hwnd,
    autoRepair: policy.forceRepair || readFlag(KEY_AUTO_REPAIR) !== '0',
    mistakesEnabled: policy.allowTypos && readFlag(KEY_MISTAKES) === '1',
    thinkingPauses: policy.allowPauses && readFlag(KEY_THINKING_PAUSES) === '1',
    mistakeChance: 0.02,
  })
  const reason = await waitForTypingSession()
  if (reason === 'cancelled') throw new Error('Typing was stopped.')
  if (reason === 'error') throw new Error(typingSessionSnapshot().error || 'Typing could not finish. Click the window you want and press Retry.')
  const where = task.targetTitle ? ` into ${task.targetTitle}` : ''
  return `Typed ${payload.trim().split(/\s+/).length} words${where}.`
}

async function openLink(task: ScribbleTask, url: string): Promise<string> {
  if (!/^https?:\/\//i.test(url)) throw new Error('Only http and https links can be opened.')
  if (!inTauri) {
    window.open(url, '_blank', 'noopener')
    return `Opened ${url}`
  }
  const before = await foregroundWindow().catch(() => null)
  await open(url)
  const opened = await adoptForegroundWindow(task, '', before)
  return opened ? `Opened ${url} in ${opened.title}` : `Opened ${url}`
}

async function runTool(task: ScribbleTask, current: TaskStep): Promise<string> {
  const input = current.input.trim()
  switch (current.tool) {
    case 'open_app': {
      const before = await foregroundWindow().catch(() => null)
      const launched = await launchApp(input)
      const opened = await adoptForegroundWindow(task, launched.window_hint, before)
      return opened ? `Opened ${opened.title}` : `Started ${launched.name}`
    }
    case 'open_url':
      return openLink(task, /^https?:\/\//i.test(input) ? input : `https://${input}`)
    case 'search_web':
      return openLink(task, `https://www.google.com/search?q=${encodeURIComponent(input)}`)
    case 'wait': {
      const seconds = Math.min(30, Math.max(0.5, Number.parseFloat(input) || 2))
      await waitInterruptibly(seconds * 1000)
      return `Waited ${seconds} seconds.`
    }
    case 'focus_window': {
      const found = await focusWindow(input)
      task.targetHwnd = found.hwnd
      task.targetTitle = found.title
      return `Switched to ${found.title}`
    }
    case 'write': {
      const text = await streamGenerate({
        messages: [
          { role: 'system', content: SCRIBBLE_TASK_WRITER_SYSTEM },
          { role: 'user', content: resolveText(task, input) },
        ],
        temperature: 0.7,
        topP: 0.9,
        maxTokens: 3072,
      })
      task.written = cleanWriting(text)
      const words = task.written.split(/\s+/).filter(Boolean).length
      return `Wrote ${words} words.`
    }
    case 'type_text':
      return typeIntoTarget(task, resolveText(task, current.input))
    case 'press_keys':
      await pressKeys(input, task.targetHwnd)
      return `Pressed ${input}`
    case 'to_live':
      pushTextToLiveBuffer(resolveText(task, current.input))
      return 'The text is in Live. Press F9 when you want Scribble to type it.'
    case 'confirm':
      return input || 'Confirmed.'
    default:
      return input
  }
}

async function execute(taskId: string) {
  if (runningId) return
  const task = tasks.find((item) => item.id === taskId)
  if (!task) return
  runningId = taskId
  pauseFlag = false
  cancelFlag = false
  try {
    task.status = 'running'
    touch(task)
    for (let index = task.cursor; index < task.steps.length; index += 1) {
      while (pauseFlag && !cancelFlag) {
        if (task.status !== 'paused') {
          task.status = 'paused'
          touch(task)
        }
        await wait(200)
      }
      if (cancelFlag) {
        task.status = 'cancelled'
        task.result = 'Cancelled.'
        touch(task)
        return
      }
      if (task.status !== 'running') {
        task.status = 'running'
        touch(task)
      }
      const current = task.steps[index]
      if (current.status === 'done' || current.status === 'skipped') continue
      if (current.sensitive && !current.approved) {
        task.status = 'awaiting'
        task.cursor = index
        current.status = 'pending'
        touch(task)
        return
      }
      current.status = 'running'
      task.cursor = index
      touch(task)
      try {
        current.result = await runTool(task, current)
        if (cancelFlag) continue
        current.status = 'done'
        current.error = ''
      } catch (error) {
        current.attempts += 1
        current.error = error instanceof Error ? error.message : 'That step failed.'
        if (!cancelFlag && !NO_RETRY.has(current.tool) && current.attempts < MAX_ATTEMPTS) {
          current.status = 'pending'
          index -= 1
          touch(task)
          await wait(500 * current.attempts)
          continue
        }
        current.status = 'failed'
        task.status = cancelFlag ? 'cancelled' : 'blocked'
        task.result = cancelFlag ? 'Cancelled.' : current.error
        touch(task)
        return
      }
      touch(task)
    }
    if (cancelFlag) {
      task.status = 'cancelled'
      task.result = 'Cancelled.'
      touch(task)
      return
    }
    task.status = 'completed'
    task.cursor = task.steps.length
    task.result = task.steps.map((item) => item.result).filter(Boolean).join('\n')
    touch(task)
  } finally {
    runningId = null
    emit()
  }
}

function toolFrom(raw: string | undefined): TaskToolId {
  const name = (raw ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (TOOLS.has(name as TaskToolId)) return name as TaskToolId
  return TOOL_ALIASES[name] ?? 'note'
}

/** Build a task from steps Scribble AI wrote. Returns null when the steps are unusable. */
export function createTask(instruction: string, draft: TaskDraft, context = ''): ScribbleTask | null {
  const text = instruction.trim()
  const steps = (draft.steps ?? [])
    .map((item) => {
      const tool = toolFrom(item.tool)
      const input = String(item.input ?? '').trim()
      return step(item.title?.trim() || '', tool, input)
    })
    .filter((item) => item.input || item.tool === 'confirm')
  if (steps.length === 0) return null
  const typesWritten = steps.some((item) => item.tool === 'type_text' && /\{\{\s*written\s*\}\}/i.test(item.input))
  const writes = steps.some((item) => item.tool === 'write')
  if (typesWritten && !writes) {
    const at = steps.findIndex((item) => item.tool === 'type_text')
    steps.splice(at, 0, step('', 'write', text))
  }
  const now = new Date().toISOString()
  const task: ScribbleTask = {
    id: uid(),
    instruction: text,
    title: draft.title?.trim() || text.slice(0, 80) || 'Task',
    status: 'ready',
    steps,
    cursor: 0,
    result: '',
    createdAt: now,
    updatedAt: now,
    context,
  }
  tasks = [task, ...tasks].slice(0, MAX_HISTORY)
  activeId = task.id
  emit()
  return task
}

export function startTask(id: string) {
  const task = tasks.find((item) => item.id === id)
  if (!task || runningId) return
  if (task.status === 'completed' || task.status === 'cancelled') return
  activeId = id
  const current = task.steps[task.cursor]
  if (task.status === 'blocked' && current?.status === 'failed') {
    current.status = 'pending'
    current.attempts = 0
    current.error = ''
  }
  void execute(id)
}

export function rerunTask(id: string) {
  const task = tasks.find((item) => item.id === id)
  if (!task || runningId) return
  task.steps.forEach((item) => {
    item.status = 'pending'
    item.approved = false
    item.attempts = 0
    item.result = ''
    item.error = ''
  })
  task.cursor = 0
  task.result = ''
  task.written = undefined
  task.targetHwnd = undefined
  task.targetTitle = undefined
  task.status = 'ready'
  touch(task)
  startTask(id)
}

export function deleteTask(id: string) {
  if (runningId === id) return
  tasks = tasks.filter((item) => item.id !== id)
  if (activeId === id) activeId = null
  emit()
}

export function pauseTask(id: string) {
  if (runningId === id) pauseFlag = true
}

export function resumeTask(id: string) {
  if (runningId === id) {
    pauseFlag = false
    return
  }
  startTask(id)
}

export function cancelTask(id: string) {
  const task = tasks.find((item) => item.id === id)
  if (!task) return
  if (runningId === id) {
    cancelFlag = true
    if (task.steps[task.cursor]?.tool === 'type_text') void stopTypingSession()
    return
  }
  task.status = 'cancelled'
  task.result = 'Cancelled.'
  touch(task)
}

export function approveStep(id: string) {
  const task = tasks.find((item) => item.id === id)
  const current = task?.steps[task.cursor]
  if (!task || !current) return
  current.approved = true
  startTask(id)
}

export function approveRemaining(id: string) {
  const task = tasks.find((item) => item.id === id)
  if (!task) return
  task.steps.slice(task.cursor).forEach((item) => {
    if (item.status === 'pending') item.approved = true
  })
  startTask(id)
}

export function skipStep(id: string) {
  const task = tasks.find((item) => item.id === id)
  const current = task?.steps[task.cursor]
  if (!task || !current || runningId === id) return
  current.status = 'skipped'
  current.result = 'Skipped.'
  task.cursor += 1
  touch(task)
  startTask(id)
}
