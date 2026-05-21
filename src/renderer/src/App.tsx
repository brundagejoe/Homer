import { useEffect, useMemo, useState } from 'react'
import { PatchDiff } from '@pierre/diffs/react'
import { FileTree, useFileTree, useFileTreeSelection } from '@pierre/trees/react'
import type { FileWithPatch } from '../../preload'

type Status =
  | { type: 'loading' }
  | { type: 'empty'; repo: string }
  | { type: 'loaded'; repo: string; files: FileWithPatch[] }
  | { type: 'error'; message: string }

export default function App() {
  const [status, setStatus] = useState<Status>({ type: 'loading' })

  useEffect(() => {
    if (!window.api) {
      setStatus({ type: 'error', message: 'window.api is undefined' })
      return
    }
    const repo = window.api.repoPath
    window.api
      .getLocalDiff(repo)
      .then(({ files }) => {
        if (files.length === 0) setStatus({ type: 'empty', repo })
        else setStatus({ type: 'loaded', repo, files })
      })
      .catch((err: Error) =>
        setStatus({ type: 'error', message: err.message ?? String(err) })
      )
  }, [])

  if (status.type !== 'loaded') {
    return (
      <main style={{ fontFamily: 'system-ui', height: '100vh', display: 'flex', flexDirection: 'column' }}>
        <header style={statusBarStyle}>
          {status.type === 'loading' && 'Loading…'}
          {status.type === 'empty' && `${status.repo} — clean working tree`}
          {status.type === 'error' && `Error: ${status.message}`}
        </header>
      </main>
    )
  }

  return <LoadedView repo={status.repo} files={status.files} />
}

function LoadedView({ repo, files }: { repo: string; files: FileWithPatch[] }) {
  const paths = useMemo(() => files.map(f => f.path), [files])
  const gitStatus = useMemo(
    () => files.map(f => ({ path: f.path, status: mapStatus(f.status) })),
    [files]
  )

  const { model } = useFileTree({
    paths,
    gitStatus,
    initialExpansion: 'open',
    initialSelectedPaths: paths.length > 0 ? [paths[0]] : []
  })

  const selectedPaths = useFileTreeSelection(model)
  const selectedPath = selectedPaths[0] ?? paths[0]
  const selectedFile = files.find(f => f.path === selectedPath)

  return (
    <main style={{ fontFamily: 'system-ui', height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header style={statusBarStyle}>
        {repo} — working tree vs HEAD ({files.length} file{files.length === 1 ? '' : 's'})
      </header>
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <aside
          style={{
            width: 280,
            borderRight: '1px solid #eee',
            overflow: 'auto',
            background: '#fafafa'
          }}
        >
          <FileTree model={model} />
        </aside>
        <section style={{ flex: 1, overflow: 'auto' }}>
          {selectedFile && selectedFile.patch ? (
            <PatchDiff patch={selectedFile.patch} />
          ) : (
            <div style={{ padding: '1rem', color: '#888' }}>
              {selectedFile?.isBinary
                ? 'Binary file — no diff preview'
                : 'No diff for this file'}
            </div>
          )}
        </section>
      </div>
    </main>
  )
}

const statusBarStyle: React.CSSProperties = {
  padding: '0.5rem 1rem',
  borderBottom: '1px solid #eee',
  fontSize: '0.85rem',
  color: '#555',
  flexShrink: 0
}

function mapStatus(status: FileWithPatch['status']): 'added' | 'deleted' | 'modified' | 'renamed' {
  return status
}
