import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * User-editable application settings. Small and durable — a single JSON file
 * under `userData`, matching the `window-state-store` / `pending-review-store`
 * pattern.
 */
export interface AppSettings {
  /**
   * Custom Guide-generation guidance (the editable half of the Agent's system
   * prompt). `null` means "unset — use the shipped default guidance". The fixed
   * emit/finalize contract lives in `agent-prompt` and is never stored here, so
   * this value can never break generation.
   */
  guideGuidance: string | null
}

const DEFAULTS: AppSettings = { guideGuidance: null }

/**
 * Single-file JSON store for durable app settings. Corruption-tolerant: an
 * unreadable or wrong-shaped file falls back to defaults rather than throwing,
 * so a bad file never blocks startup. Written lazily — nothing is persisted
 * until a setter runs.
 */
export class SettingsStore {
  private settings: AppSettings

  constructor(private readonly filePath: string) {
    this.settings = { ...DEFAULTS }
    if (existsSync(filePath)) {
      try {
        const raw = JSON.parse(readFileSync(filePath, 'utf8')) as unknown
        this.settings = normalize(raw)
      } catch {
        /* corrupted file — fall back to defaults */
      }
    }
  }

  /** A snapshot of all settings. */
  get(): AppSettings {
    return { ...this.settings }
  }

  /** The custom guidance, or `null` when unset (caller uses the shipped default). */
  getGuideGuidance(): string | null {
    return this.settings.guideGuidance
  }

  /**
   * Save custom guidance. Empty/whitespace collapses to `null` (unset), so a
   * blank textarea is the same as "use the default".
   */
  setGuideGuidance(guidance: string | null): void {
    const trimmed = guidance?.trim()
    this.settings.guideGuidance = trimmed ? trimmed : null
    this.flush()
  }

  /** Restore the shipped default (clear the custom guidance). */
  resetGuideGuidance(): void {
    this.settings.guideGuidance = null
    this.flush()
  }

  private flush(): void {
    mkdirSync(dirname(this.filePath), { recursive: true })
    writeFileSync(this.filePath, JSON.stringify(this.settings, null, 2))
  }
}

/** Coerce an arbitrary parsed value into valid settings, dropping bad fields. */
function normalize(raw: unknown): AppSettings {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULTS }
  const o = raw as Record<string, unknown>
  const guidance = typeof o.guideGuidance === 'string' && o.guideGuidance.trim() ? o.guideGuidance : null
  return { guideGuidance: guidance }
}
