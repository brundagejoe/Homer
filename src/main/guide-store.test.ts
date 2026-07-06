import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GuideStore, GuideKey, CachedGuide } from './guide-store'

const key = (overrides: Partial<GuideKey> = {}): GuideKey => ({
  owner: overrides.owner ?? 'acme',
  repo: overrides.repo ?? 'widgets',
  number: overrides.number ?? 42,
  headSha: overrides.headSha ?? 'abc123'
})

function sample(overrides: Partial<CachedGuide> = {}): CachedGuide {
  return {
    sections: [
      {
        ordinal: 1,
        title: 'Intro',
        explanation: 'why',
        kind: 'code',
        references: [
          {
            path: 'src/a.ts',
            lineRange: { start: 1, end: 3 },
            renderMode: 'diff',
            kind: 'code',
            content: 'diff --git ...'
          }
        ]
      }
    ],
    coverage: { narrated: [{ path: 'src/a.ts', lineRange: { start: 1, end: 3 } }], omitted: [] },
    ...overrides
  }
}

describe('GuideStore', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dv-guide-cache-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  test('get returns null when nothing is cached for the key', () => {
    const store = new GuideStore({ cacheDir: dir })
    expect(store.get(key())).toBeNull()
  })

  test('put then get for the same key is a hit', () => {
    const store = new GuideStore({ cacheDir: dir })
    store.put(key(), sample())
    const hit = store.get(key())
    expect(hit?.sections[0].title).toBe('Intro')
    expect(hit?.coverage.narrated).toHaveLength(1)
  })

  test('same PR at a different head SHA misses', () => {
    const store = new GuideStore({ cacheDir: dir })
    store.put(key({ headSha: 'old' }), sample())
    expect(store.get(key({ headSha: 'new' }))).toBeNull()
    expect(store.get(key({ headSha: 'old' }))).not.toBeNull()
  })

  test('different repo, owner, or PR number miss', () => {
    const store = new GuideStore({ cacheDir: dir })
    store.put(key(), sample())
    expect(store.get(key({ repo: 'other' }))).toBeNull()
    expect(store.get(key({ owner: 'other' }))).toBeNull()
    expect(store.get(key({ number: 999 }))).toBeNull()
  })

  test('persists across instances pointed at the same cache dir', () => {
    const store = new GuideStore({ cacheDir: dir })
    store.put(key(), sample())
    const reopened = new GuideStore({ cacheDir: dir })
    expect(reopened.get(key())?.sections[0].title).toBe('Intro')
  })

  test('a corrupt cache file is treated as a miss, not an error', () => {
    writeFileSync(join(dir, 'guides.json'), 'not json {{{')
    const store = new GuideStore({ cacheDir: dir })
    expect(store.get(key())).toBeNull()
    // still usable afterwards
    store.put(key(), sample())
    expect(store.get(key())?.sections[0].title).toBe('Intro')
  })

  test('a version mismatch is treated as a miss', () => {
    writeFileSync(
      join(dir, 'guides.json'),
      JSON.stringify({ version: 999, entries: [{ key: 'acme/widgets#42@abc123', guide: sample(), lastUsed: 1 }] })
    )
    const store = new GuideStore({ cacheDir: dir })
    expect(store.get(key())).toBeNull()
  })

  test('evicts the oldest entry once the cap is exceeded', () => {
    const store = new GuideStore({ cacheDir: dir, maxEntries: 2 })
    store.put(key({ headSha: 'a' }), sample())
    store.put(key({ headSha: 'b' }), sample())
    store.put(key({ headSha: 'c' }), sample())
    expect(store.get(key({ headSha: 'a' }))).toBeNull()
    expect(store.get(key({ headSha: 'b' }))).not.toBeNull()
    expect(store.get(key({ headSha: 'c' }))).not.toBeNull()
  })

  test('eviction is by recency of use, not insertion (LRU, not FIFO)', () => {
    const store = new GuideStore({ cacheDir: dir, maxEntries: 2 })
    store.put(key({ headSha: 'a' }), sample())
    store.put(key({ headSha: 'b' }), sample())
    store.get(key({ headSha: 'a' })) // touch 'a' so 'b' is now the LRU
    store.put(key({ headSha: 'c' }), sample())
    expect(store.get(key({ headSha: 'b' }))).toBeNull()
    expect(store.get(key({ headSha: 'a' }))).not.toBeNull()
    expect(store.get(key({ headSha: 'c' }))).not.toBeNull()
  })
})
