import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PendingReviewStore, PendingReview, ReviewTarget } from './pending-review-store'

const prTarget = (
  overrides: Partial<{ owner: string; repo: string; number: number }> = {}
): ReviewTarget => ({
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
    expect(store.get(prTarget())).toBeNull()
  })

  test('upsert then get returns the stored review', () => {
    store.upsert(sample(prTarget(), { summary: 'looks good' }))
    expect(store.get(prTarget())?.summary).toBe('looks good')
  })

  test('upsert replaces existing review for same target', () => {
    store.upsert(sample(prTarget(), { summary: 'first' }))
    store.upsert(sample(prTarget(), { summary: 'second' }))
    expect(store.get(prTarget())?.summary).toBe('second')
  })

  test('reviews for different PR numbers in the same repo are independent', () => {
    store.upsert(sample(prTarget({ number: 1 }), { summary: 'one' }))
    store.upsert(sample(prTarget({ number: 2 }), { summary: 'two' }))
    expect(store.get(prTarget({ number: 1 }))?.summary).toBe('one')
    expect(store.get(prTarget({ number: 2 }))?.summary).toBe('two')
  })

  test('reviews for the same PR number in different repos are independent', () => {
    store.upsert(sample(prTarget({ repo: 'a' }), { summary: 'A' }))
    store.upsert(sample(prTarget({ repo: 'b' }), { summary: 'B' }))
    expect(store.get(prTarget({ repo: 'a' }))?.summary).toBe('A')
    expect(store.get(prTarget({ repo: 'b' }))?.summary).toBe('B')
  })

  test('reviews for the same repo/number under different owners are independent', () => {
    store.upsert(sample(prTarget({ owner: 'alice' }), { summary: 'A' }))
    store.upsert(sample(prTarget({ owner: 'bob' }), { summary: 'B' }))
    expect(store.get(prTarget({ owner: 'alice' }))?.summary).toBe('A')
    expect(store.get(prTarget({ owner: 'bob' }))?.summary).toBe('B')
  })

  test('delete removes the review', () => {
    store.upsert(sample(prTarget(), { summary: 'gone' }))
    store.delete(prTarget())
    expect(store.get(prTarget())).toBeNull()
  })

  test('list returns all stored reviews', () => {
    store.upsert(sample(prTarget({ number: 1 }), { summary: 'A' }))
    store.upsert(sample(prTarget({ number: 2 }), { summary: 'B' }))
    const all = store.list()
    expect(all.length).toBe(2)
    expect(all.map(r => r.summary).sort()).toEqual(['A', 'B'])
  })

  test('persists across instances pointed at the same file', () => {
    store.upsert(sample(prTarget(), { summary: 'survived' }))
    const reopened = new PendingReviewStore(join(dir, 'reviews.json'))
    expect(reopened.get(prTarget())?.summary).toBe('survived')
  })
})
