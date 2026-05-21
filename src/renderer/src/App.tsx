import { useEffect, useMemo, useState } from 'react'
import { PatchDiff } from '@pierre/diffs/react'
import { FileTree, useFileTree, useFileTreeSelection } from '@pierre/trees/react'
import type {
  AuthStatus,
  ConversationComment,
  DiffSourceSpec,
  FileWithPatch,
  InboxResult,
  InlineComment,
  PendingReview,
  PrTarget,
  PullRequestDetails,
  PullRequestSummary,
  LineComment,
  ReviewEvent,
  ReviewTarget
} from '../../preload'

type Status =
  | { type: 'loading' }
  | { type: 'empty'; repo: string }
  | { type: 'loaded'; repo: string; files: FileWithPatch[] }
  | { type: 'error'; message: string }

const DEFAULT_SOURCE: DiffSourceSpec = { type: 'working-tree-vs-head' }

function localReviewTarget(repoPath: string, source: DiffSourceSpec): ReviewTarget {
  return { kind: 'local', repoPath, source }
}

export default function App() {
  if (!window.api) {
    return <main style={shellStyle}><header style={statusBarStyle}>window.api is undefined</header></main>
  }
  switch (window.api.purpose) {
    case 'inbox':
      return <InboxView />
    case 'pr-review':
      return window.api.prTarget ? <PRReviewView target={window.api.prTarget} /> : <FatalError msg="PR target missing from launch args" />
    case 'local':
      return <LocalRoot />
  }
}

function FatalError({ msg }: { msg: string }) {
  return (
    <main style={shellStyle}>
      <header style={statusBarStyle}>{msg}</header>
    </main>
  )
}

