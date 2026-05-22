import { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * The window's top bar. Doubles as the macOS title-bar draggable region,
 * with 78px left padding to clear the inset traffic lights.
 */
export function TitleBar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <header
      className={cn(
        'titlebar-drag flex items-center justify-between gap-2 pl-[78px] pr-3 py-1.5',
        'text-[12.5px] text-muted bg-surface border-b border-hairline',
        'flex-shrink-0 h-[38px] min-h-[38px] box-border',
        className
      )}
    >
      {children}
    </header>
  )
}
