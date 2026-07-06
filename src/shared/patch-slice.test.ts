import { describe, test, expect } from 'bun:test'
import { slicePatchToRanges } from './patch-slice'

// A patch with three well-separated hunks on the new side: ~L10, ~L50, ~L90.
const THREE_HUNKS = `diff --git a/src/x.ts b/src/x.ts
index 111..222 100644
--- a/src/x.ts
+++ b/src/x.ts
@@ -8,3 +8,4 @@ context a
 keep
-old10
+new10
+extra10
@@ -48,2 +50,2 @@ context b
 keep
-old50
+new50
@@ -88,3 +90,3 @@ context c
 keep
-old90
+new90
 tail`

// The three hunks span new-side [8,11], [50,51], [90,92].

describe('slicePatchToRanges', () => {
  test('a single range keeps only the one hunk it hits', () => {
    const out = slicePatchToRanges(THREE_HUNKS, [{ start: 50, end: 51 }])
    expect(out).toContain('@@ -48,2 +50,2 @@')
    expect(out).toContain('+new50')
    expect(out).not.toContain('+new10')
    expect(out).not.toContain('+new90')
  })

  test('preserves the preamble on the sliced patch', () => {
    const out = slicePatchToRanges(THREE_HUNKS, [{ start: 50, end: 51 }])
    expect(out).toContain('diff --git a/src/x.ts b/src/x.ts')
    expect(out).toContain('--- a/src/x.ts')
    expect(out).toContain('+++ b/src/x.ts')
  })

  test('a range spanning two hunks keeps both (and drops the third)', () => {
    const out = slicePatchToRanges(THREE_HUNKS, [{ start: 11, end: 50 }])
    expect(out).toContain('+new10')
    expect(out).toContain('+new50')
    expect(out).not.toContain('+new90')
  })

  test('multiple ranges union the hunks they hit', () => {
    const out = slicePatchToRanges(THREE_HUNKS, [
      { start: 8, end: 9 },
      { start: 90, end: 92 }
    ])
    expect(out).toContain('+new10')
    expect(out).toContain('+new90')
    expect(out).not.toContain('+new50')
  })

  test('a non-overlapping range falls back to the full patch', () => {
    const out = slicePatchToRanges(THREE_HUNKS, [{ start: 500, end: 600 }])
    expect(out).toBe(THREE_HUNKS)
  })

  test('empty ranges fall back to the full patch', () => {
    expect(slicePatchToRanges(THREE_HUNKS, [])).toBe(THREE_HUNKS)
  })

  test('a pure-deletion hunk (new count 0) is spanned at its new-side start', () => {
    const deletion = `diff --git a/d.ts b/d.ts
index 1..2 100644
--- a/d.ts
+++ b/d.ts
@@ -20,2 +19,0 @@ ctx
-gone1
-gone2`
    // New count 0 anchors the hunk at line 19; a range touching 19 keeps it.
    const hit = slicePatchToRanges(deletion, [{ start: 19, end: 19 }])
    expect(hit).toContain('-gone1')
    // A range just past it does not overlap → full-patch fallback (== original).
    const miss = slicePatchToRanges(deletion, [{ start: 25, end: 30 }])
    expect(miss).toBe(deletion)
  })

  test('a patch with no @@ header is returned unchanged', () => {
    const noHunks = `diff --git a/r.ts b/r.ts
similarity index 100%
rename from r.ts
rename to renamed.ts`
    expect(slicePatchToRanges(noHunks, [{ start: 1, end: 5 }])).toBe(noHunks)
  })
})
