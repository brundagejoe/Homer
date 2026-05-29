export interface FilePatch {
  path: string
  patch: string
}

/**
 * Split a raw unified diff that may cover many files into one patch
 * slice per file, keyed by the file's new path from its `diff --git`
 * header. The same `diff --git`-boundary parse is needed on both sides
 * of the IPC seam (the main process splits local git output; the
 * renderer splits a GitHub PR's diff), so it lives here once.
 *
 * A file whose header doesn't match the expected shape falls back to a
 * positional `file-N` key rather than being dropped.
 */
export function splitPatchByFile(rawPatch: string): FilePatch[] {
  if (!rawPatch.trim()) return []
  const out: FilePatch[] = []
  const lines = rawPatch.split('\n')
  let start = -1
  for (let i = 0; i <= lines.length; i++) {
    const isBoundary = i === lines.length || lines[i].startsWith('diff --git ')
    if (!isBoundary) continue
    if (start >= 0) {
      const slice = lines.slice(start, i).join('\n')
      const match = lines[start].match(/^diff --git a\/(.+?) b\/(.+)$/)
      const path = match ? match[2] : `file-${out.length}`
      out.push({ path, patch: slice })
    }
    start = i
  }
  return out
}
