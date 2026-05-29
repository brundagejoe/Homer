import { describe, test, expect } from 'bun:test'
import type { InlineComment, LineComment } from '../../preload'
import { buildAnnotationMap } from './diff-annotations'

const inline = (over: Partial<InlineComment> = {}): InlineComment => ({
  id: 1,
  path: 'a.ts',
  lineNumber: 3,
  side: 'RIGHT',
  body: 'hi',
  author: 'octocat',
  createdAt: '2024-01-01',
  ...over
})

const line = (over: Partial<LineComment> = {}): LineComment => ({
  id: 'c1',
  path: 'a.ts',
  lineNumber: 5,
  side: 'new',
  body: 'draft',
  ...over
})

describe('buildAnnotationMap', () => {
  test('translates GitHub LEFT/RIGHT to deletions/additions', () => {
    const map = buildAnnotationMap({ existing: [inline({ side: 'LEFT' }), inline({ id: 2, lineNumber: 9, side: 'RIGHT' })] })
    const anns = map.get('a.ts')!
    expect(anns[0].side).toBe('deletions')
    expect(anns[1].side).toBe('additions')
    expect(anns[0].metadata).toEqual({ kind: 'existing', comment: inline({ side: 'LEFT' }) })
  })

  test('translates pending old/new to deletions/additions', () => {
    const map = buildAnnotationMap({ pending: [line({ side: 'old' }), line({ id: 'c2', side: 'new' })] })
    const anns = map.get('a.ts')!
    expect(anns[0].side).toBe('deletions')
    expect(anns[1].side).toBe('additions')
    expect(anns[0].metadata).toEqual({ kind: 'pending', comment: line({ side: 'old' }) })
  })

  test('groups by path and orders existing, then pending, then drafts', () => {
    const map = buildAnnotationMap({
      existing: [inline()],
      pending: [line({ id: 'p1' })],
      drafts: [line({ id: 'd1' })]
    })
    const anns = map.get('a.ts')!
    expect(anns.map(a => a.metadata!.kind)).toEqual(['existing', 'pending', 'pending'])
    expect(anns[1].metadata).toMatchObject({ comment: { id: 'p1' } })
    expect(anns[2].metadata).toMatchObject({ comment: { id: 'd1' } })
  })

  test('splits annotations across distinct file paths', () => {
    const map = buildAnnotationMap({
      pending: [line({ path: 'a.ts' }), line({ id: 'c2', path: 'b.ts' })]
    })
    expect(map.get('a.ts')).toHaveLength(1)
    expect(map.get('b.ts')).toHaveLength(1)
  })

  test('returns an empty map for no sources', () => {
    expect(buildAnnotationMap({}).size).toBe(0)
  })
})
