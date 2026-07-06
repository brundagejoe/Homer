import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { CoverageMap } from '../shared/guide-schema'
import type { RenderableSection } from '../shared/guide-view'

/**
 * Identifies a Guide in the cache: the PR (repo + number) at one head SHA. A new
 * head SHA is a different key, so a re-pushed PR misses and regenerates.
 */
export interface GuideKey {
  owner: string
  repo: string
  number: number
  headSha: string
}

/**
 * The renderable result of one finished generation: the streamed Sections plus
 * the finalize-time Coverage Map. Enough to replay the exact renderer events on
 * a cache hit, so a hit renders identically to a fresh run — just instantly.
 */
export interface CachedGuide {
  sections: RenderableSection[]
  coverage: CoverageMap
}

export function keyForGuide(key: GuideKey): string {
  return `${key.owner}/${key.repo}#${key.number}@${key.headSha}`
}

export interface GuideStoreOptions {
  /**
   * App-owned base cache dir. Injected (not `app.getPath`) so tests point it at
   * a temp dir. The store keeps a single JSON file inside it.
   */
  cacheDir: string
  /** Max cached Guides kept before LRU eviction. */
  maxEntries?: number
}

const DEFAULT_MAX_ENTRIES = 20

/**
 * Bumped whenever `CachedGuide`'s shape changes. An on-disk file with a
 * different version is treated as a cache miss (the whole file is dropped), not
 * an error — a stale cache is disposable, never load-bearing.
 */
const CACHE_VERSION = 1

const CACHE_FILE = 'guides.json'

/** The on-disk envelope: a version tag plus the cached entries. */
interface CacheFile {
  version: number
  entries: CacheEntry[]
}

/** One cached Guide plus its recency stamp, as stored in-memory and on disk. */
interface CacheEntry {
  key: string
  guide: CachedGuide
  lastUsed: number
}

export class GuideStore {
  private readonly filePath: string
  private readonly maxEntries: number
  private readonly map: Map<string, CacheEntry>

  /** Strictly-increasing recency clock so rapid puts/gets never tie on LRU order. */
  private clock = 0

  constructor(options: GuideStoreOptions) {
    this.filePath = join(options.cacheDir, CACHE_FILE)
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES
    this.map = this.load()
    for (const e of this.map.values()) this.clock = Math.max(this.clock, e.lastUsed)
  }

  get(key: GuideKey): CachedGuide | null {
    const entry = this.map.get(keyForGuide(key))
    if (!entry) return null
    entry.lastUsed = this.nextStamp()
    return entry.guide
  }

  put(key: GuideKey, guide: CachedGuide): void {
    const k = keyForGuide(key)
    this.map.set(k, { key: k, guide, lastUsed: this.nextStamp() })
    this.evictBeyondCap()
    this.flush()
  }

  /** Drop least-recently-used entries until the cache is back within the cap. */
  private evictBeyondCap(): void {
    while (this.map.size > this.maxEntries) {
      const lru = [...this.map.values()].sort((a, b) => a.lastUsed - b.lastUsed)[0]
      if (!lru) break
      this.map.delete(lru.key)
    }
  }

  private nextStamp(): number {
    this.clock += 1
    return this.clock
  }

  /**
   * Read the cache from disk. A missing file, unparseable JSON, or a version
   * mismatch all start empty — corruption is a miss, never a throw, because the
   * cache is disposable.
   */
  private load(): Map<string, CacheEntry> {
    if (!existsSync(this.filePath)) return new Map()
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as CacheFile
      if (parsed?.version !== CACHE_VERSION || !Array.isArray(parsed.entries)) return new Map()
      return new Map(parsed.entries.map(e => [e.key, e]))
    } catch {
      return new Map()
    }
  }

  /**
   * Persist atomically (temp file + rename): since `load()` drops the ENTIRE
   * file on any parse error, a torn write must never be observable — a crash
   * mid-flush would otherwise lose every cached Guide, not just the newest.
   */
  private flush(): void {
    mkdirSync(dirname(this.filePath), { recursive: true })
    const file: CacheFile = { version: CACHE_VERSION, entries: [...this.map.values()] }
    const tmp = `${this.filePath}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify(file, null, 2))
    renameSync(tmp, this.filePath)
  }
}
