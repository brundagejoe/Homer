import { ComponentProps } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { cn } from '@/lib/utils'

export function ResizablePanelGroup({
  className,
  ...props
}: ComponentProps<typeof Group>) {
  // Library manages display/flex-direction internally; we only forward
  // sizing classes from the caller.
  return <Group {...props} className={className} />
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
