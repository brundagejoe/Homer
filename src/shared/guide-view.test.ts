import { describe, test, expect } from 'bun:test'
import { isReferenceCommentable, isGuideAuthoringEnabled } from './guide-view'

describe('isReferenceCommentable', () => {
  test('changed (diff) references are commentable in the Guide', () => {
    expect(isReferenceCommentable({ renderMode: 'diff' })).toBe(true)
  })

  test('context (full) references are read-only in the Guide', () => {
    expect(isReferenceCommentable({ renderMode: 'full' })).toBe(false)
  })
})

describe('isGuideAuthoringEnabled', () => {
  test('changed reference with the diff loaded enables authoring', () => {
    expect(isGuideAuthoringEnabled({ renderMode: 'diff' }, true)).toBe(true)
  })

  test('changed reference is read-only until the diff has loaded', () => {
    // No snapshot yet — committing would freeze an empty Diff Snapshot (ADR 0001).
    expect(isGuideAuthoringEnabled({ renderMode: 'diff' }, false)).toBe(false)
  })

  test('context reference stays read-only even once the diff is loaded', () => {
    expect(isGuideAuthoringEnabled({ renderMode: 'full' }, true)).toBe(false)
  })
})
