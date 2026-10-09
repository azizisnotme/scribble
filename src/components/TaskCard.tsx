import { useSyncExternalStore } from 'react'
import { Check, CheckCheck, ListTodo, Pause, Play, RotateCcw, Square, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  approveRemaining,
  approveStep,
  cancelTask,
  pauseTask,
  rerunTask,
  resumeTask,
  skipStep,
  startTask,
  subscribeTasks,
  taskSnapshot,
  type ScribbleTask,
  type StepStatus,
} from '@/lib/tasks'

const STATUS_LABEL: Record<ScribbleTask['status'], string> = {
  ready: 'Ready',
  running: 'Running',
  paused: 'Paused',
  awaiting: 'Needs you',
  completed: 'Done',
  cancelled: 'Cancelled',
  blocked: 'Blocked',
}

const STEP_LABEL: Record<StepStatus, string> = {
  pending: 'Waiting',
  running: 'Doing this now',
  done: 'Done',
  failed: 'Failed',
  skipped: 'Skipped',
}

export function TaskCard({ taskId }: { taskId: string }) {
  const { tasks, runningId } = useSyncExternalStore(subscribeTasks, taskSnapshot, taskSnapshot)
  const task = tasks.find((item) => item.id === taskId)

  if (!task) {
    return <p className="text-[12px] text-muted-foreground">This task was removed.</p>
  }

  const otherRunning = runningId !== null && runningId !== task.id
  const finished = task.status === 'completed' || task.status === 'cancelled'

  return (
    <div className="w-full space-y-3 rounded-2xl border border-border/60 bg-secondary/20 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <ListTodo className="h-4 w-4 shrink-0 text-primary" />
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold">{task.title}</p>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">{STATUS_LABEL[task.status]}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {finished ? (
            <Button type="button" size="sm" variant="outline" className="h-7 rounded-lg" disabled={otherRunning} onClick={() => rerunTask(task.id)}>
              <RotateCcw className="h-3.5 w-3.5" /> Run again
            </Button>
          ) : task.status === 'running' ? (
            <Button type="button" size="sm" variant="outline" className="h-7 rounded-lg" onClick={() => pauseTask(task.id)}>
              <Pause className="h-3.5 w-3.5" /> Pause
            </Button>
          ) : task.status === 'paused' ? (
            <Button type="button" size="sm" variant="outline" className="h-7 rounded-lg" disabled={otherRunning} onClick={() => resumeTask(task.id)}>
              <Play className="h-3.5 w-3.5" /> Resume
            </Button>
          ) : task.status !== 'awaiting' ? (
            <Button type="button" size="sm" className="h-7 rounded-lg" disabled={otherRunning} onClick={() => startTask(task.id)}>
              <Play className="h-3.5 w-3.5" /> {task.status === 'blocked' ? 'Retry' : 'Start'}
            </Button>
          ) : null}
          {!finished && (
            <Button type="button" size="sm" variant="ghost" className="h-7 rounded-lg text-destructive" onClick={() => cancelTask(task.id)}>
              <Square className="h-3.5 w-3.5" /> Cancel
            </Button>
          )}
        </div>
      </div>

      <ol className="space-y-1.5">
        {task.steps.map((item, index) => (
          <li key={item.id} className={cn('rounded-xl border px-3 py-2', item.status === 'running' ? 'border-primary/50 bg-primary/10' : 'border-border/60')}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[12.5px] font-medium">
                  {index + 1}. {item.title}
                </p>
                <p className="mt-0.5 break-all text-[11.5px] text-muted-foreground">
                  {STEP_LABEL[item.status]}
                  {item.sensitive ? ' · asks you first' : ''}
                  {item.tool === 'open_url' ? ` · ${item.input}` : ''}
                </p>
                {item.result && <p className="mt-1 text-[12.5px]">{item.result}</p>}
                {item.tool === 'write' && item.status === 'done' && task.written && (
                  <details className="mt-1 text-[12px] text-muted-foreground">
                    <summary className="cursor-pointer select-none">Show what Scribble wrote</summary>
                    <p className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border/50 bg-background/40 p-2 text-foreground">
                      {task.written}
                    </p>
                  </details>
                )}
                {item.tool === 'type_text' && item.status === 'running' && !task.targetHwnd && (
                  <p className="mt-1 text-[12px] text-primary">Click the spot where Scribble should type. Typing starts in 5 seconds.</p>
                )}
                {item.error && <p className="mt-1 text-[12.5px] text-destructive">{item.error}</p>}
              </div>
              {item.status === 'done' && <Check className="h-4 w-4 shrink-0 text-primary" />}
            </div>
            {task.status === 'awaiting' && index === task.cursor && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Button type="button" size="sm" className="h-7 rounded-lg" disabled={otherRunning} onClick={() => approveStep(task.id)}>
                  Approve
                </Button>
                {task.steps.slice(index + 1).some((later) => later.sensitive && later.status === 'pending') && (
                  <Button type="button" size="sm" variant="outline" className="h-7 rounded-lg" disabled={otherRunning} onClick={() => approveRemaining(task.id)}>
                    <CheckCheck className="h-3.5 w-3.5" /> Approve all remaining
                  </Button>
                )}
                <Button type="button" size="sm" variant="ghost" className="h-7 rounded-lg" disabled={otherRunning} onClick={() => skipStep(task.id)}>
                  <X className="h-3.5 w-3.5" /> Skip
                </Button>
              </div>
            )}
          </li>
        ))}
      </ol>

      {task.result && task.status === 'blocked' && <p className="text-[12.5px] text-destructive">{task.result}</p>}
    </div>
  )
}
