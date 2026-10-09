import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tauri-apps/plugin-shell', () => ({ open: vi.fn() }))

import { createTask, deleteTask } from '@/lib/tasks'

describe('createTask', () => {
  beforeEach(() => localStorage.clear())

  it('maps tool aliases and gives each step a readable title', () => {
    const task = createTask('open notepad', {
      steps: [
        { tool: 'launch_app', input: 'notepad' },
        { tool: 'sleep', input: '3' },
        { tool: 'type', input: 'hello' },
      ],
    })
    expect(task?.steps.map((s) => s.tool)).toEqual(['open_app', 'wait', 'type_text'])
    expect(task?.steps[0].title).toBe('Open notepad')
    if (task) deleteTask(task.id)
  })

  it('adds a write step when the plan types written text without writing it', () => {
    const task = createTask('essay on dogs in notepad', {
      steps: [
        { tool: 'open_app', input: 'notepad' },
        { tool: 'type_text', input: '{{written}}' },
      ],
    })
    expect(task?.steps.map((s) => s.tool)).toEqual(['open_app', 'write', 'type_text'])
    if (task) deleteTask(task.id)
  })

  it('asks before sending or submitting', () => {
    const task = createTask('email it', { steps: [{ title: 'Send the email', tool: 'press_keys', input: 'ctrl+enter' }] })
    expect(task?.steps[0].sensitive).toBe(true)
    if (task) deleteTask(task.id)
  })
})
