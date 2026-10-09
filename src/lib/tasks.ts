import { open } from '@tauri-apps/plugin-shell'

import { inTauri } from '@/lib/ipc'
import { pushTextToLiveBuffer } from '@/lib/live-buffer-bridge'

export type TaskStatus = 'ready' | 'running' | 'paused' | 'awaiting' | 'completed' | 'cancelled' | 'blocked'
export type StepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped'
export type TaskToolId = 'open_url' | 'note' | 'confirm' | 'type_text'

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
}

export interface TaskDraft {
  title?: string
  steps?: Array<{ title?: string; tool?: string; input?: string }>
}

const STORAGE_KEY = 'scribble_tasks_v1'
const SENSITIVE = /\b(submit|turn in|hand in|send|email|message|delete|remove|purchase|buy|pay|order|checkout)\b/i
const TOOLS = new Set<TaskToolId>(['open_url', 'note', 'confirm', 'type_text'])
const MAX_HISTORY = 200
const MAX_ATTEMPTS = 3

let tasks: ScribbleTask[] = load()
let activeId: string | null = tasks.find((task) => task.status === 'paused' || task.status === 'awaiting')?.id ?? null
const listeners = new Set<() => void>()
let pauseFlag = false
let cancelFlag = false
let runningId: string | null = null

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

function step(title: string, tool: TaskToolId, input: string): TaskStep {
  return {
    id: uid(),
    title,
    tool,
    input,
    sensitive: tool === 'confirm' || SENSITIVE.test(`${title} ${tool === 'type_text' ? '' : input}`),
    approved: false,
    status: 'pending',
    attempts: 0,
    result: '',
    error: '',
  }
}

async function runTool(current: TaskStep): Promise<string> {
  if (current.tool === 'open_url') {
    const url = current.input.trim()
    if (!/^https?:\/\//i.test(url)) throw new Error('Only http and https links can be opened.')
    if (!inTauri) {
      window.open(url, '_blank', 'noopener')
      return `Opened ${url}`
    }
    await open(url)
    return `Opened ${url}`
  }
  if (current.tool === 'type_text') {
    pushTextToLiveBuffer(current.input)
    return 'The text is in Live. Focus the document and press F9 when you want Scribble to type it.'
  }
  if (current.tool === 'confirm') return current.input || 'Confirmed.'
  return current.input
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
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
        current.result = await runTool(current)
        current.status = 'done'
        current.error = ''
      } catch (error) {
        current.attempts += 1
        current.error = error instanceof Error ? error.message : 'That step failed.'
        if (current.attempts < MAX_ATTEMPTS) {
          current.status = 'pending'
          index -= 1
          touch(task)
          await wait(500 * current.attempts)
          continue
        }
        current.status = 'failed'
        task.status = 'blocked'
        task.result = current.error
        touch(task)
        return
      }
      touch(task)
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

/** Build a task from steps Scribble AI wrote. Returns null when the steps are unusable. */
export function createTask(instruction: string, draft: TaskDraft): ScribbleTask | null {
  const text = instruction.trim()
  const steps = (draft.steps ?? [])
    .map((item) => {
      const tool = TOOLS.has(item.tool as TaskToolId) ? (item.tool as TaskToolId) : 'note'
      const title = item.title?.trim() || 'Step'
      const input = item.input?.trim() || ''
      return step(title, tool, input)
    })
    .filter((item) => item.input || item.tool === 'confirm')
  if (steps.length === 0) return null
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
