import { Toast as BaseToast } from '@base-ui-components/react/toast'
import { cn } from '@/lib/utils'

export const toastManager = BaseToast.createToastManager()

type ToastType = 'success' | 'error' | 'info'

interface ToastData {
  /** Optional action button label, e.g., "Retry" or "Open on GitHub". */
  actionLabel?: string
  /** Handler invoked when the action is clicked. */
  onAction?: () => void
}

export const toast = {
  success(title: string, opts?: { description?: string; actionLabel?: string; onAction?: () => void; timeout?: number }) {
    return toastManager.add<ToastData>({
      type: 'success' satisfies ToastType,
      title,
      description: opts?.description,
      timeout: opts?.timeout ?? 4000,
      data: { actionLabel: opts?.actionLabel, onAction: opts?.onAction }
    })
  },
  error(title: string, opts?: { description?: string; actionLabel?: string; onAction?: () => void; timeout?: number }) {
    return toastManager.add<ToastData>({
      type: 'error' satisfies ToastType,
      title,
      description: opts?.description,
      timeout: opts?.timeout ?? 6000,
      priority: 'high',
      data: { actionLabel: opts?.actionLabel, onAction: opts?.onAction }
    })
  },
  info(title: string, opts?: { description?: string; timeout?: number }) {
    return toastManager.add<ToastData>({
      type: 'info' satisfies ToastType,
      title,
      description: opts?.description,
      timeout: opts?.timeout ?? 3000
    })
  }
}

const accentByType: Record<string, string> = {
  success: 'border-l-success',
  error: 'border-l-danger',
  info: 'border-l-accent'
}

function ToastList() {
  const { toasts } = BaseToast.useToastManager()
  return (
    <>
      {toasts.map(t => {
        const accent = accentByType[t.type ?? 'info'] ?? 'border-l-accent'
        const data = (t.data ?? {}) as ToastData
        return (
          <BaseToast.Root
            key={t.id}
            toast={t}
            className={cn(
              'glass relative pointer-events-auto w-[320px] rounded-md border border-hairline-strong border-l-[3px] text-fg',
              'shadow-[0_10px_30px_rgba(0,0,0,0.18)] px-3 py-2.5',
              'data-[starting-style]:opacity-0 data-[ending-style]:opacity-0',
              'transition-[opacity,transform] duration-200 motion-reduce:transition-none',
              '[transform:translateY(calc(var(--toast-offset-y)*1px))_scale(calc(1-var(--toast-index)*0.04))]',
              accent
            )}
          >
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <BaseToast.Title className="text-[13px] font-semibold leading-tight" />
                {t.description && (
                  <BaseToast.Description className="text-[12px] text-muted mt-0.5" />
                )}
              </div>
              <BaseToast.Close
                aria-label="Dismiss"
                className="appearance-none border-0 bg-transparent text-subtle hover:text-fg text-[14px] leading-none px-1"
              >
                ×
              </BaseToast.Close>
            </div>
            {data.actionLabel && (
              <div className="mt-2 flex justify-end">
                <BaseToast.Action
                  onClick={data.onAction}
                  className={cn(
                    'appearance-none border border-hairline-strong rounded-[5px] bg-elevated px-2 py-0.5',
                    'text-[11.5px] font-medium text-fg hover:bg-hover'
                  )}
                >
                  {data.actionLabel}
                </BaseToast.Action>
              </div>
            )}
          </BaseToast.Root>
        )
      })}
    </>
  )
}

/**
 * Mounts the toast viewport at a fixed bottom-right region. Call `toast.success(...)`
 * etc. from anywhere — no hook required at the call site.
 */
export function Toaster() {
  return (
    <BaseToast.Provider toastManager={toastManager}>
      <BaseToast.Viewport
        className={cn(
          'fixed bottom-4 right-4 z-[60] flex flex-col-reverse gap-2 outline-none',
          'pointer-events-none [&>*]:pointer-events-auto'
        )}
      >
        <ToastList />
      </BaseToast.Viewport>
    </BaseToast.Provider>
  )
}
