import { useEffect, useMemo, useState } from 'react'
import { PatchDiff } from '@pierre/diffs/react'
import { FileTree, useFileTree, useFileTreeSelection } from '@pierre/trees/react'
import type {
  AuthStatus,
  FileWithPatch,
  InboxResult,
  PendingReview,
  PullRequestSummary,
  LineComment,
  DiffSourceSpec
} from '../../preload'

type Status =
  | { type: 'loading' }
  | { type: 'empty'; repo: string }
  | { type: 'loaded'; repo: string; files: FileWithPatch[] }
  | { type: 'error'; message: string }

const SOURCE_SPEC: DiffSourceSpec = { type: 'working-tree-vs-head' }

export default function App() {
  if (!window.api) {
    return <main style={shellStyle}><header style={statusBarStyle}>window.api is undefined</header></main>
  }
  return window.api.purpose === 'inbox' ? <InboxView /> : <LocalRoot />
}

function LocalRoot() {
  const [status, setStatus] = useState<Status>({ type: 'loading' })

  useEffect(() => {
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
      <main style={shellStyle}>
        <header style={{ ...statusBarStyle, display: 'flex', justifyContent: 'space-between' }}>
          <span>
            {status.type === 'loading' && 'Loading…'}
            {status.type === 'empty' && `${status.repo} — clean working tree`}
            {status.type === 'error' && `Error: ${status.message}`}
          </span>
          <GhAuthIndicator />
        </header>
      </main>
    )
  }

  return <LoadedView repo={status.repo} files={status.files} />
}

type InboxStatus =
  | { type: 'loading' }
  | { type: 'loaded'; result: InboxResult }
  | { type: 'error'; message: string }

