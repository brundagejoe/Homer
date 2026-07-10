import { ReactNode } from 'react'
import { Tooltip as BaseTooltip } from '@base-ui-components/react/tooltip'
import { cn } from '@/lib/utils'

/**
 * Wraps the app in a TooltipProvider with a sensible delay. Once one tooltip
 * has been shown, adjacent ones open instantly (group behavior built in).
 */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return <BaseTooltip.Provider delay={300}>{children}</BaseTooltip.Provider>
}

export interface TooltipProps {
  /** The trigger element. Must accept ref + standard hover/focus props. */
  children: ReactNode
  /** Main tooltip text. */
  content: ReactNode
  /** Optional keyboard shortcut, rendered as a small kbd next to the text. */
  shortcut?: string
  /** Side to prefer. Defaults to bottom. */
  side?: 'top' | 'right' | 'bottom' | 'left'
  /** Disable to skip rendering (e.g., when there's nothing useful to say). */
  disabled?: boolean
}

export function Tooltip({ children, content, shortcut, side = 'bottom', disabled }: TooltipProps) {
  if (disabled) return <>{children}</>
  return (
    <BaseTooltip.Root>
      <BaseTooltip.Trigger render={<span className="inline-flex" />}>
        {children}
      </BaseTooltip.Trigger>
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner side={side} sideOffset={6}>
          <BaseTooltip.Popup
            className={cn(
              'glass z-50 max-w-[280px] rounded-[6px] border border-hairline-strong px-2 py-1',
              'text-[11.5px] text-fg shadow-[0_6px_24px_rgba(0,0,0,0.18)]',
              'origin-[var(--transform-origin)] transition-[transform,opacity] duration-150',
              'data-[starting-style]:opacity-0 data-[ending-style]:opacity-0',
              'motion-reduce:transition-none'
            )}
          >
            <span className="inline-flex items-center gap-1.5">
              <span>{content}</span>
              {shortcut && (
                <kbd className="font-mono text-[10px] bg-sidebar border border-hairline rounded-[3px] px-1 py-[1px] text-muted">
                  {shortcut}
                </kbd>
              )}
            </span>
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  )
}
