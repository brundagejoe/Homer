import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CachingGuideSource } from './caching-guide-source'
import { GuideStore, GuideKey } from './guide-store'
import type { GuideEvent, GuideRequest, GuideSource } from './guide-source'
import type { RenderableSection } from '../shared/guide-view'
import type { CoverageMap } from '../shared/guide-schema'

const req = (headSha = 'sha-1'): GuideRequest => ({
  owner: 'acme',
  repo: 'widgets',
  number: 42,
  headSha
})

const section = (ordinal: number): RenderableSection => ({
  ordinal,
  title: `Section ${ordinal}`,
  explanation: 'why',
  kind: 'code',
  references: [
    { path: 'src/a.ts', lineRange: { start: 1, end: 2 }, renderMode: 'diff', kind: 'code', content: 'x' }
  ]
})

const coverage: CoverageMap = { narrated: [{ path: 'src/a.ts', lineRange: { start: 1, end: 2 } }], omitted: [] }

/** An inner GuideSource that records whether it was asked to generate. */
class RecordingSource implements GuideSource {
  calls = 0
  constructor(private readonly events: GuideEvent[]) {}
  async *generate(_request: GuideRequest): AsyncIterable<GuideEvent> {
    this.calls++
    for (const e of this.events) yield e
  }
}

async function collect(it: AsyncIterable<GuideEvent>): Promise<GuideEvent[]> {
  const out: GuideEvent[] = []
  for await (const e of it) out.push(e)
  return out
}

describe('CachingGuideSource', () => {
  let dir: string
  let store: GuideStore
  const keyAt = (sha: string): GuideKey => ({ owner: 'acme', repo: 'widgets', number: 42, headSha: sha })

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dv-caching-'))
    store = new GuideStore({ cacheDir: dir })
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  test('a miss runs the inner source and caches the finished Guide', async () => {
    const inner = new RecordingSource([
      { type: 'section', section: section(1) },
      { type: 'finalized', coverage }
    ])
    const source = new CachingGuideSource({ inner, store })

    const events = await collect(source.generate(req('sha-1')))

    expect(inner.calls).toBe(1)
    expect(events).toEqual([
      { type: 'section', section: section(1) },
      { type: 'finalized', coverage }
    ])
    // The finished Guide is now cached under (repo, PR, head SHA).
    expect(store.get(keyAt('sha-1'))?.sections).toHaveLength(1)
  })

  test('a hit replays the cached Guide and never calls the inner source', async () => {
    // Pre-populate the cache for this PR at the head SHA.
    store.put(keyAt('sha-1'), { sections: [section(1), section(2)], coverage })

    // An inner source that fails loudly if generation is ever attempted — proves
    // a hit spawns no Agent (no worktree acquire, no `claude`).
    const inner: GuideSource = {
      async *generate() {
        throw new Error('inner source must not be called on a cache hit')
      }
    }
    const source = new CachingGuideSource({ inner, store })

    const events = await collect(source.generate(req('sha-1')))

    expect(events).toEqual([
      { type: 'section', section: section(1) },
      { type: 'section', section: section(2) },
      { type: 'finalized', coverage }
    ])
  })

  test('a different head SHA misses and regenerates', async () => {
    store.put(keyAt('old-sha'), { sections: [section(1)], coverage })
    const inner = new RecordingSource([
      { type: 'section', section: section(9) },
      { type: 'finalized', coverage }
    ])
    const source = new CachingGuideSource({ inner, store })

    // The request carries a NEW head SHA, so the cached 'old-sha' entry misses.
    const events = await collect(source.generate(req('new-sha')))

    expect(inner.calls).toBe(1)
    expect(events[0]).toEqual({ type: 'section', section: section(9) })
  })
})
