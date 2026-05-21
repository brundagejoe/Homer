import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PendingReviewStore, PendingReview, ReviewTarget } from './pending-review-store'

const localTarget = (repoPath = '/tmp/repo'): ReviewTarget => ({
  kind: 'local',
  repoPath,
  source: { type: 'working-tree-vs-head' }
})

const prTarget = (overrides: Partial<{ owner: string; repo: string; number: number }> = {}): ReviewTarget => ({
  kind: 'pr',
  owner: overrides.owner ?? 'acme',
  repo: overrides.repo ?? 'widgets',
  number: overrides.number ?? 42
})

function sample(target: ReviewTarget, overrides: Partial<PendingReview> = {}): PendingReview {
  return {
    target,
    snapshot: { files: [] },
    lineComments: [],
    summary: '',
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    ...overrides
  }
}

describe('PendingReviewStore', () => {
  let dir: string
  let store: PendingReviewStore

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dv-store-'))
    store = new PendingReviewStore(join(dir, 'reviews.json'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  test('get returns null when no review exists for the target', () => {
    expect(store.get(localTarget())).toBeNull()
  })

  test('upsert then get returns the stored review', () => {
    store.upsert(sample(localTarget(), { summary: 'looks good' }))
    expect(store.get(localTarget())?.summary).toBe('looks good')
  })

  test('upsert replaces existing review for same target', () => {
    store.upsert(sample(localTarget(), { summary: 'first' }))
    store.upsert(sample(localTarget(), { summary: 'second' }))
    expect(store.get(localTarget())?.summary).toBe('second')
  })

  test('local reviews for different repos are independent', () => {
    store.upsert(sample(localTarget('/tmp/a'), { summary: 'A' }))
    store.upsert(sample(localTarget('/tmp/b'), { summary: 'B' }))
    expect(store.get(localTarget('/tmp/a'))?.summary).toBe('A')
    expect(store.get(localTarget('/tmp/b'))?.summary).toBe('B')
  })

  test('local and pr reviews coexist independently', () => {
    store.upsert(sample(localTarget(), { summary: 'L' }))
    store.upsert(sample(prTarget(), { summary: 'P' }))
    expect(store.get(localTarget())?.summary).toBe('L')
    expect(store.get(prTarget())?.summary).toBe('P')
  })

  test('pr reviews for different PRs are independent', () => {
    store.upsert(sample(prTarget({ number: 1 }), { summary: 'one' }))
    store.upsert(sample(prTarget({ number: 2 }), { summary: 'two' }))
    expect(store.get(prTarget({ number: 1 }))?.summary).toBe('one')
    expect(store.get(prTarget({ number: 2 }))?.summary).toBe('two')
  })

  test('delete removes the review', () => {
    store.upsert(sample(localTarget(), { summary: 'gone' }))
    store.delete(localTarget())
    expect(store.get(localTarget())).toBeNull()
  })

  test('list returns all stored reviews', () => {
    store.upsert(sample(localTarget('/tmp/a'), { summary: 'A' }))
    store.upsert(sample(prTarget(), { summary: 'B' }))
    const all = store.list()
    expect(all.length).toBe(2)
    expect(all.map(r => r.summary).sort()).toEqual(['A', 'B'])
  })

  test('persists across instances pointed at the same file', () => {
    store.upsert(sample(localTarget(), { summary: 'survived' }))
    const reopened = new PendingReviewStore(join(dir, 'reviews.json'))
    expect(reopened.get(localTarget())?.summary).toBe('survived')
  })
})