function InboxView() {
  const [status, setStatus] = useState<InboxStatus>({ type: 'loading' })
  const [lastFetched, setLastFetched] = useState<number | null>(null)

  const load = () => {
    window.api
      .githubListPRs()
      .then(result => {
        setStatus({ type: 'loaded', result })
        setLastFetched(Date.now())
      })
      .catch((err: Error) => setStatus({ type: 'error', message: err.message ?? String(err) }))
  }

  useEffect(() => {
    load()
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    let timer: number | null = null
    const startPoll = () => {
      timer = window.setInterval(() => {
        if (document.hasFocus()) load()
      }, 60_000)
    }
    startPoll()
    return () => {
      window.removeEventListener('focus', onFocus)
      if (timer !== null) window.clearInterval(timer)
    }
  }, [])

  return (
    <main style={shellStyle}>
      <header style={{ ...statusBarStyle, display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
        <span style={{ flex: 1 }}>
          PR Inbox
          {lastFetched && (
            <span style={{ marginLeft: '0.75rem', color: '#888' }}>
              · updated {new Date(lastFetched).toLocaleTimeString()}
            </span>
          )}
        </span>
        <button onClick={load}>Refresh</button>
        <GhAuthIndicator />
      </header>
      <section style={{ flex: 1, overflow: 'auto', padding: '0.75rem 1rem' }}>
        {status.type === 'loading' && <div style={{ color: '#888' }}>Loading…</div>}
        {status.type === 'error' && (
          <div style={{ color: '#b00020' }}>Failed to load: {status.message}</div>
        )}
        {status.type === 'loaded' && (
          <>
            <InboxSection title="Mine" prs={status.result.mine} />
            <InboxSection title="Review requested" prs={status.result.reviewRequested} />
            <InboxSection title="Recently merged" prs={status.result.recentlyMerged} />
          </>
        )}
      </section>
    </main>
  )
}

function InboxSection({ title, prs }: { title: string; prs: PullRequestSummary[] }) {
  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <h3 style={{ fontSize: '0.85rem', textTransform: 'uppercase', color: '#666', margin: '0 0 0.5rem' }}>
        {title} <span style={{ color: '#aaa' }}>({prs.length})</span>
      </h3>
      {prs.length === 0 ? (
        <div style={{ color: '#888', fontSize: '0.85rem' }}>None.</div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          {prs.map(pr => (
            <li key={pr.id}>
              <PrRow pr={pr} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function PrRow({ pr }: { pr: PullRequestSummary }) {
  const onClick = () => {
    const [owner, repo] = pr.repo.split('/')
    window.api.openPRReview({ owner, repo, number: pr.number })
  }
  return (
    <button
      onClick={onClick}
      style={{
        textAlign: 'left',
        width: '100%',
        padding: '0.5rem 0.6rem',
        border: '1px solid #eee',
        borderRadius: 4,
        background: '#fff',
        cursor: 'pointer',
        display: 'grid',
        gridTemplateColumns: '1fr auto',
        gap: '0.5rem',
        fontSize: '0.85rem'
      }}
    >
      <span>
        <span style={{ fontWeight: 600 }}>{pr.title}</span>
        <span style={{ color: '#888', marginLeft: '0.5rem' }}>
          {pr.repo} #{pr.number} · {pr.author}
        </span>
      </span>
      <span style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        <StateBadge state={pr.state} />
        {pr.commentCount > 0 && <span style={{ color: '#888' }}>💬 {pr.commentCount}</span>}
      </span>
    </button>
  )
}

function StateBadge({ state }: { state: PullRequestSummary['state'] }) {
  const colors: Record<PullRequestSummary['state'], string> = {
    open: '#2a8b3a',
    draft: '#666',
    merged: '#6f42c1',
    closed: '#b00020'
  }
  return (
    <span
      style={{
        fontSize: '0.7rem',
        textTransform: 'uppercase',
        color: colors[state],
        border: `1px solid ${colors[state]}`,
        padding: '0.05rem 0.4rem',
        borderRadius: 999
      }}
    >
      {state}
    </span>
  )
}

function GhAuthIndicator() {
  const [auth, setAuth] = useState<AuthStatus | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = () =>
      window.api.ghAuthStatus().then(s => {
        if (!cancelled) setAuth(s)
      })
    load()
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    return () => {
      cancelled = true
      window.removeEventListener('focus', onFocus)
    }
  }, [])

  if (!auth) return <span style={ghPillStyle('#aaa')}>gh: …</span>

  switch (auth.kind) {
    case 'authenticated':
      return <span style={ghPillStyle('#2a8b3a')} title="GitHub CLI is authenticated">gh @{auth.user}</span>
    case 'not-authenticated':
      return (
        <span style={ghPillStyle('#b77400')} title="Run `gh auth login` in a terminal">
          gh: not signed in
        </span>
      )
    case 'gh-not-installed':
      return (
        <span style={ghPillStyle('#b00020')} title="Install gh: https://cli.github.com">
          gh: not installed
        </span>
      )
    case 'error':
      return (
        <span style={ghPillStyle('#b00020')} title={auth.message}>
          gh: error
        </span>
      )
  }
}

function ghPillStyle(color: string): React.CSSProperties {
  return {
    fontSize: '0.75rem',
    color,
    border: `1px solid ${color}`,
    padding: '0.1rem 0.5rem',
    borderRadius: 999,
    cursor: 'help'
  }
}

function LoadedView({ repo, files: liveFiles }: { repo: string; files: FileWithPatch[] }) {
  const [pending, setPending] = useState<PendingReview | null>(null)

  useEffect(() => {
    window.api.reviewGet({ repoPath: repo, sourceSpec: SOURCE_SPEC }).then(setPending)
  }, [repo])

  // Snapshot semantics (ADR 0001): when a review is pending, show the snapshot,
  // not the live working tree. The live diff is only used to seed a new review.
  const files = pending ? pending.snapshot.files : liveFiles

  const paths = useMemo(() => files.map(f => f.path), [files])
  const gitStatus = useMemo(
    () => files.map(f => ({ path: f.path, status: f.status })),
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

  const startReview = () => {
    const review: PendingReview = {
      repoPath: repo,
      sourceSpec: SOURCE_SPEC,
      snapshot: { files: liveFiles },
      lineComments: [],
      summary: '',
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    setPending(review)
    window.api.reviewUpsert(review)
  }

  const refreshSnapshot = async () => {
    if (!pending) return
    if (
      !confirm(
        'Refresh snapshot? Comments anchored to lines that have moved or been removed may become stale.'
      )
    )
      return
    const { files: fresh } = await window.api.getLocalDiff(repo)
    updatePending({ ...pending, snapshot: { files: fresh }, updatedAt: Date.now() })
  }

  const updatePending = (next: PendingReview) => {
    setPending(next)
    window.api.reviewUpsert(next)
  }

  const addComment = (path: string) => {
    if (!pending) return
    const comment: LineComment = {
      id: crypto.randomUUID(),
      path,
      lineNumber: 1,
      side: 'new',
      body: ''
    }
    updatePending({
      ...pending,
      lineComments: [...pending.lineComments, comment],
      updatedAt: Date.now()
    })
  }

  const removeComment = (id: string) => {
    if (!pending) return
    updatePending({
      ...pending,
      lineComments: pending.lineComments.filter(c => c.id !== id),
      updatedAt: Date.now()
    })
  }

  const editComment = (id: string, patch: Partial<LineComment>) => {
    if (!pending) return
    updatePending({
      ...pending,
      lineComments: pending.lineComments.map(c => (c.id === id ? { ...c, ...patch } : c)),
      updatedAt: Date.now()
    })
  }

  const updateSummary = (summary: string) => {
    if (!pending) return
    updatePending({ ...pending, summary, updatedAt: Date.now() })
  }

  const submitToAgent = async () => {
    if (!pending) return
    await window.api.reviewSubmitToAgent(pending)
    setPending(null)
  }

  const discardReview = async () => {
    if (!pending) return
    await window.api.reviewDelete({ repoPath: repo, sourceSpec: SOURCE_SPEC })
    setPending(null)
  }

  return (
    <main style={shellStyle}>
      <header style={{ ...statusBarStyle, display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
        <span style={{ flex: 1 }}>
          {repo} — working tree vs HEAD ({files.length} file{files.length === 1 ? '' : 's'})
          {pending && (
            <span style={{ marginLeft: '0.75rem', color: '#888' }}>
              · review in progress ({pending.lineComments.length} comment
              {pending.lineComments.length === 1 ? '' : 's'})
            </span>
          )}
        </span>
        {!pending && <button onClick={startReview}>Start review</button>}
        <GhAuthIndicator />
      </header>
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <aside style={treePaneStyle}>
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
        {pending && (
          <ReviewPanel
            pending={pending}
            selectedPath={selectedPath}
            onAddComment={() => addComment(selectedPath)}
            onRemoveComment={removeComment}
            onEditComment={editComment}
            onSummaryChange={updateSummary}
            onRefresh={refreshSnapshot}
            onSubmit={submitToAgent}
            onDiscard={discardReview}
          />
        )}
      </div>
    </main>
  )
}

function ReviewPanel({
  pending,
  selectedPath,
  onAddComment,
  onRemoveComment,
  onEditComment,
  onSummaryChange,
  onRefresh,
  onSubmit,
  onDiscard
}: {
  pending: PendingReview
  selectedPath: string
  onAddComment: () => void
  onRemoveComment: (id: string) => void
  onEditComment: (id: string, patch: Partial<LineComment>) => void
  onSummaryChange: (summary: string) => void
  onRefresh: () => void
  onSubmit: () => void
  onDiscard: () => void
}) {
  return (
    <aside style={reviewPaneStyle}>
      <h3 style={{ margin: 0, fontSize: '0.95rem' }}>Pending review</h3>

      <button onClick={onAddComment} style={{ alignSelf: 'flex-start' }}>
        + Comment on {selectedPath || '(no file selected)'}
      </button>

      <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {pending.lineComments.length === 0 && (
          <div style={{ color: '#888', fontSize: '0.85rem' }}>No comments yet.</div>
        )}
        {pending.lineComments.map(c => (
          <div key={c.id} style={commentCardStyle}>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.8rem' }}>
              <code style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {c.path}:
              </code>
              <input
                type="number"
                min={1}
                value={c.lineNumber}
                onChange={e => onEditComment(c.id, { lineNumber: Number(e.target.value) })}
                style={{ width: 60 }}
              />
              <select
                value={c.side}
                onChange={e => onEditComment(c.id, { side: e.target.value as 'old' | 'new' })}
              >
                <option value="new">new</option>
                <option value="old">old</option>
              </select>
              <button onClick={() => onRemoveComment(c.id)} title="Remove">
                ×
              </button>
            </div>
            <textarea
              value={c.body}
              onChange={e => onEditComment(c.id, { body: e.target.value })}
              placeholder="Comment body…"
              rows={3}
              style={{ width: '100%', resize: 'vertical', fontSize: '0.85rem' }}
            />
          </div>
        ))}
      </div>

      <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
        <span style={{ fontSize: '0.8rem', color: '#666' }}>Summary</span>
        <textarea
          value={pending.summary}
          onChange={e => onSummaryChange(e.target.value)}
          rows={4}
          placeholder="Overall feedback for the agent…"
          style={{ width: '100%', resize: 'vertical', fontSize: '0.85rem' }}
        />
      </label>

      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button onClick={onSubmit} style={{ flex: 1 }}>
          Submit to Agent (copy)
        </button>
        <button onClick={onRefresh} title="Re-snapshot the diff">↻</button>
        <button onClick={onDiscard}>Discard</button>
      </div>
    </aside>
  )
}

const shellStyle: React.CSSProperties = {
  fontFamily: 'system-ui',
  height: '100vh',
  display: 'flex',
  flexDirection: 'column'
}

const statusBarStyle: React.CSSProperties = {
  padding: '0.5rem 1rem',
  borderBottom: '1px solid #eee',
  fontSize: '0.85rem',
  color: '#555',
  flexShrink: 0,
  alignItems: 'center'
}

const treePaneStyle: React.CSSProperties = {
  width: 260,
  borderRight: '1px solid #eee',
  overflow: 'auto',
  background: '#fafafa',
  flexShrink: 0
}

const reviewPaneStyle: React.CSSProperties = {
  width: 360,
  borderLeft: '1px solid #eee',
  padding: '0.75rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.75rem',
  background: '#fafafa',
  flexShrink: 0,
  overflow: 'hidden'
}

const commentCardStyle: React.CSSProperties = {
  border: '1px solid #ddd',
  borderRadius: 4,
  padding: '0.5rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.4rem',
  background: '#fff'
}
