import { cn } from '@/lib/utils'

export function ScribbleMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn('h-5 w-5', className)} aria-hidden>
      <path
        fill="currentColor"
        d="M16.2 2.8c.4-.5 1.2-.2 1.2.5v7.2c2.4.4 4.6 2.1 5.5 4.6.3.8-.5 1.5-1.3 1.2-1.6-.6-3.2-.7-4.2-.6v10.8c2.6.4 4.6 1.6 4.6 3.1 0 1.8-2.7 3.2-6 3.2s-6-1.4-6-3.2c0-1.5 2-2.7 4.6-3.1V15.7c-1 0-2.6.1-4.2.6-.8.3-1.6-.4-1.3-1.2.9-2.5 3.1-4.2 5.5-4.6V3.3c0-.7.8-1 1.2-.5Z"
      />
    </svg>
  )
}

export function ScribbleMarkBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'grid h-9 w-9 shrink-0 place-items-center rounded-[13px] text-white',
        'bg-[linear-gradient(145deg,#8eb0ff_0%,#4f7cff_42%,#2f4fd0_100%)]',
        'shadow-[0_10px_24px_-10px_hsl(var(--primary)/0.85),inset_0_1px_0_rgba(255,255,255,0.28)]',
        className,
      )}
    >
      <ScribbleMark className="h-[18px] w-[18px]" />
    </span>
  )
}
