import { useEffect } from 'react'

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
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50
      }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#fff',
          borderRadius: 6,
          padding: '1rem 1.25rem',
          minWidth: 340,
          maxWidth: 520,
          boxShadow: '0 10px 40px rgba(0,0,0,0.2)'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
          <h2 style={{ margin: 0, fontSize: '1rem' }}>Keyboard shortcuts</h2>
          <button onClick={onClose} title="Close (Esc)">×</button>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
          <tbody>
            {shortcuts.map(s => (
              <tr key={s.keys}>
                <td style={{ padding: '0.25rem 0.5rem 0.25rem 0', whiteSpace: 'nowrap' }}>
                  <kbd
                    style={{
                      fontFamily: 'ui-monospace, monospace',
                      background: '#f3f3f3',
                      border: '1px solid #ddd',
                      borderRadius: 3,
                      padding: '0.05rem 0.4rem'
                    }}
                  >
                    {s.keys}
                  </kbd>
                </td>
                <td style={{ padding: '0.25rem 0' }}>{s.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
