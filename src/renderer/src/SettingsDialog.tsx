import { useCallback, useEffect, useState } from 'react'
import { Dialog } from '@base-ui-components/react/dialog'
import { Settings as SettingsIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip } from '@/components/ui/tooltip'
import { toast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'

/**
 * Settings entry point: a gear button in the title bar that opens the Guide
 * guidance editor. The user edits only the *guidance* (tone / what to
 * prioritise); the fixed emit/finalize contract + section cap are enforced in
 * the main process and are never shown or editable here, so a bad edit can't
 * break generation. Changes apply to the next Guide generation.
 */
export function SettingsButton() {
  const [open, setOpen] = useState(false)
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Tooltip content="Settings">
        <Dialog.Trigger
          aria-label="Settings"
          className={cn(
            'inline-flex items-center justify-center h-6 w-6 rounded text-muted',
            'hover:text-fg hover:bg-hover [-webkit-app-region:no-drag]'
          )}
        >
          <SettingsIcon size={14} strokeWidth={2} />
        </Dialog.Trigger>
      </Tooltip>
      <Dialog.Portal>
        <Dialog.Backdrop
          className={cn(
            'fixed inset-0 z-50 bg-black/40',
            'data-[starting-style]:opacity-0 data-[ending-style]:opacity-0',
            'transition-opacity duration-150 motion-reduce:transition-none'
          )}
        />
        <Dialog.Popup
          className={cn(
            'fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2',
            'flex flex-col w-[min(680px,90vw)] max-h-[85vh] rounded-md border border-hairline bg-elevated px-5 py-4',
            'shadow-[0_10px_40px_rgba(0,0,0,0.2)] outline-none',
            'data-[starting-style]:opacity-0 data-[ending-style]:opacity-0',
            'data-[starting-style]:scale-95 data-[ending-style]:scale-95',
            'transition-[opacity,transform] duration-150 motion-reduce:transition-none'
          )}
        >
          {open && <GuideGuidanceEditor onClose={() => setOpen(false)} />}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; default: string }
  | { status: 'error'; message: string }

/**
 * The guidance editor body. Mounted only while the dialog is open so it always
 * loads the current saved guidance fresh. Empty text = "use the default".
 */
function GuideGuidanceEditor({ onClose }: { onClose: () => void }) {
  const [load, setLoad] = useState<LoadState>({ status: 'loading' })
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    window.api
      .getGuideSettings()
      .then(s => {
        if (cancelled) return
        // Prefill with the saved custom guidance, or the default baseline when
        // unset — so the user always edits from a known-good starting point.
        setValue(s.custom ?? s.default)
        setLoad({ status: 'ready', default: s.default })
      })
      .catch(err => {
        if (!cancelled) setLoad({ status: 'error', message: (err as Error).message ?? String(err) })
      })
    return () => {
      cancelled = true
    }
  }, [])

  const onSave = useCallback(async () => {
    setSaving(true)
    try {
      await window.api.setGuideGuidance(value)
      toast.success('Guide instructions saved', {
        description: 'The next Guide generation will use them.'
      })
      onClose()
    } catch (err) {
      toast.error('Could not save', { description: (err as Error).message })
    } finally {
      setSaving(false)
    }
  }, [value, onClose])

  const onReset = useCallback(async () => {
    if (load.status !== 'ready') return
    try {
      await window.api.resetGuideGuidance()
      setValue(load.default)
      toast.success('Reset to the default instructions')
    } catch (err) {
      toast.error('Could not reset', { description: (err as Error).message })
    }
  }, [load])

  const isDefault = load.status === 'ready' && value.trim() === load.default.trim()

  return (
    <>
      <Dialog.Title className="m-0 text-[14px] font-semibold text-fg">
        Guide instructions
      </Dialog.Title>
      <Dialog.Description className="mt-1 text-[12.5px] text-muted">
        Customize how the Agent writes the Guide — tone, what to focus on, what to put first. The
        tool contract and section cap are always applied, so these instructions can’t break
        generation.
      </Dialog.Description>

      <div className="mt-3 flex-1 min-h-0 flex flex-col">
        {load.status === 'loading' && (
          <p className="m-0 text-[12.5px] text-subtle">Loading…</p>
        )}
        {load.status === 'error' && (
          <p className="m-0 text-[12.5px] text-danger">Failed to load settings: {load.message}</p>
        )}
        {load.status === 'ready' && (
          <Textarea
            value={value}
            onChange={e => setValue(e.target.value)}
            spellCheck={false}
            className="flex-1 min-h-[240px] font-mono text-[12px] leading-relaxed resize-none overflow-auto"
            placeholder="Leave empty to use the default instructions."
          />
        )}
      </div>

      <div className="mt-4 flex items-center justify-between gap-2">
        <Tooltip content="Restore the shipped default instructions">
          <span className="inline-flex">
            <Button variant="ghost" onClick={onReset} disabled={load.status !== 'ready' || isDefault}>
              Reset to default
            </Button>
          </span>
        </Tooltip>
        <div className="flex items-center gap-2">
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={onSave} disabled={load.status !== 'ready' || saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </>
  )
}
