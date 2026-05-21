import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PendingReviewStore, PendingReview } from './pending-review-store'

function sample(overrides: Partial<PendingReview> = {}): PendingReview {
  return {
    repoPath: '/tmp/repo',
    sourceSpec: { type: 'working-tree-vs-head' },
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

  test('get returns null when no review exists for the key', () => {
    const result = store.get({ repoPath: '/tmp/repo', sourceSpec: { type: 'working-tree-vs-head' } })
    expect(result).toBeNull()
  })

  test('upsert then get returns the stored review', () => {
    const review = sample({ summary: 'looks good' })
    store.upsert(review)
    const fetched = store.get({ repoPath: review.repoPath, sourceSpec: review.sourceSpec })
    expect(fetched?.summary).toBe('looks good')
  })

  test('upsert replaces existing review for same key', () => {
    store.upsert(sample({ summary: 'first' }))
    store.upsert(sample({ summary: 'second' }))
    expect(
      store.get({ repoPath: '/tmp/repo', sourceSpec: { type: 'working-tree-vs-head' } })?.summary
    ).toBe('second')
  })

  test('reviews for different repos are independent', () => {
    store.upsert(sample({ repoPath: '/tmp/a', summary: 'A' }))
    store.upsert(sample({ repoPath: '/tmp/b', summary: 'B' }))
    expect(
      store.get({ repoPath: '/tmp/a', sourceSpec: { type: 'working-tree-vs-head' } })?.summary
    ).toBe('A')
    expect(
      store.get({ repoPath: '/tmp/b', sourceSpec: { type: 'working-tree-vs-head' } })?.summary
    ).toBe('B')
  })

  test('delete removes the review', () => {
    store.upsert(sample({ summary: 'gone' }))
    store.delete({ repoPath: '/tmp/repo', sourceSpec: { type: 'working-tree-vs-head' } })
    expect(
      store.get({ repoPath: '/tmp/repo', sourceSpec: { type: 'working-tree-vs-head' } })
    ).toBeNull()
  })

  test('list returns all stored reviews', () => {
    store.upsert(sample({ repoPath: '/tmp/a', summary: 'A' }))
    store.upsert(sample({ repoPath: '/tmp/b', summary: 'B' }))
    const all = store.list()
    expect(all.length).toBe(2)
    expect(all.map(r => r.summary).sort()).toEqual(['A', 'B'])
  })

  test('persists across instances pointed at the same file', () => {
    store.upsert(sample({ summary: 'survived' }))
    const reopened = new PendingReviewStore(join(dir, 'reviews.json'))
    expect(
      reopened.get({ repoPath: '/tmp/repo', sourceSpec: { type: 'working-tree-vs-head' } })?.summary
    ).toBe('survived')
  })
})
