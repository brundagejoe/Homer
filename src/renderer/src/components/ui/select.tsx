import { SelectHTMLAttributes, forwardRef } from 'react'
import { cn } from '@/lib/utils'

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>

export const Select = forwardRef<HTMLSelectElement, SelectProps>(({ className, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      'h-7 rounded-[5px] border border-hairline-strong bg-elevated px-2 text-[12.5px] outline-none transition-colors',
      'focus:border-accent focus:ring-2 focus:ring-[color-mix(in_srgb,var(--accent)_24%,transparent)]',
      'disabled:cursor-not-allowed disabled:opacity-50 [-webkit-app-region:no-drag]',
      className
    )}
    {...props}
  />
))
Select.displayName = 'Select'
