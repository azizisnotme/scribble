import { PenLine } from 'lucide-react'

import { Button } from '@/components/ui/button'
import type { NavId } from '@/components/Sidebar'

interface HeaderProps {
  title: string
  onNavigate: (id: NavId) => void
}

export function Header({ title, onNavigate }: HeaderProps) {
  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-border/30 px-6">
      <div className="min-w-0">
        <h1 className="font-display min-w-0 truncate text-[clamp(1.35rem,1.2vw+0.7rem,1.7rem)] leading-none tracking-tight text-foreground">
          {title}
        </h1>
      </div>

      <Button
        type="button"
        size="sm"
        className="h-9 gap-1.5 rounded-full px-4 text-[13px] font-semibold"
        onClick={() => onNavigate('scribbles')}
      >
        <PenLine className="h-4 w-4" strokeWidth={2.2} />
        New scribble
      </Button>
    </header>
  )
}
