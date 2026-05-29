import { describe, test, expect } from 'bun:test'
import { splitPatchByFile } from './split-patch'

const TWO_FILES = `diff --git a/src/a.ts b/src/a.ts
index 111..222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,1 +1,1 @@
-old
+new
diff --git a/src/b.ts b/src/b.ts
index 333..444 100644
--- a/src/b.ts
+++ b/src/b.ts
@@ -1,0 +1,1 @@
+added`

describe('splitPatchByFile', () => {
  test('returns one slice per file keyed by new path', () => {
    const result = splitPatchByFile(TWO_FILES)
    expect(result.map(f => f.path)).toEqual(['src/a.ts', 'src/b.ts'])
    expect(result[0].patch).toContain('diff --git a/src/a.ts b/src/a.ts')
    expect(result[0].patch).toContain('+new')
    expect(result[1].patch).toContain('+added')
  })

  test('does not bleed one file’s hunks into the next', () => {
    const result = splitPatchByFile(TWO_FILES)
    expect(result[0].patch).not.toContain('+added')
    expect(result[1].patch).not.toContain('+new')
  })

  test('uses the b/ path for renames', () => {
    const renamed = `diff --git a/old/name.ts b/new/name.ts
similarity index 90%
rename from old/name.ts
rename to new/name.ts`
    expect(splitPatchByFile(renamed)[0].path).toBe('new/name.ts')
  })

  test('falls back to a positional key for an unparseable header', () => {
    const odd = `diff --git weird-header
@@ -1 +1 @@
-x
+y`
    expect(splitPatchByFile(odd)[0].path).toBe('file-0')
  })

  test('returns an empty array for blank input', () => {
    expect(splitPatchByFile('')).toEqual([])
    expect(splitPatchByFile('   \n  ')).toEqual([])
  })
})
