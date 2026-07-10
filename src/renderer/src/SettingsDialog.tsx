import { useCallback, useEffect, useState } from 'react'
import { Dialog } from '@base-ui-components/react/dialog'
import { Settings as SettingsIcon, FolderPlus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip } from '@/components/ui/tooltip'
import { toast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'

/**
 * Window event that opens the Settings dialog from elsewhere in the app (e.g.
 * the Guide's "couldn't find the repo" error nudge). Mirrors the help-overlay
 * pattern so callers don't need a wired-through callback.
 */
export const OPEN_SETTINGS_EVENT = 'dv:open-settings'

/** Open the Settings dialog from anywhere in the renderer. */
export function openSettings(): void {
  window.dispatchEvent(new CustomEvent(OPEN_SETTINGS_EVENT))
}

/**
 * Settings entry point: a gear button in the title bar. Opens a dialog with two
 * sections — the repository roots Homer discovers a PR's local clone under, and
 * the editable Guide-generation guidance. The fixed emit/finalize contract +
 * section cap are enforced in the main process and never shown here, so nothing
 * edited in this dialog can break generation.
 */
export function SettingsButton() {
  const [open, setOpen] = useState(false)

  // Let other parts of the app open Settings (see `openSettings`).
  useEffect(() => {
    const onOpen = () => setOpen(true)
    window.addEventListener(OPEN_SETTINGS_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_SETTINGS_EVENT, onOpen)
  }, [])

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Tooltip content="Settings">
        <Dialog.Trigger
          aria-label="Settings"
          className={cn(
            'inline-flex items-center justify-center h-6 w-6 rounded text-muted',
            'hover:text-fg hover:bg-hover [-webkit-app-region:no-drag]',
            'transition-transform duration-100 ease-out active:scale-90'
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
          {open && <SettingsPanel onClose={() => setOpen(false)} />}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/** Mounted only while the dialog is open so each section loads fresh. */
function SettingsPanel({ onClose }: { onClose: () => void }) {
  return (
    <>
      <Dialog.Title className="m-0 type-heading text-fg">Settings</Dialog.Title>
      <div className="mt-3 flex-1 min-h-0 overflow-auto flex flex-col gap-6 pr-1">
        <RepoRootsSection />
        <div className="border-t border-hairline" />
        <GuideGuidanceEditor onClose={onClose} />
      </div>
    </>
  )
}

/**
 * Repository roots: the folders Homer scans to find a PR's local clone when the
 * launch context (`--repo=` / cwd) doesn't already point at one — so
 * `homer <pr-url>` works from anywhere. Add/remove persist immediately.
 */
function RepoRootsSection() {
  const [roots, setRoots] = useState<string[] | null>(null)

  useEffect(() => {
    let cancelled = false
    window.api
      .getRepoRoots()
      .then(r => {
        if (!cancelled) setRoots(r)
      })
      .catch(() => {
        if (!cancelled) setRoots([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  const onAdd = useCallback(async () => {
    try {
      const dir = await window.api.chooseDirectory()
      if (!dir) return
      setRoots(await window.api.addRepoRoot(dir))
    } catch (err) {
      toast.error('Could not add folder', { description: (err as Error).message })
    }
  }, [])

  const onRemove = useCallback(async (path: string) => {
    try {
      setRoots(await window.api.removeRepoRoot(path))
    } catch (err) {
      toast.error('Could not remove folder', { description: (err as Error).message })
    }
  }, [])

  return (
    <section className="flex flex-col gap-2">
      <h2 className="m-0 text-[13px] font-semibold text-fg">Repository roots</h2>
      <p className="m-0 text-[12.5px] text-muted">
        Folders Homer scans to find a pull request’s local clone, so you can run{' '}
        <code className="font-mono text-[11.5px]">homer &lt;pr-url&gt;</code> from anywhere. Launching
        inside the repo (or passing <code className="font-mono text-[11.5px]">--repo</code>) still
        takes precedence.
      </p>

      {roots === null ? (
        <p className="m-0 text-[12.5px] text-subtle">Loading…</p>
      ) : roots.length === 0 ? (
        <p className="m-0 text-[12.5px] text-subtle italic">
          No folders added yet — add the parent folder of your repos (e.g. ~/code).
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {roots.map(root => (
            <li
              key={root}
              className="flex items-center gap-2 border border-hairline rounded-md px-2 py-1 bg-sidebar"
            >
              <span className="flex-1 min-w-0 truncate font-mono text-[11.5px] text-fg">{root}</span>
              <Tooltip content="Remove this folder">
                <button
                  onClick={() => onRemove(root)}
                  aria-label={`Remove ${root}`}
                  className="shrink-0 text-subtle hover:text-fg p-0.5 rounded hover:bg-hover transition-transform duration-100 ease-out active:scale-90 [-webkit-app-region:no-drag]"
                >
                  <X size={12} strokeWidth={2.4} />
                </button>
              </Tooltip>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-0.5">
        <Button size="sm" onClick={onAdd} disabled={roots === null}>
          <FolderPlus size={12} className="mr-1" />
          Add folder…
        </Button>
      </div>
    </section>
  )
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; default: string }
  | { status: 'error'; message: string }

/**
 * The guidance editor body. Loads the current saved guidance fresh each time the
 * dialog opens. Empty text = "use the default".
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
    <section className="flex flex-col">
      <h2 className="m-0 text-[13px] font-semibold text-fg">Guide instructions</h2>
      <p className="mt-1 text-[12.5px] text-muted">
        Customize how the Agent writes the Guide — tone, what to focus on, what to put first. The tool
        contract and section cap are always applied, so these instructions can’t break generation.
      </p>

      <div className="mt-3 flex flex-col">
        {load.status === 'loading' && <p className="m-0 text-[12.5px] text-subtle">Loading…</p>}
        {load.status === 'error' && (
          <p className="m-0 text-[12.5px] text-danger">Failed to load settings: {load.message}</p>
        )}
        {load.status === 'ready' && (
          <Textarea
            value={value}
            onChange={e => setValue(e.target.value)}
            spellCheck={false}
            className="min-h-[200px] font-mono text-[12px] leading-relaxed resize-none overflow-auto"
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
    </section>
  )
}
