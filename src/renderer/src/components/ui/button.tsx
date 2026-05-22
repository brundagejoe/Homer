import { ButtonHTMLAttributes, forwardRef } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap appearance-none rounded-[5px] text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1 disabled:opacity-50 disabled:pointer-events-none [-webkit-app-region:no-drag]',
  {
    variants: {
      variant: {
        default: 'bg-elevated border border-hairline-strong text-fg hover:bg-hover active:bg-active',
        primary:
          'bg-accent text-accent-foreground border border-transparent font-semibold tracking-[0.01em] hover:bg-accent-hover active:bg-accent-active',
        ghost: 'bg-transparent border border-transparent text-fg hover:bg-hover active:bg-active',
        destructive: 'bg-danger text-white border border-transparent hover:opacity-90'
      },
      size: {
        default: 'h-7 px-2.5',
        sm: 'h-6 px-2 text-[11px]',
        icon: 'h-6 w-6 p-0'
      }
    },
    defaultVariants: { variant: 'default', size: 'default' }
  }
)

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  )
)
Button.displayName = 'Button'

export { buttonVariants }
