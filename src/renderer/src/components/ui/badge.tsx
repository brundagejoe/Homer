import { HTMLAttributes } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2 py-[1px] text-[10px] font-medium uppercase tracking-wide whitespace-nowrap',
  {
    variants: {
      tone: {
        neutral: 'border-subtle text-subtle',
        success: 'border-success text-success',
        warning: 'border-warning text-warning',
        danger: 'border-danger text-danger',
        purple: 'border-[#a371f7] text-[#a371f7]',
        accent: 'border-accent text-accent'
      }
    },
    defaultVariants: { tone: 'neutral' }
  }
)

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />
}
