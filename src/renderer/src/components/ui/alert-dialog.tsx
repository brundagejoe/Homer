import { useEffect, useState } from 'react'
import { AlertDialog as BaseAlertDialog } from '@base-ui-components/react/alert-dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface ConfirmOptions {
  /** Headline shown in the dialog. */
  title: string
  /** Optional supporting text under the title. */
  description?: string
  /** Confirm-button label. Defaults to "Confirm". */
  confirmLabel?: string
  /** Cancel-button label. Defaults to "Cancel". */
  cancelLabel?: string
  /** When true, the confirm button uses the destructive variant. */
  destructive?: boolean
}

interface PendingRequest extends ConfirmOptions {
  resolve: (value: boolean) => void
}

type Listener = (req: PendingRequest | null) => void
const listeners = new Set<Listener>()
let current: PendingRequest | null = null

function publish(next: PendingRequest | null) {
  current = next
  for (const fn of listeners) fn(next)
}

/**
 * Imperative confirm dialog — returns a promise that resolves true on
 * confirm and false on cancel. Caller pattern:
 *
 *   if (!(await confirm({ title: 'Discard?' }))) return
 */
export function confirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise(resolve => {
    publish({ ...options, resolve })
  })
}

/**
 * Renders the singleton confirm dialog. Mount once near the root, next
 * to <Toaster />.
 */
export function ConfirmHost() {
  const [req, setReq] = useState<PendingRequest | null>(current)

  useEffect(() => {
    const fn: Listener = next => setReq(next)
    listeners.add(fn)
    return () => {
      listeners.delete(fn)
    }
  }, [])

  const open = req !== null
  const handleResolve = (value: boolean) => {
    req?.resolve(value)
    publish(null)
  }

  return (
    <BaseAlertDialog.Root
      open={open}
      onOpenChange={next => {
        if (!next) handleResolve(false)
      }}
    >
      <BaseAlertDialog.Portal>
        <BaseAlertDialog.Backdrop
          className={cn(
            'fixed inset-0 z-50 bg-black/40',
            'data-[starting-style]:opacity-0 data-[ending-style]:opacity-0',
            'transition-opacity duration-150 motion-reduce:transition-none'
          )}
        />
        <BaseAlertDialog.Popup
          className={cn(
            'fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2',
            'min-w-[340px] max-w-[460px] rounded-md border border-hairline bg-elevated px-5 py-4',
            'shadow-[0_10px_40px_rgba(0,0,0,0.2)] outline-none',
            'data-[starting-style]:opacity-0 data-[ending-style]:opacity-0',
            'data-[starting-style]:scale-95 data-[ending-style]:scale-95',
            'transition-[opacity,transform] duration-150 motion-reduce:transition-none'
          )}
        >
          <BaseAlertDialog.Title className="m-0 text-[14px] font-semibold text-fg">
            {req?.title}
          </BaseAlertDialog.Title>
          {req?.description && (
            <BaseAlertDialog.Description className="mt-2 text-[12.5px] text-muted">
              {req.description}
            </BaseAlertDialog.Description>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <Button onClick={() => handleResolve(false)}>
              {req?.cancelLabel ?? 'Cancel'}
            </Button>
            <Button
              variant={req?.destructive ? 'destructive' : 'primary'}
              onClick={() => handleResolve(true)}
              autoFocus
            >
              {req?.confirmLabel ?? 'Confirm'}
            </Button>
          </div>
        </BaseAlertDialog.Popup>
      </BaseAlertDialog.Portal>
    </BaseAlertDialog.Root>
  )
}
