import { ComponentProps, useMemo } from 'react'
import { Group, Panel, Separator, type Layout } from 'react-resizable-panels'
import { cn } from '@/lib/utils'

const LAYOUT_KEY_PREFIX = 'dv:panel-layout:'

function readLayout(id: string): Layout | undefined {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY_PREFIX + id)
    if (!raw) return undefined
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') return parsed as Layout
  } catch {
    /* corrupted entry — ignore */
  }
  return undefined
}

function writeLayout(id: string, layout: Layout): void {
  try {
    localStorage.setItem(LAYOUT_KEY_PREFIX + id, JSON.stringify(layout))
  } catch {
    /* quota/private mode — non-fatal */
  }
}

/**
 * Wraps the library's Group with localStorage persistence keyed by `id`.
 * Default layout is read once on mount; layout changes are written on
 * `onLayoutChanged` (fires after the user releases the pointer).
 */
export function ResizablePanelGroup({
  className,
  id,
  defaultLayout,
  onLayoutChanged,
  ...props
}: ComponentProps<typeof Group>) {
  const persistedDefault = useMemo(() => {
    if (defaultLayout || !id) return defaultLayout
    return readLayout(String(id))
  }, [id, defaultLayout])

  return (
    <Group
      {...props}
      id={id}
      className={className}
      defaultLayout={persistedDefault}
      onLayoutChanged={layout => {
        if (id) writeLayout(String(id), layout)
        onLayoutChanged?.(layout)
      }}
    />
  )
}

export const ResizablePanel = Panel

export function ResizableHandle({
  className,
  ...props
}: ComponentProps<typeof Separator>) {
  return (
    <Separator
      {...props}
      className={cn(
        'relative bg-hairline transition-colors hover:bg-accent/60',
        'data-[orientation=horizontal]:w-px data-[orientation=horizontal]:cursor-col-resize data-[orientation=horizontal]:hover:w-[3px] data-[orientation=horizontal]:hover:-mx-px',
        'data-[orientation=vertical]:h-px data-[orientation=vertical]:cursor-row-resize data-[orientation=vertical]:hover:h-[3px] data-[orientation=vertical]:hover:-my-px',
        '[-webkit-app-region:no-drag]',
        className
      )}
    />
  )
}
