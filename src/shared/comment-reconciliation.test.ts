import { describe, test, expect } from 'bun:test'
import { reconcileComments, type AnchoredComment, type SnapshotLike } from './comment-reconciliation'

/**
 * A file patch with a single hunk whose new-side lines are the given rows,
 * starting at new-side line `start`. Old side mirrors context lines only —
 * enough to exercise the reconciliation, which anchors on line content.
 */
function addedFile(path: string, start: number, rows: string[]): { path: string; patch: string } {
  const header = `@@ -0,0 +${start},${rows.length} @@`
  const body = rows.map(r => `+${r}`).join('\n')
  return { path, patch: `diff --git a/${path} b/${path}\n${header}\n${body}\n` }
}

function snapshot(...files: { path: string; patch: string }[]): SnapshotLike {
  return { files }
}

const commentOn = (path: string, lineNumber: number, extra: Partial<AnchoredComment> = {}): AnchoredComment => ({
  path,
  lineNumber,
  side: 'new',
  ...extra
})

describe('reconcileComments', () => {
  test('a comment on a line whose content is unchanged carries over', () => {
    const old = snapshot(addedFile('a.ts', 1, ['alpha', 'beta', 'gamma']))
    const next = snapshot(addedFile('a.ts', 1, ['alpha', 'beta', 'gamma']))
    const c = commentOn('a.ts', 2) // "beta"
    const { carried, orphaned } = reconcileComments({ comments: [c], oldSnapshot: old, newSnapshot: next })
    expect(carried).toEqual([c])
    expect(orphaned).toEqual([])
  })

  test('a comment on a line whose content changed is orphaned', () => {
    const old = snapshot(addedFile('a.ts', 1, ['alpha', 'beta', 'gamma']))
    const next = snapshot(addedFile('a.ts', 1, ['alpha', 'BETA-CHANGED', 'gamma']))
    const c = commentOn('a.ts', 2) // was "beta", now "BETA-CHANGED"
    const { carried, orphaned } = reconcileComments({ comments: [c], oldSnapshot: old, newSnapshot: next })
    expect(carried).toEqual([])
    expect(orphaned).toEqual([c])
  })

  test('a comment whose file vanished from the new snapshot is orphaned', () => {
    const old = snapshot(addedFile('a.ts', 1, ['alpha']))
    const next = snapshot(addedFile('b.ts', 1, ['other']))
    const c = commentOn('a.ts', 1)
    const { carried, orphaned } = reconcileComments({ comments: [c], oldSnapshot: old, newSnapshot: next })
    expect(orphaned).toEqual([c])
  })

  test('a comment on a line that shifted position (same content, new line number) is orphaned (snapshot semantics, no re-location)', () => {
    const old = snapshot(addedFile('a.ts', 1, ['alpha', 'beta']))
    // "beta" is now on line 3 because two lines were inserted above it.
    const next = snapshot(addedFile('a.ts', 1, ['zero', 'one', 'beta']))
    const c = commentOn('a.ts', 2) // "beta" at line 2 in old; line 2 is "one" in new
    const { carried, orphaned } = reconcileComments({ comments: [c], oldSnapshot: old, newSnapshot: next })
    expect(orphaned).toEqual([c])
  })

  test('splits a mixed batch into carried and orphaned, preserving order within each', () => {
    const old = snapshot(addedFile('a.ts', 1, ['keep', 'drop', 'keep2']))
    const next = snapshot(addedFile('a.ts', 1, ['keep', 'CHANGED', 'keep2']))
    const survives1 = commentOn('a.ts', 1)
    const dies = commentOn('a.ts', 2)
    const survives2 = commentOn('a.ts', 3)
    const { carried, orphaned } = reconcileComments({
      comments: [survives1, dies, survives2],
      oldSnapshot: old,
      newSnapshot: next
    })
    expect(carried).toEqual([survives1, survives2])
    expect(orphaned).toEqual([dies])
  })

  test('a multi-line comment carries only if BOTH endpoints survive', () => {
    const old = snapshot(addedFile('a.ts', 1, ['start', 'mid', 'end']))
    const next = snapshot(addedFile('a.ts', 1, ['start', 'mid', 'END-CHANGED']))
    const multi = commentOn('a.ts', 3, { startLineNumber: 1, startSide: 'new' }) // spans 1..3
    const { carried, orphaned } = reconcileComments({ comments: [multi], oldSnapshot: old, newSnapshot: next })
    expect(orphaned).toEqual([multi]) // end line changed
  })

  test('a multi-line comment whose BOTH endpoints are byte-identical carries over', () => {
    const old = snapshot(addedFile('a.ts', 1, ['start', 'mid', 'end']))
    const next = snapshot(addedFile('a.ts', 1, ['start', 'mid', 'end']))
    const multi = commentOn('a.ts', 3, { startLineNumber: 1, startSide: 'new' }) // spans 1..3
    const { carried, orphaned } = reconcileComments({ comments: [multi], oldSnapshot: old, newSnapshot: next })
    expect(carried).toEqual([multi])
    expect(orphaned).toEqual([])
  })

  test('a multi-line comment carries when only an INTERIOR line changed (endpoints-only rule)', () => {
    // Anchoring inspects only the start + end endpoints, never lines between
    // them — the deliberate contract (ADR 0001, no re-location). If this ever
    // starts indexing every line in the range, this test fails loudly.
    const old = snapshot(addedFile('a.ts', 1, ['start', 'mid', 'end']))
    const next = snapshot(addedFile('a.ts', 1, ['start', 'MID-CHANGED', 'end']))
    const multi = commentOn('a.ts', 3, { startLineNumber: 1, startSide: 'new' }) // spans 1..3
    const { carried, orphaned } = reconcileComments({ comments: [multi], oldSnapshot: old, newSnapshot: next })
    expect(carried).toEqual([multi])
    expect(orphaned).toEqual([])
  })

  test('an old-side (deletion) comment reconciles against old-side content', () => {
    const removedFile = (path: string, rows: string[]) => ({
      path,
      patch: `diff --git a/${path} b/${path}\n@@ -1,${rows.length} +0,0 @@\n${rows.map(r => `-${r}`).join('\n')}\n`
    })
    const old = snapshot(removedFile('a.ts', ['gone1', 'gone2']))
    const next = snapshot(removedFile('a.ts', ['gone1', 'gone2']))
    const c = commentOn('a.ts', 2, { side: 'old' })
    const { carried } = reconcileComments({ comments: [c], oldSnapshot: old, newSnapshot: next })
    expect(carried).toEqual([c])
  })

  test('empty comment list yields empty results', () => {
    const { carried, orphaned } = reconcileComments({
      comments: [],
      oldSnapshot: snapshot(),
      newSnapshot: snapshot()
    })
    expect(carried).toEqual([])
    expect(orphaned).toEqual([])
  })

  test('context (unchanged) lines shared by both sides reconcile by content', () => {
    const contextFile = (path: string, ctx: string, changed: string) => ({
      path,
      patch: `diff --git a/${path} b/${path}\n@@ -1,2 +1,2 @@\n ${ctx}\n-old-${changed}\n+new-${changed}\n`
    })
    const old = snapshot(contextFile('a.ts', 'shared', 'x'))
    const next = snapshot(contextFile('a.ts', 'shared', 'x'))
    const c = commentOn('a.ts', 1) // context line "shared" on new side line 1
    const { carried } = reconcileComments({ comments: [c], oldSnapshot: old, newSnapshot: next })
    expect(carried).toEqual([c])
  })
})
