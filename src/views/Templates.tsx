import { useState } from 'react'
import { Check, Copy, FilePlus2, Send, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { storageGetJson, storageSetJson } from '@/lib/storage'

interface Template {
  id: string
  title: string
  body: string
}

const TEMPLATE_KEY = 'scribble_templates_v1'
const PRESETS: Template[] = [
  {
    id: 'meeting-recap',
    title: 'Meeting recap email',
    body: `Hi everyone,\n\nQuick recap from today's sync:\n- …\n- …\n\nNext steps:\n1. …\n\nThanks,\n`,
  },
  {
    id: 'customer-follow-up',
    title: 'Customer follow-up',
    body: `Hi [Name],\n\nFollowing up on our conversation about …\n\nHappy to dive deeper whenever convenient.\n\nBest,\n`,
  },
  {
    id: 'bug-report',
    title: 'Bug report skeleton',
    body: `Summary:\nSteps:\n1.\n2.\n\nExpected:\nActual:\nLogs:\n`,
  },
  {
    id: 'ai-tone',
    title: 'Personal AI tone (paste into AI Core)',
    body: `Reply as a concise productivity copilot. Prefer short paragraphs and bullet lists.`,
  },
]

function loadTemplates(): Template[] {
  const parsed = storageGetJson<Template[] | null>(TEMPLATE_KEY, null)
  return Array.isArray(parsed) && parsed.length ? parsed : PRESETS
}

export function Templates({ onSendToLive }: { onSendToLive: (text: string) => void }) {
  const [templates, setTemplates] = useState(loadTemplates)
  const [copied, setCopied] = useState<string | null>(null)

  const persist = (next: Template[]) => {
    setTemplates(next)
    storageSetJson(TEMPLATE_KEY, next)
  }

  const copy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(id)
      window.setTimeout(() => setCopied(null), 1600)
    } catch {
      setCopied(null)
    }
  }

  const addTemplate = () => {
    persist([{ id: crypto.randomUUID(), title: 'New template', body: '' }, ...templates])
  }

  const updateTemplate = (id: string, patch: Partial<Template>) => {
    persist(templates.map((template) => (template.id === id ? { ...template, ...patch } : template)))
  }

  return (
    <div className="h-full min-h-0 overflow-auto px-6 pb-6">
      <div className="mx-auto grid max-w-4xl gap-4 py-2">
        <Card className="border-border/60 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-[15px] font-semibold text-foreground">Templates</h2>
              <p className="mt-1 text-[13px] text-muted-foreground">Reusable local drafts you can edit and send directly to Live.</p>
            </div>
            <Button type="button" size="sm" className="rounded-xl" onClick={addTemplate}>
              <FilePlus2 />
              New template
            </Button>
          </div>
        </Card>
        <div className="grid gap-4 md:grid-cols-2">
          {templates.map((template) => (
            <Card key={template.id} className="flex flex-col border-border/60 p-4">
              <div className="flex items-start justify-between gap-2">
                <input
                  value={template.title}
                  onChange={(event) => updateTemplate(template.id, { title: event.target.value })}
                  className="min-w-0 flex-1 bg-transparent text-[14px] font-semibold text-foreground outline-none"
                  aria-label="Template title"
                />
                <Button type="button" size="icon" variant="ghost" className="h-8 w-8 text-destructive" aria-label="Delete template" onClick={() => persist(templates.filter((item) => item.id !== template.id))}>
                  <Trash2 />
                </Button>
              </div>
              <textarea
                value={template.body}
                onChange={(event) => updateTemplate(template.id, { body: event.target.value })}
                placeholder="Write the reusable text…"
                className="mt-3 min-h-36 resize-y rounded-xl border border-border/50 bg-secondary/40 p-3 font-mono text-[11px] leading-relaxed text-foreground outline-none focus:ring-2 focus:ring-primary/30"
              />
              <div className="mt-3 flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="secondary" className="rounded-xl" onClick={() => void copy(template.id, template.body)}>
                  {copied === template.id ? <Check /> : <Copy />}
                  {copied === template.id ? 'Copied' : 'Copy'}
                </Button>
                <Button type="button" size="sm" className="rounded-xl" disabled={!template.body.trim()} onClick={() => onSendToLive(template.body)}>
                  <Send />
                  Send to Live
                </Button>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  )
}
