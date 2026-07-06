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
  /**
   * Repo root directories to auto-discover a PR's local clone under when the
   * launch context (`--repo=` / `DV_REPO` / cwd) doesn't already point at a
   * clone of the PR's repo — so `homer <pr-url>` works from anywhere. Empty by
   * default (discovery is a fallback; explicit resolution still wins).
   */
  repoRoots: string[]
}

const DEFAULTS: AppSettings = { guideGuidance: null, repoRoots: [] }

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

  /** The configured repo root directories (empty when none are set). */
  getRepoRoots(): string[] {
    return [...this.settings.repoRoots]
  }

  /**
   * Add a repo root directory. Normalizes the path (trims, drops a trailing
   * slash), ignores empty/whitespace, and is idempotent — so `~/code` and
   * `~/code/` are the same root and adding an already-configured one is a no-op.
   */
  addRepoRoot(path: string): void {
    const normalized = normalizeRoot(path)
    if (!normalized || this.settings.repoRoots.includes(normalized)) return
    this.settings.repoRoots = [...this.settings.repoRoots, normalized]
    this.flush()
  }

  /** Remove a configured repo root directory (no-op if it isn't configured). */
  removeRepoRoot(path: string): void {
    const next = this.settings.repoRoots.filter(r => r !== path)
    if (next.length === this.settings.repoRoots.length) return
    this.settings.repoRoots = next
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
  const repoRoots = Array.isArray(o.repoRoots)
    ? o.repoRoots
        .filter((r): r is string => typeof r === 'string' && r.trim() !== '')
        .map(normalizeRoot)
    : []
  return { guideGuidance: guidance, repoRoots }
}

/** Trim a repo-root path and drop a single trailing slash (but not for `/`). */
function normalizeRoot(path: string): string {
  const trimmed = path.trim()
  if (trimmed.length > 1 && trimmed.endsWith('/')) return trimmed.slice(0, -1)
  return trimmed
}