function LocalRoot() {
  const repo = window.api.repoPath
  const [source, setSource] = useState<DiffSourceSpec>(DEFAULT_SOURCE)
  const [status, setStatus] = useState<Status>({ type: 'loading' })

  useEffect(() => {
    let cancelled = false
    setStatus({ type: 'loading' })
    window.api
      .getLocalDiff(repo, source)
      .then(({ files }) => {
        if (cancelled) return
        if (files.length === 0) setStatus({ type: 'empty', repo })
        else setStatus({ type: 'loaded', repo, files })
      })
      .catch((err: Error) => {
        if (!cancelled) setStatus({ type: 'error', message: err.message ?? String(err) })
      })
    return () => {
      cancelled = true
    }
  }, [repo, sourceKey(source)])

  const sourcePicker = <SourcePicker value={source} onChange={setSource} />

  if (status.type !== 'loaded') {
    return (
      <main style={shellStyle}>
        <header style={{ ...statusBarStyle, display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}>
          <span style={{ flex: 1 }}>
            {status.type === 'loading' && 'Loading…'}
            {status.type === 'empty' && `${status.repo} — no changes for this source`}
            {status.type === 'error' && `Error: ${status.message}`}
          </span>
          {sourcePicker}
          <GhAuthIndicator />
        </header>
      </main>
    )
  }

  return <LoadedView repo={status.repo} files={status.files} source={source} sourcePicker={sourcePicker} />
}

function sourceKey(source: DiffSourceSpec): string {
  switch (source.type) {
    case 'working-tree-vs-head':
    case 'staged-vs-head':
    case 'working-tree-vs-staged':
      return source.type
    case 'branch-vs-base':
      return `branch-vs-base:${source.base}...${source.head}`
    case 'commit-range':
      return `commit-range:${source.from}..${source.to}`
    case 'single-commit':
      return `single-commit:${source.sha}`
  }
}

function SourcePicker({ value, onChange }: { value: DiffSourceSpec; onChange: (s: DiffSourceSpec) => void }) {
  return (
    <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', fontSize: '0.8rem' }}>
      <select
        value={value.type}
        onChange={e => {
          const t = e.target.value as DiffSourceSpec['type']
          if (t === 'working-tree-vs-head' || t === 'staged-vs-head' || t === 'working-tree-vs-staged') {
            onChange({ type: t })
          } else if (t === 'branch-vs-base') {
            onChange({ type: 'branch-vs-base', head: 'HEAD', base: 'main' })
          } else if (t === 'commit-range') {
            onChange({ type: 'commit-range', from: 'HEAD~1', to: 'HEAD' })
          } else if (t === 'single-commit') {
            onChange({ type: 'single-commit', sha: 'HEAD' })
          }
        }}
        style={{ fontSize: '0.8rem' }}
      >
        <option value="working-tree-vs-head">Working tree vs HEAD</option>
        <option value="staged-vs-head">Staged vs HEAD</option>
        <option value="working-tree-vs-staged">Working tree vs staged</option>
        <option value="branch-vs-base">Branch vs base</option>
        <option value="commit-range">Commit range</option>
        <option value="single-commit">Single commit</option>
      </select>
      {value.type === 'branch-vs-base' && (
        <>
          <input
            value={value.head}
            onChange={e => onChange({ ...value, head: e.target.value })}
            placeholder="head"
            style={{ width: 100, fontSize: '0.75rem' }}
          />
          <span style={{ color: '#888' }}>vs</span>
          <input
            value={value.base}
            onChange={e => onChange({ ...value, base: e.target.value })}
            placeholder="base"
            style={{ width: 100, fontSize: '0.75rem' }}
          />
        </>
      )}
      {value.type === 'commit-range' && (
        <>
          <input
            value={value.from}
            onChange={e => onChange({ ...value, from: e.target.value })}
            placeholder="from"
            style={{ width: 90, fontSize: '0.75rem' }}
          />
          <span style={{ color: '#888' }}>..</span>
          <input
            value={value.to}
            onChange={e => onChange({ ...value, to: e.target.value })}
            placeholder="to"
            style={{ width: 90, fontSize: '0.75rem' }}
          />
        </>
      )}
      {value.type === 'single-commit' && (
        <input
          value={value.sha}
          onChange={e => onChange({ ...value, sha: e.target.value })}
          placeholder="sha or ref"
          style={{ width: 140, fontSize: '0.75rem' }}
        />
      )}
    </div>
  )
}

type PRStatus =
  | { type: 'loading' }
  | {
      type: 'loaded'
      pr: PullRequestDetails
      files: { path: string; patch: string }[]
      inline: InlineComment[]
      conversation: ConversationComment[]
    }
  | { type: 'error'; message: string }

function PRReviewView({ target }: { target: PrTarget }) {
  const [status, setStatus] = useState<PRStatus>({ type: 'loading' })

  useEffect(() => {
    let cancelled = false
    Promise.all([
      window.api.githubGetPR(target),
      window.api.githubGetPRDiff(target),
      window.api.githubGetPRInlineComments(target),
      window.api.githubGetPRConversation(target)
    ])
      .then(([pr, rawDiff, inline, conversation]) => {
        if (cancelled) return
        const files = splitDiffByFile(rawDiff)
        setStatus({ type: 'loaded', pr, files, inline, conversation })
      })
      .catch((err: Error) => {
        if (!cancelled) setStatus({ type: 'error', message: err.message ?? String(err) })
      })
    return () => {
      cancelled = true
    }
  }, [target.owner, target.repo, target.number])

  if (status.type !== 'loaded') {
    return (
      <main style={shellStyle}>
        <header style={{ ...statusBarStyle, display: 'flex', justifyContent: 'space-between' }}>
          <span>
            {target.owner}/{target.repo}#{target.number}
            {status.type === 'loading' && ' — loading…'}
            {status.type === 'error' && ` — error: ${status.message}`}
          </span>
          <GhAuthIndicator />
        </header>
      </main>
    )
  }

  return <PRReviewLoaded {...status} target={target} />
}

function splitDiffByFile(raw: string): { path: string; patch: string }[] {
  if (!raw.trim()) return []
  const out: { path: string; patch: string }[] = []
  const lines = raw.split('\n')
  let start = -1
  for (let i = 0; i <= lines.length; i++) {
    const boundary = i === lines.length || lines[i].startsWith('diff --git ')
    if (!boundary) continue
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

function PRReviewLoaded({
  target,
  pr,
  files,
  inline,
  conversation
}: {
  target: PrTarget
  pr: PullRequestDetails
  files: { path: string; patch: string }[]
  inline: InlineComment[]
  conversation: ConversationComment[]
}) {
  const reviewTarget: ReviewTarget = useMemo(
    () => ({ kind: 'pr', owner: target.owner, repo: target.repo, number: target.number }),
    [target.owner, target.repo, target.number]
  )

  const [pending, setPending] = useState<PendingReview | null>(null)
  const [submitState, setSubmitState] = useState<
    { kind: 'idle' } | { kind: 'submitting' } | { kind: 'submitted'; url: string } | { kind: 'error'; message: string }
  >({ kind: 'idle' })

  useEffect(() => {
    window.api.reviewGet(reviewTarget).then(setPending)
  }, [reviewTarget])

  const paths = useMemo(() => files.map(f => f.path), [files])
  const { model } = useFileTree({
    paths,
    initialExpansion: 'open',
    initialSelectedPaths: paths.length > 0 ? [paths[0]] : []
  })
  const selectedPaths = useFileTreeSelection(model)
  const selectedPath = selectedPaths[0] ?? paths[0]
  const selectedFile = files.find(f => f.path === selectedPath)
  const inlineForFile = inline.filter(c => c.path === selectedPath)

  const startReview = () => {
    const review: PendingReview = {
      target: reviewTarget,
      snapshot: { files: files.map(f => ({ ...f, status: 'modified', isBinary: false, oldPath: undefined })) },
      lineComments: [],
      summary: '',
      event: 'COMMENT',
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    setPending(review)
    window.api.reviewUpsert(review)
  }

  const updatePending = (next: PendingReview) => {
    setPending(next)
    window.api.reviewUpsert(next)
  }

  const addComment = (path: string) => {
    if (!pending) return
    updatePending({
      ...pending,
      lineComments: [
        ...pending.lineComments,
        { id: crypto.randomUUID(), path, lineNumber: 1, side: 'new', body: '' }
      ],
      updatedAt: Date.now()
    })
  }

  const addReply = (existing: InlineComment) => {
    if (!pending) return
    updatePending({
      ...pending,
      lineComments: [
        ...pending.lineComments,
        {
          id: crypto.randomUUID(),
          path: existing.path,
          lineNumber: existing.lineNumber,
          side: existing.side === 'LEFT' ? 'old' : 'new',
          body: '',
          inReplyToId: existing.id
        }
      ],
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

  const removeComment = (id: string) => {
    if (!pending) return
    updatePending({
      ...pending,
      lineComments: pending.lineComments.filter(c => c.id !== id),
      updatedAt: Date.now()
    })
  }

  const setSummary = (summary: string) => {
    if (!pending) return
    updatePending({ ...pending, summary, updatedAt: Date.now() })
  }

  const setEvent = (event: ReviewEvent) => {
    if (!pending) return
    updatePending({ ...pending, event, updatedAt: Date.now() })
  }

  const submit = async () => {
    if (!pending) return
    setSubmitState({ kind: 'submitting' })
    try {
      const { url } = await window.api.reviewSubmitToGithub(pending)
      setSubmitState({ kind: 'submitted', url })
      setPending(null)
    } catch (err) {
      setSubmitState({ kind: 'error', message: (err as Error).message })
    }
  }

  const discard = async () => {
    if (!pending) return
    await window.api.reviewDelete(reviewTarget)
    setPending(null)
  }

  const annotations = useMemo(
    () =>
      inlineForFile.map(c => ({
        side: c.side === 'LEFT' ? ('deletions' as const) : ('additions' as const),
        lineNumber: c.lineNumber,
        metadata: c
      })),
    [inlineForFile]
  )

  const repliesByParent = useMemo(() => {
    const map = new Map<number, LineComment[]>()
    if (!pending) return map
    for (const c of pending.lineComments) {
      if (c.inReplyToId != null) {
        const list = map.get(c.inReplyToId) ?? []
        list.push(c)
        map.set(c.inReplyToId, list)
      }
    }
    return map
  }, [pending])

  return (
    <main style={shellStyle}>
      <header style={{ ...statusBarStyle, display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
        <span style={{ flex: 1 }}>
          <span style={{ fontWeight: 600 }}>
            {target.owner}/{target.repo}#{pr.number}
          </span>
          <span style={{ marginLeft: '0.5rem' }}>{pr.title}</span>
          <span style={{ color: '#888', marginLeft: '0.5rem' }}>
            · {pr.author} · {pr.headRef} → {pr.baseRef} · +{pr.additions} −{pr.deletions}
          </span>
          {pending && (
            <span style={{ marginLeft: '0.5rem', color: '#888' }}>
              · review in progress ({pending.lineComments.length} comment{pending.lineComments.length === 1 ? '' : 's'})
            </span>
          )}
          {submitState.kind === 'submitted' && (
            <span style={{ marginLeft: '0.5rem', color: '#2a8b3a' }}>· review submitted</span>
          )}
        </span>
        {!pending && <button onClick={startReview}>Start review</button>}
        <StateBadge state={pr.state} />
        <GhAuthIndicator />
      </header>
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <aside style={treePaneStyle}>
          <FileTree model={model} />
        </aside>
        <section style={{ flex: 1, overflow: 'auto' }}>
          {pr.body && (
            <details open style={{ padding: '0.5rem 1rem', borderBottom: '1px solid #eee' }}>
              <summary style={{ cursor: 'pointer', color: '#555', fontSize: '0.85rem' }}>Description</summary>
              <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: '0.5rem 0 0' }}>{pr.body}</pre>
            </details>
          )}
          {selectedFile ? (
            <PatchDiff
              patch={selectedFile.patch}
              lineAnnotations={annotations}
              renderAnnotation={ann => (
                <div style={inlineAnnotationStyle}>
                  <div style={{ fontSize: '0.7rem', color: '#888' }}>
                    {ann.metadata.author} · {new Date(ann.metadata.createdAt).toLocaleString()}
                  </div>
                  <div style={{ whiteSpace: 'pre-wrap', fontSize: '0.85rem' }}>{ann.metadata.body}</div>
                </div>
              )}
            />
          ) : null}
        </section>
        {pending && (
          <PRReviewPanel
            pending={pending}
            selectedPath={selectedPath}
            submitState={submitState}
            onAddComment={() => addComment(selectedPath)}
            onEditComment={editComment}
            onRemoveComment={removeComment}
            onSummary={setSummary}
            onEvent={setEvent}
            onSubmit={submit}
            onDiscard={discard}
          />
        )}
        <aside style={conversationPaneStyle}>
          <h3 style={{ margin: 0, fontSize: '0.95rem' }}>Conversation</h3>
          <div style={{ overflow: 'auto', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {conversation.length === 0 && inlineForFile.length === 0 && (
              <div style={{ color: '#888', fontSize: '0.85rem' }}>No comments yet.</div>
            )}
            {conversation.map(c => (
              <div key={`conv-${c.id}`} style={commentCardStyle}>
                <div style={{ fontSize: '0.75rem', color: '#888' }}>
                  {c.author} · {new Date(c.createdAt).toLocaleString()}
                </div>
                <div style={{ whiteSpace: 'pre-wrap', fontSize: '0.85rem' }}>{c.body}</div>
              </div>
            ))}
            {inlineForFile.length > 0 && (
              <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: '#666', marginTop: '0.75rem' }}>
                Inline on {selectedPath}
              </div>
            )}
            {inlineForFile.map(c => {
              const replies = repliesByParent.get(c.id) ?? []
              return (
                <div key={`inline-${c.id}`} style={commentCardStyle}>
                  <div style={{ fontSize: '0.75rem', color: '#888' }}>
                    {c.author} · line {c.lineNumber} ({c.side === 'LEFT' ? 'old' : 'new'}) ·{' '}
                    {new Date(c.createdAt).toLocaleString()}
                  </div>
                  <div style={{ whiteSpace: 'pre-wrap', fontSize: '0.85rem' }}>{c.body}</div>
                  {pending && replies.length === 0 && (
                    <button onClick={() => addReply(c)} style={{ alignSelf: 'flex-start', fontSize: '0.75rem' }}>
                      Reply
                    </button>
                  )}
                  {replies.map(reply => (
                    <div key={reply.id} style={{ ...commentCardStyle, marginLeft: '0.75rem', background: '#f3f8ff' }}>
                      <div style={{ fontSize: '0.7rem', color: '#666' }}>Your reply (pending)</div>
                      <textarea
                        value={reply.body}
                        onChange={e => editComment(reply.id, { body: e.target.value })}
                        rows={2}
                        style={{ width: '100%', fontSize: '0.8rem', resize: 'vertical' }}
                      />
                      <button
                        onClick={() => removeComment(reply.id)}
                        style={{ alignSelf: 'flex-start', fontSize: '0.7rem' }}
                      >
                        Remove reply
                      </button>
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        </aside>
      </div>
    </main>
  )
}

function PRReviewPanel({
  pending,
  selectedPath,
  submitState,
  onAddComment,
  onEditComment,
  onRemoveComment,
  onSummary,
  onEvent,
  onSubmit,
  onDiscard
}: {
  pending: PendingReview
  selectedPath: string
  submitState:
    | { kind: 'idle' }
    | { kind: 'submitting' }
    | { kind: 'submitted'; url: string }
    | { kind: 'error'; message: string }
  onAddComment: () => void
  onEditComment: (id: string, patch: Partial<LineComment>) => void
  onRemoveComment: (id: string) => void
  onSummary: (s: string) => void
  onEvent: (e: ReviewEvent) => void
  onSubmit: () => void
  onDiscard: () => void
}) {
  const fresh = pending.lineComments.filter(c => c.inReplyToId == null)
  return (
    <aside style={reviewPaneStyle}>
      <h3 style={{ margin: 0, fontSize: '0.95rem' }}>Pending PR review</h3>

      <button onClick={onAddComment} style={{ alignSelf: 'flex-start' }}>
        + Comment on {selectedPath || '(no file selected)'}
      </button>

      <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {fresh.length === 0 && (
          <div style={{ color: '#888', fontSize: '0.85rem' }}>No new comments yet. Use Reply on existing threads or add new comments here.</div>
        )}
        {fresh.map(c => (
          <div key={c.id} style={commentCardStyle}>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.8rem' }}>
              <code style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.path}:</code>
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
              <button onClick={() => onRemoveComment(c.id)}>×</button>
            </div>
            <textarea
              value={c.body}
              onChange={e => onEditComment(c.id, { body: e.target.value })}
              rows={3}
              style={{ width: '100%', fontSize: '0.85rem', resize: 'vertical' }}
            />
          </div>
        ))}
      </div>

      <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
        <span style={{ fontSize: '0.8rem', color: '#666' }}>Summary</span>
        <textarea
          value={pending.summary}
          onChange={e => onSummary(e.target.value)}
          rows={4}
          placeholder="Overall feedback…"
          style={{ width: '100%', resize: 'vertical', fontSize: '0.85rem' }}
        />
      </label>

      <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
        <span style={{ fontSize: '0.8rem', color: '#666' }}>Submit as</span>
        <select
          value={pending.event ?? 'COMMENT'}
          onChange={e => onEvent(e.target.value as ReviewEvent)}
        >
          <option value="COMMENT">Comment</option>
          <option value="APPROVE">Approve</option>
          <option value="REQUEST_CHANGES">Request changes</option>
        </select>
      </label>

      {submitState.kind === 'error' && (
        <div style={{ color: '#b00020', fontSize: '0.8rem' }}>Failed: {submitState.message}</div>
      )}

      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button onClick={onSubmit} disabled={submitState.kind === 'submitting'} style={{ flex: 1 }}>
          {submitState.kind === 'submitting' ? 'Submitting…' : 'Submit review'}
        </button>
        <button onClick={onDiscard}>Discard</button>
      </div>
    </aside>
  )
}

const inlineAnnotationStyle: React.CSSProperties = {
  background: '#fff8c5',
  border: '1px solid #d4a72c',
  borderRadius: 4,
  padding: '0.4rem 0.6rem',
  margin: '0.25rem 0.5rem'
}

const conversationPaneStyle: React.CSSProperties = {
  width: 320,
  borderLeft: '1px solid #eee',
  padding: '0.75rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.5rem',
  background: '#fafafa',
  flexShrink: 0,
  overflow: 'hidden'
}

type InboxStatus =
  | { type: 'loading' }
  | { type: 'loaded'; result: InboxResult }
  | { type: 'error'; message: string }

const PR_URL_RE = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:[/?#].*)?$/

function parsePrUrlClient(input: string): { owner: string; repo: string; number: number } | null {
  const m = input.trim().match(PR_URL_RE)
  return m ? { owner: m[1], repo: m[2], number: Number(m[3]) } : null
}

function InboxView() {
  const [status, setStatus] = useState<InboxStatus>({ type: 'loading' })
  const [lastFetched, setLastFetched] = useState<number | null>(null)
  const [urlInput, setUrlInput] = useState('')
  const [urlError, setUrlError] = useState('')

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
        <form
          onSubmit={e => {
            e.preventDefault()
            const target = parsePrUrlClient(urlInput)
            if (!target) {
              setUrlError('Not a github.com PR URL')
              return
            }
            setUrlError('')
            setUrlInput('')
            window.api.openPRReview(target)
          }}
          style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}
        >
          <input
            type="text"
            value={urlInput}
            onChange={e => setUrlInput(e.target.value)}
            placeholder="Paste a GitHub PR URL…"
            style={{ flex: 1, padding: '0.35rem 0.5rem', fontSize: '0.85rem' }}
          />
          <button type="submit">Open</button>
        </form>
        {urlError && <div style={{ color: '#b00020', fontSize: '0.8rem', marginBottom: '0.5rem' }}>{urlError}</div>}
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

function LoadedView({
  repo,
  files: liveFiles,
  source,
  sourcePicker
}: {
  repo: string
  files: FileWithPatch[]
  source: DiffSourceSpec
  sourcePicker: React.ReactNode
}) {
  const target = useMemo(() => localReviewTarget(repo, source), [repo, sourceKey(source)])
  const [pending, setPending] = useState<PendingReview | null>(null)

  useEffect(() => {
    window.api.reviewGet(target).then(setPending)
  }, [target])

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
      target,
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
    await window.api.reviewDelete(target)
    setPending(null)
  }

  return (
    <main style={shellStyle}>
      <header style={{ ...statusBarStyle, display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
        <span style={{ flex: 1 }}>
          {repo} ({files.length} file{files.length === 1 ? '' : 's'})
          {pending && (
            <span style={{ marginLeft: '0.75rem', color: '#888' }}>
              · review in progress ({pending.lineComments.length} comment
              {pending.lineComments.length === 1 ? '' : 's'})
            </span>
          )}
        </span>
        {sourcePicker}
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
