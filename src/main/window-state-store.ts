import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export interface WindowState {
  width: number
  height: number
  x?: number
  y?: number
}

const DEFAULTS: WindowState = { width: 1200, height: 800 }

/**
 * Single-file JSON store for the last-known window bounds. One global
 * record across all window purposes — the user resizes once and every
 * window thereafter opens at that size.
 */
export class WindowStateStore {
  private state: WindowState

  constructor(private readonly filePath: string) {
    this.state = { ...DEFAULTS }
    if (existsSync(filePath)) {
      try {
        const raw = JSON.parse(readFileSync(filePath, 'utf8'))
        if (isValid(raw)) this.state = raw
      } catch {
        /* corrupted file — fall back to defaults */
      }
    }
  }

  get(): WindowState {
    return { ...this.state }
  }

  save(next: WindowState): void {
    this.state = next
    mkdirSync(dirname(this.filePath), { recursive: true })
    writeFileSync(this.filePath, JSON.stringify(next, null, 2))
  }
}

function isValid(v: unknown): v is WindowState {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return typeof o.width === 'number' && typeof o.height === 'number' && o.width > 0 && o.height > 0
}
