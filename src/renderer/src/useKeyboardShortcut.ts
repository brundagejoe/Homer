import { useEffect } from 'react'

export interface ShortcutDef {
  /** Key as it appears in KeyboardEvent.key (e.g. "Enter", "Escape", "?", "r"). */
  key: string
  meta?: boolean
  shift?: boolean
  handler: (event: KeyboardEvent) => void
  /** Whether the shortcut still fires when the user is typing in an input/textarea. Defaults to false. */
  allowInForm?: boolean
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

export function useKeyboardShortcut(def: ShortcutDef | null): void {
  useEffect(() => {
    if (!def) return
    const wantsExplicitShift = !!def.shift
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== def.key.toLowerCase()) return
      if (!!def.meta !== (e.metaKey || e.ctrlKey)) return
      if (wantsExplicitShift && !e.shiftKey) return
      if (!def.allowInForm && isTypingTarget(e.target)) return
      def.handler(e)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [def?.key, def?.meta, def?.shift, def?.allowInForm, def?.handler])
}
