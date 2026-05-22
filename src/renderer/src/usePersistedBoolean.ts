import { useEffect, useState } from 'react'

const PREFIX = 'dv:pref:'

/**
 * useState for a boolean that persists across reloads under a stable
 * localStorage key. Lazy-init avoids reading storage on every render.
 */
export function usePersistedBoolean(key: string, defaultValue: boolean): [boolean, (next: boolean | ((prev: boolean) => boolean)) => void] {
  const storageKey = PREFIX + key
  const [value, setValue] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(storageKey)
      if (raw === null) return defaultValue
      return raw === 'true'
    } catch {
      return defaultValue
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, value ? 'true' : 'false')
    } catch {
      /* quota/private mode — non-fatal */
    }
  }, [storageKey, value])

  return [value, setValue]
}
