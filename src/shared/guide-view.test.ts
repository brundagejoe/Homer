import { describe, test, expect } from 'bun:test'
import {
  isReferenceCommentable,
  isGuideAuthoringEnabled,
  groupReferencesByFile
} from './guide-view'
import type { RenderableReference } from './guide-view'

function ref(overrides: Partial<RenderableReference>): RenderableReference {
  return {
    path: 'src/a.ts',
    lineRange: { start: 1, end: 5 },
    renderMode: 'diff',
    kind: 'code',
    content: 'patch-a',
    ...overrides
  }
}

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

describe('groupReferencesByFile', () => {
  test('coalesces two refs to the same file+mode into one group with both ranges', () => {
    const groups = groupReferencesByFile([
      ref({ lineRange: { start: 23, end: 26 } }),
      ref({ lineRange: { start: 168, end: 178 } })
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].path).toBe('src/a.ts')
    expect(groups[0].content).toBe('patch-a')
    expect(groups[0].ranges).toEqual([
      { start: 23, end: 26 },
      { start: 168, end: 178 }
    ])
  })

  test('different files become separate groups', () => {
    const groups = groupReferencesByFile([
      ref({ path: 'src/a.ts' }),
      ref({ path: 'src/b.ts', content: 'patch-b' })
    ])
    expect(groups.map(g => g.path)).toEqual(['src/a.ts', 'src/b.ts'])
  })

  test('same path with different renderMode stays in separate groups', () => {
    const groups = groupReferencesByFile([
      ref({ renderMode: 'diff' }),
      ref({ renderMode: 'full' })
    ])
    expect(groups).toHaveLength(2)
    expect(groups.map(g => g.renderMode)).toEqual(['diff', 'full'])
  })

  test('preserves first-seen order across interleaved files', () => {
    const groups = groupReferencesByFile([
      ref({ path: 'src/b.ts' }),
      ref({ path: 'src/a.ts' }),
      ref({ path: 'src/b.ts' })
    ])
    expect(groups.map(g => g.path)).toEqual(['src/b.ts', 'src/a.ts'])
    expect(groups[0].ranges).toHaveLength(2)
  })
})
