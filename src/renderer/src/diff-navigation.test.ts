import { describe, test, expect } from 'bun:test'
import { clampStep, buildHunkTargets, firstHunkIndexForPath } from './diff-navigation'

describe('clampStep', () => {
  test('advances within bounds', () => {
    expect(clampStep(0, 3, 1)).toBe(1)
    expect(clampStep(1, 3, -1)).toBe(0)
  })

  test('clamps at the ends instead of wrapping', () => {
    expect(clampStep(2, 3, 1)).toBe(2)
    expect(clampStep(0, 3, -1)).toBe(0)
  })

  test('returns -1 when there is nothing to step through', () => {
    expect(clampStep(-1, 0, 1)).toBe(-1)
    expect(clampStep(-1, 0, -1)).toBe(-1)
  })

  test('lands on the first item when stepping forward from an unset cursor', () => {
    expect(clampStep(-1, 3, 1)).toBe(0)
  })
})

describe('buildHunkTargets', () => {
  test('produces one ordered target per hunk across files, new-side first', () => {
    const targets = buildHunkTargets([
      { path: 'a.ts', hunks: [{ additionStart: 10, additionLines: 2, deletionStart: 10 }] },
      {
        path: 'b.ts',
        hunks: [
          { additionStart: 1, additionLines: 1, deletionStart: 1 },
          { additionStart: 40, additionLines: 3, deletionStart: 38 }
        ]
      }
    ])
    expect(targets).toEqual([
      { path: 'a.ts', lineNumber: 10, side: 'additions' },
      { path: 'b.ts', lineNumber: 1, side: 'additions' },
      { path: 'b.ts', lineNumber: 40, side: 'additions' }
    ])
  })

  test('anchors a pure-deletion hunk to the old side', () => {
    const targets = buildHunkTargets([
      { path: 'a.ts', hunks: [{ additionStart: 5, additionLines: 0, deletionStart: 5 }] }
    ])
    expect(targets).toEqual([{ path: 'a.ts', lineNumber: 5, side: 'deletions' }])
  })

  test('skips files with no hunks', () => {
    expect(
      buildHunkTargets([{ path: 'empty.ts', hunks: [] }])
    ).toEqual([])
  })
})

describe('firstHunkIndexForPath', () => {
  const targets = [
    { path: 'a.ts', lineNumber: 10, side: 'additions' as const },
    { path: 'b.ts', lineNumber: 1, side: 'additions' as const },
    { path: 'b.ts', lineNumber: 40, side: 'additions' as const }
  ]

  test('returns the index of a path first hunk', () => {
    expect(firstHunkIndexForPath(targets, 'b.ts')).toBe(1)
  })

  test('returns -1 for a path with no hunks', () => {
    expect(firstHunkIndexForPath(targets, 'missing.ts')).toBe(-1)
  })
})
