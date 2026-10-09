import { useState } from 'react'
import {
  LayoutGrid,
  PencilLine,
  FileText,
  ScanText,
  BarChart3,
  Settings,
  Sparkles,
  UserRound,
  Activity,
  ShieldCheck,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react'

import { ScribbleMarkBadge } from '@/components/ScribbleMark'
import { cn } from '@/lib/utils'

export type NavId =
  | 'dashboard'
  | 'live'
  | 'scribbles'
  | 'templates'
  | 'ocr'
  | 'analytics'
  | 'scribble-ai'
  | 'write'
  | 'ai-core'
  | 'account'
  | 'admin'
  | 'settings'

interface NavItem {
  id: NavId
  label: string
  Icon: typeof LayoutGrid
}

export const NAV: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', Icon: LayoutGrid },
  { id: 'live', label: 'Live', Icon: Activity },
  { id: 'scribbles', label: 'My Scribbles', Icon: PencilLine },
  { id: 'templates', label: 'Templates', Icon: FileText },
  { id: 'ocr', label: 'Extract Text', Icon: ScanText },
  { id: 'analytics', label: 'Analytics', Icon: BarChart3 },
  { id: 'scribble-ai', label: 'Scribble AI', Icon: Sparkles },
  { id: 'account', label: 'Account', Icon: UserRound },
  { id: 'admin', label: 'Admin', Icon: ShieldCheck },
]

const GROUPS: { label: string; ids: NavId[] }[] = [
  { label: 'Workspace', ids: ['dashboard', 'live'] },
  { label: 'Write', ids: ['scribbles', 'templates', 'ocr', 'scribble-ai'] },
  { label: 'Library', ids: ['analytics', 'account', 'admin'] },
]

interface SidebarProps {
  active: NavId
  onChange: (id: NavId) => void
  isAdmin: boolean
  hidden?: NavId[]
}

export function Sidebar({ active, onChange, isAdmin, hidden = [] }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('scribble_sidebar_collapsed') === '1')

  const toggleCollapsed = () => {
    setCollapsed((value) => {
      localStorage.setItem('scribble_sidebar_collapsed', value ? '0' : '1')
      return !value
    })
  }

  const itemsById = new Map(NAV.map((item) => [item.id, item]))

  return (
    <aside
      className={cn(
        'flex h-full shrink-0 flex-col border-r border-border/30 bg-sidebar/80 backdrop-blur-xl transition-[width]',
        collapsed ? 'w-[76px]' : 'w-[76px] min-[860px]:w-[248px]',
      )}
    >
      <div
        className={cn(
          'flex items-center gap-3 pb-6 pt-6',
          collapsed ? 'justify-center px-3' : 'justify-center px-3 min-[860px]:justify-start min-[860px]:px-5',
        )}
      >
        <ScribbleMarkBadge />
        <div className={cn(collapsed ? 'hidden' : 'hidden min-[860px]:block')}>
          <p className="font-display text-[19px] leading-none tracking-tight text-sidebar-foreground">Scribble</p>
          <p className="mt-1 text-[11px] text-sidebar-muted">Write anywhere</p>
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-5 overflow-auto px-3 pb-2">
        {GROUPS.map((group) => {
          const items = group.ids
            .map((id) => itemsById.get(id))
            .filter((item): item is NavItem => {
              if (!item) return false
              return (item.id !== 'admin' || isAdmin) && !hidden.includes(item.id)
            })
          if (items.length === 0) return null
          return (
            <div key={group.label} className="space-y-1">
              <p
                className={cn(
                  'px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-sidebar-muted/80',
                  collapsed ? 'hidden' : 'hidden min-[860px]:block',
                )}
              >
                {group.label}
              </p>
              {items.map(({ id, label, Icon }) => {
                const isActive = id === active
                return (
                  <button
                    key={id}
                    type="button"
                    title={label}
                    aria-current={isActive ? 'page' : undefined}
                    aria-label={label}
                    onClick={() => onChange(id)}
                    className={cn(
                      'relative flex h-10 w-full items-center gap-3 rounded-xl px-3 text-[13px] font-medium transition-colors',
                      isActive
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground',
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" strokeWidth={2} />
                    <span className={cn('truncate', collapsed ? 'hidden' : 'hidden min-[860px]:inline')}>{label}</span>
                  </button>
                )
              })}
            </div>
          )
        })}
      </nav>

      <div className="space-y-1 border-t border-border/30 px-3 py-4">
        <button
          type="button"
          title="Settings"
          aria-current={active === 'settings' ? 'page' : undefined}
          aria-label="Settings"
          onClick={() => onChange('settings')}
          className={cn(
            'flex h-10 w-full items-center gap-3 rounded-xl px-3 text-[13px] font-medium transition-colors',
            active === 'settings'
              ? 'bg-primary text-primary-foreground'
              : 'text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground',
          )}
        >
          <Settings className="h-4 w-4 shrink-0" strokeWidth={2} />
          <span className={cn(collapsed ? 'hidden' : 'hidden min-[860px]:inline')}>Settings</span>
        </button>
        <button
          type="button"
          onClick={toggleCollapsed}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="flex h-9 w-full items-center justify-center rounded-xl text-sidebar-muted transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground lg:flex"
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </button>
      </div>
    </aside>
  )
}
