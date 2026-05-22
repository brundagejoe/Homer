import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Tooltip } from '@/components/ui/tooltip'

export interface ShortcutHelp {
  keys: string
  description: string
}

export function HelpOverlay({ shortcuts, onClose }: { shortcuts: ShortcutHelp[]; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === '?') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="bg-elevated rounded-md px-5 py-4 min-w-[340px] max-w-[520px] shadow-[0_10px_40px_rgba(0,0,0,0.2)] border border-hairline"
      >
        <div className="flex justify-between items-center mb-2">
          <h2 className="m-0 text-[16px]">Keyboard shortcuts</h2>
          <Tooltip content="Close" shortcut="Esc">
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">×</Button>
          </Tooltip>
        </div>
        <table className="w-full border-collapse text-[13px]">
          <tbody>
            {shortcuts.map(s => (
              <tr key={s.keys}>
                <td className="py-1 pr-2 whitespace-nowrap">
                  <kbd className="font-mono bg-sidebar border border-hairline-strong rounded-[3px] px-1.5 py-[1px]">
                    {s.keys}
                  </kbd>
                </td>
                <td className="py-1">{s.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
