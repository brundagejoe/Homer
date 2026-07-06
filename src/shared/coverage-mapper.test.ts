import { describe, test, expect } from 'bun:test'
import { findUnnarratedHunks, type DiffHunk } from './coverage-mapper'
import type { CoverageMap } from './guide-schema'

const hunk = (path: string, start: number, end: number): DiffHunk => ({
  path,
  lineRange: { start, end }
})

const coverage = (narrated: DiffHunk[], omitted: DiffHunk[] = []): CoverageMap => ({
  narrated: narrated.map(h => ({ path: h.path, lineRange: h.lineRange })),
  omitted: omitted.map(h => ({ path: h.path, lineRange: h.lineRange }))
})

describe('findUnnarratedHunks', () => {
  test('flags every hunk when nothing was narrated', () => {
    const hunks = [hunk('a.ts', 1, 5), hunk('b.ts', 10, 20)]
    expect(findUnnarratedHunks(hunks, coverage([]))).toEqual(hunks)
  })

  test('flags nothing when every hunk was narrated exactly', () => {
    const hunks = [hunk('a.ts', 1, 5), hunk('b.ts', 10, 20)]
    expect(findUnnarratedHunks(hunks, coverage(hunks))).toEqual([])
  })

  test('treats a loosely-overlapping narrated range as narrating the hunk', () => {
    const hunks = [hunk('a.ts', 10, 20)]
    // Agent declared 5..12 — only partially overlaps but still counts.
    expect(findUnnarratedHunks(hunks, coverage([hunk('a.ts', 5, 12)]))).toEqual([])
  })

  test('flags a hunk on a narrated file whose range does not overlap', () => {
    const flagged = hunk('a.ts', 100, 110)
    const hunks = [hunk('a.ts', 1, 5), flagged]
    expect(findUnnarratedHunks(hunks, coverage([hunk('a.ts', 1, 5)]))).toEqual([flagged])
  })

  test('flags only the un-narrated subset across multiple hunks per file', () => {
    const h1 = hunk('a.ts', 1, 5)
    const h2 = hunk('a.ts', 40, 50)
    const h3 = hunk('b.ts', 1, 3)
    // Narrate h1 and h3; h2 is left out.
    const result = findUnnarratedHunks([h1, h2, h3], coverage([h1, h3]))
    expect(result).toEqual([h2])
  })

  test('ignores narrated entries pointing outside the changed files', () => {
    const hunks = [hunk('a.ts', 1, 5)]
    // Narration references a file not in the diff — must not suppress a.ts.
    expect(findUnnarratedHunks(hunks, coverage([hunk('ghost.ts', 1, 5)]))).toEqual(hunks)
  })

  test('ignores a narrated entry on the right file but a non-existent range', () => {
    const hunks = [hunk('a.ts', 1, 5)]
    // Same file, but the range matches no real hunk — the real change stays flagged.
    expect(findUnnarratedHunks(hunks, coverage([hunk('a.ts', 900, 999)]))).toEqual(hunks)
  })

  test('does not let the omitted list suppress a flag (only narrated counts)', () => {
    const hunks = [hunk('a.ts', 1, 5)]
    // Agent listed the hunk as omitted, not narrated — it must still be flagged.
    expect(findUnnarratedHunks(hunks, coverage([], [hunk('a.ts', 1, 5)]))).toEqual(hunks)
  })

  test('flags every hunk when there is no coverage map (Guide not finalized)', () => {
    const hunks = [hunk('a.ts', 1, 5), hunk('b.ts', 10, 20)]
    expect(findUnnarratedHunks(hunks, null)).toEqual(hunks)
  })

  test('returns an empty array when the diff has no hunks', () => {
    expect(findUnnarratedHunks([], coverage([hunk('a.ts', 1, 5)]))).toEqual([])
    expect(findUnnarratedHunks([], null)).toEqual([])
  })

  test('preserves caller placement metadata on returned hunks', () => {
    // Callers pass richer objects; the same objects come back for placement.
    const rich = { path: 'a.ts', lineRange: { start: 1, end: 5 }, side: 'additions', lineNumber: 1 }
    const [out] = findUnnarratedHunks([rich], coverage([]))
    expect(out).toBe(rich)
    expect(out.side).toBe('additions')
  })
})
