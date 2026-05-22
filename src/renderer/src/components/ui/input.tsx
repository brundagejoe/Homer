import { InputHTMLAttributes, forwardRef } from 'react'
import { cn } from '@/lib/utils'

export type InputProps = InputHTMLAttributes<HTMLInputElement>

export const Input = forwardRef<HTMLInputElement, InputProps>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      'h-7 w-full rounded-[5px] border border-hairline-strong bg-elevated px-2 text-[12.5px] outline-none transition-colors',
      'placeholder:text-subtle focus:border-accent focus:ring-2 focus:ring-[color-mix(in_srgb,var(--accent)_24%,transparent)]',
      'disabled:cursor-not-allowed disabled:opacity-50 [-webkit-app-region:no-drag]',
      className
    )}
    {...props}
  />
))
Input.displayName = 'Input'
