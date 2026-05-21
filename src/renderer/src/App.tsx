import { useEffect, useMemo, useState } from 'react'
import { PatchDiff } from '@pierre/diffs/react'

type Status =
  | { type: 'loading' }
  | { type: 'empty'; repo: string }
  | { type: 'loaded'; repo: string; patch: string }
  | { type: 'error'; message: string }

function splitPatchByFile(patch: string): { path: string; patch: string }[] {
  if (!patch.trim()) return []
  const chunks: { path: string; patch: string }[] = []
  const lines = patch.split('\n')
  let start = -1
  for (let i = 0; i <= lines.length; i++) {
    const isBoundary = i === lines.length || lines[i].startsWith('diff --git ')
    if (!isBoundary) continue
    if (start >= 0) {
      const slice = lines.slice(start, i).join('\n')
      const header = lines[start]
      const match = header.match(/^diff --git a\/(.+?) b\/(.+)$/)
      const path = match ? match[2] : `file-${chunks.length}`
      chunks.push({ path, patch: slice })
    }
    start = i
  }
  return chunks
}

export default function App() {
  const [status, setStatus] = useState<Status>({ type: 'loading' })

  useEffect(() => {
    if (!window.api) {
      setStatus({ type: 'error', message: 'window.api is undefined' })
      return
    }
    const repo = window.api.repoPath
    window.api
      .getLocalPatch(repo)
      .then(patch => {
        if (!patch.trim()) setStatus({ type: 'empty', repo })
        else setStatus({ type: 'loaded', repo, patch })
      })
      .catch((err: Error) =>
        setStatus({ type: 'error', message: err.message ?? String(err) })
      )
  }, [])

  const fileChunks = useMemo(
    () => (status.type === 'loaded' ? splitPatchByFile(status.patch) : []),
    [status]
  )

  return (
    <main style={{ fontFamily: 'system-ui', height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header style={{ padding: '0.5rem 1rem', borderBottom: '1px solid #eee', fontSize: '0.85rem', color: '#555' }}>
        {status.type === 'loading' && 'Loading…'}
        {status.type === 'empty' && `${status.repo} — clean working tree`}
        {status.type === 'loaded' &&
          `${status.repo} — working tree vs HEAD (${fileChunks.length} file${fileChunks.length === 1 ? '' : 's'})`}
        {status.type === 'error' && `Error: ${status.message}`}
      </header>
      <section style={{ flex: 1, overflow: 'auto' }}>
        {fileChunks.map(chunk => (
          <PatchDiff key={chunk.path} patch={chunk.patch} />
        ))}
      </section>
    </main>
  )
}
