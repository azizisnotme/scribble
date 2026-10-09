import { useMemo, useState } from 'react'
import { CopyPlus, Download, FilePlus2, Search, Send, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { storageGetJson, storageSetJson } from '@/lib/storage'

const NOTES_KEY = 'scribble_scribbles_v1'

interface Note {
  id: string
  title: string
  body: string
  updated: string
}

function loadNotes(): Note[] {
  const parsed = storageGetJson<Note[]>(NOTES_KEY, [])
  return Array.isArray(parsed) ? parsed : []
}

function saveNotes(n: Note[]) {
  if (!storageSetJson(NOTES_KEY, n)) throw new Error('save failed')
}

export function Scribbles({ onSendToLive }: { onSendToLive: (text: string) => void }) {
  const [notes, setNotes] = useState<Note[]>(() => loadNotes())
  const [activeId, setActiveId] = useState<string | null>(() => loadNotes()[0]?.id ?? null)
  const [query, setQuery] = useState('')
  const [saveError, setSaveError] = useState<string | null>(null)

  const active = useMemo(() => notes.find((n) => n.id === activeId) ?? null, [notes, activeId])
  const visibleNotes = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return notes
    return notes.filter((note) => `${note.title}\n${note.body}`.toLowerCase().includes(needle))
  }, [notes, query])

  const persist = (next: Note[]) => {
    try {
      saveNotes(next)
      setNotes(next)
      setSaveError(null)
    } catch {
      setSaveError('Could not save. Export important notes and free some local storage.')
    }
  }

  const addNote = () => {
    const id = crypto.randomUUID()
    const note: Note = {
      id,
      title: 'Untitled scribble',
      body: '',
      updated: new Date().toISOString(),
    }
    persist([note, ...notes])
    setActiveId(id)
  }

  const updateActive = (patch: Partial<Pick<Note, 'title' | 'body'>>) => {
    if (!active) return
    const next = notes.map((n) =>
      n.id === active.id ? { ...n, ...patch, updated: new Date().toISOString() } : n,
    )
    persist(next)
  }

  const deleteActive = () => {
    if (!active) return
    const next = notes.filter((n) => n.id !== active.id)
    persist(next)
    setActiveId(next[0]?.id ?? null)
  }

  const duplicateActive = () => {
    if (!active) return
    const copy = { ...active, id: crypto.randomUUID(), title: `${active.title} copy`, updated: new Date().toISOString() }
    persist([copy, ...notes])
    setActiveId(copy.id)
  }

  const exportActive = () => {
    if (!active) return
    const blob = new Blob([active.body], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${(active.title || 'scribble').replace(/[^\w.-]+/g, '_')}.txt`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-4 px-6 pb-6 lg:grid-cols-[260px_minmax(0,1fr)]">
      <Card className="flex max-h-full flex-col overflow-hidden border-border/60 p-3">
        <div className="mb-3 flex items-center justify-between gap-2 px-1">
          <span className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">Library</span>
          <Button type="button" size="sm" variant="secondary" className="h-8 rounded-lg gap-1 px-2 text-[12px]" onClick={addNote}>
            <FilePlus2 className="h-3.5 w-3.5" strokeWidth={2} />
            New
          </Button>
        </div>
        <label className="mb-3 flex h-9 items-center gap-2 rounded-xl border border-border/60 bg-background/40 px-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search scribbles"
            className="min-w-0 flex-1 bg-transparent text-[12px] text-foreground outline-none"
          />
        </label>
        <div className="min-h-0 flex-1 space-y-1 overflow-auto pr-1">
          {notes.length === 0 && (
            <p className="px-2 py-6 text-center text-[12px] text-muted-foreground">No scribbles yet — create one.</p>
          )}
          {visibleNotes.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => setActiveId(n.id)}
              className={`flex w-full flex-col rounded-xl border px-3 py-2.5 text-left text-[13px] transition-colors ${
                n.id === activeId
                  ? 'border-primary/50 bg-primary/12 text-foreground'
                  : 'border-transparent bg-secondary/40 text-muted-foreground hover:bg-secondary/70 hover:text-foreground'
              }`}
            >
              <span className="truncate font-medium">{n.title || 'Untitled'}</span>
              <span className="truncate text-[11px] opacity-80">{new Date(n.updated).toLocaleString()}</span>
            </button>
          ))}
        </div>
      </Card>

      <Card className="flex max-h-full flex-col overflow-hidden border-border/60">
        {active ? (
          <>
            <div className="flex flex-wrap items-center gap-2 border-b border-border/50 px-5 py-4">
              <input
                value={active.title}
                onChange={(e) => updateActive({ title: e.target.value })}
                className="min-w-[40%] flex-1 rounded-xl border border-border/60 bg-secondary/30 px-3 py-2 text-[15px] font-semibold text-foreground outline-none focus:ring-2 focus:ring-primary/35"
              />
              <Button type="button" variant="secondary" size="sm" className="rounded-xl gap-1" onClick={duplicateActive}>
                <CopyPlus className="h-3.5 w-3.5" />
                Duplicate
              </Button>
              <Button type="button" variant="outline" size="sm" className="rounded-xl gap-1" onClick={exportActive}>
                <Download className="h-3.5 w-3.5" />
                Export
              </Button>
              <Button
                type="button"
                size="sm"
                className="rounded-xl gap-1"
                disabled={!active.body.trim()}
                onClick={() => onSendToLive(active.body)}
              >
                <Send className="h-3.5 w-3.5" />
                Send to Live
              </Button>
              <Button type="button" variant="destructive" size="sm" className="rounded-xl gap-1" onClick={deleteActive}>
                <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                Delete
              </Button>
            </div>
            <textarea
              value={active.body}
              onChange={(e) => updateActive({ body: e.target.value })}
              placeholder="Write freely — stored locally in the Scribble desktop app."
              className="min-h-0 flex-1 resize-none border-0 bg-transparent px-5 py-4 text-[13px] leading-relaxed text-foreground outline-none"
            />
            {saveError && <p className="border-t border-destructive/30 px-5 py-2 text-[12px] text-destructive">{saveError}</p>}
          </>
        ) : (
          <div className="grid flex-1 place-items-center p-8 text-center text-[13px] text-muted-foreground">
            Select or create a scribble.
          </div>
        )}
      </Card>
    </div>
  )
}
