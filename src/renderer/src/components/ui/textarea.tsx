import { TextareaHTMLAttributes, forwardRef } from 'react'
import { cn } from '@/lib/utils'

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      'w-full rounded-[5px] border border-hairline-strong bg-elevated px-2 py-1 text-[12.5px] outline-none transition-colors',
      'placeholder:text-subtle focus:border-accent focus:ring-2 focus:ring-[color-mix(in_srgb,var(--accent)_24%,transparent)]',
      'resize-y disabled:cursor-not-allowed disabled:opacity-50 [-webkit-app-region:no-drag]',
      className
    )}
    {...props}
  />
))
Textarea.displayName = 'Textarea'
