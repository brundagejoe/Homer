import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { type CodeViewHandle } from '@pierre/diffs/react'
import { useFileTree, useFileTreeSelection } from '@pierre/trees/react'
import { useKeyboardShortcut } from './useKeyboardShortcut'
import { useReviewDraft } from './useReviewDraft'
import type { AnchorSpec, Editing } from './review-draft'
import { type AnnotationMeta, buildAnnotationMap } from './diff-annotations'
import { splitPatchByFile } from '../../shared/split-patch'
import { HelpOverlay, ShortcutHelp } from './HelpOverlay'
import { Markdown } from './Markdown'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select } from '@/components/ui/select'
import { toast } from '@/components/ui/toast'
import { Tooltip } from '@/components/ui/tooltip'
import { confirm } from '@/components/ui/alert-dialog'
import { ReviewSurface, useReviewSurfaceShell } from './ReviewSurface'
import { TitleBar } from '@/components/TitleBar'
import { cn } from '@/lib/utils'
import type {
  AuthStatus,
  ConversationComment,
  DiffSnapshot,
  DiffSourceSpec,
  FileStatus,
  FileWithPatch,
  InboxResult,
  InlineComment,
  NavRoute,
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

/** The comments being drafted fresh (not yet committed to the Pending
 *  Review). They need annotation slots so the inline composer renders. */
function draftComments(editing: ReadonlyMap<string, Editing>): LineComment[] {
  return [...editing.values()].filter(e => e.isNew).map(e => e.comment)
}

/**
 * Produces a Pierre Tree sort comparator that orders entries by their
 * first-appearance index in `paths`. Directories use the minimum index
 * of any descendant file, so folders are visited in the order of their
 * first changed file.
 */
function useDiffOrderSort(paths: readonly string[]) {
  return useMemo(() => {
    const order = new Map<string, number>()
    paths.forEach((p, i) => {
      order.set(p, i)
      const parts = p.split('/')
      for (let d = 1; d < parts.length; d++) {
        const dir = parts.slice(0, d).join('/')
        if (!order.has(dir)) order.set(dir, i)
      }
    })
    return (a: { path: string }, b: { path: string }) => {
      const ai = order.get(a.path) ?? Number.MAX_SAFE_INTEGER
      const bi = order.get(b.path) ?? Number.MAX_SAFE_INTEGER
      return ai - bi
    }
  }, [paths])
}

/** "12-18" if multi-line, "12" otherwise. */
function formatLineRange(start: number | undefined, end: number): string {
  return start != null && start !== end ? `${start}-${end}` : `${end}`
}

/**
 * Read-only render of an existing GitHub thread (the yellow inline
 * card). A Reply button appears when the viewer has no draft reply to
 * this thread yet.
 */
function ExistingThreadAnnotation({
  comment,
  hasReply,
  onReply
}: {
  comment: InlineComment
  hasReply: boolean
  onReply?: () => void
}) {
  const range = formatLineRange(comment.startLine, comment.lineNumber)
  return (
    <div className="review-annotation rounded-md px-2.5 py-1.5 mx-2 my-1 text-[12.5px]">
      <div className="text-[11px] text-subtle">
        {comment.author} · line {range} · {new Date(comment.createdAt).toLocaleString()}
      </div>
      <Markdown compact>{comment.body}</Markdown>
      {onReply && !hasReply && (
        <Button size="sm" onClick={onReply} className="self-start mt-1">
          Reply
        </Button>
      )}
    </div>
  )
}

/**
 * Editing state for an inline draft comment. The body lives in React
 * state (separate from the pending review on disk) so typing doesn't
 * have to fight Pierre's snapshot cache, and Cancel for a new draft can
 * abandon it cleanly without ever touching disk.
 */
function PendingCommentEditor({
  comment,
  onChange,
  onSubmit,
  onCancel
}: {
  comment: LineComment
  onChange: (body: string) => void
  onSubmit: () => void
  onCancel: () => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const isReply = comment.inReplyToId != null
  useEffect(() => {
    textareaRef.current?.focus()
  }, [])
  // Click-outside-to-cancel — matches the explicit user request that
  // clicking off the composer dismisses it.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const root = containerRef.current
      if (!root) return
      const target = e.target as Node | null
      if (target && root.contains(target)) return
      onCancel()
    }
    // Defer one tick so the opening pointerup doesn't immediately count
    // as a click-outside.
    const id = window.setTimeout(() => {
      document.addEventListener('mousedown', onDown)
    }, 0)
    return () => {
      window.clearTimeout(id)
      document.removeEventListener('mousedown', onDown)
    }
  }, [onCancel])
  const canSubmit = comment.body.trim().length > 0
  const range = formatLineRange(comment.startLineNumber, comment.lineNumber)
  return (
    <div
      ref={containerRef}
      className="border border-hairline-strong rounded-md bg-elevated px-2.5 py-2 mx-2 my-1 flex flex-col gap-2"
    >
      <div className="text-[11px] text-muted">
        {isReply ? 'Your reply' : `Your comment · line ${range}`}
      </div>
      <Textarea
        ref={textareaRef}
        value={comment.body}
        onChange={e => onChange(e.target.value)}
        rows={3}
        placeholder={isReply ? 'Write a reply…' : 'Write a comment…'}
        className="w-full text-[12.5px]"
        onKeyDown={e => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && canSubmit) {
            e.preventDefault()
            onSubmit()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            onCancel()
          }
        }}
      />
      <div className="flex justify-end gap-2">
        <Button size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" onClick={onSubmit} disabled={!canSubmit}>
          Add review comment
        </Button>
      </div>
    </div>
  )
}

/**
 * Collapsed read-only view of a comment that's already been added to
 * the pending review. Edit puts the comment back into editing state;
 * Delete removes it from the pending review entirely.
 */
function PendingCommentCard({
  comment,
  onEdit,
  onDelete
}: {
  comment: LineComment
  onEdit: () => void
  onDelete: () => void
}) {
  const isReply = comment.inReplyToId != null
  const range = formatLineRange(comment.startLineNumber, comment.lineNumber)
  return (
    <div className="border border-accent/40 bg-selected/60 rounded-md px-2.5 py-1.5 mx-2 my-1 flex flex-col gap-1 text-[12.5px]">
      <div className="flex items-center justify-between text-[11px] text-muted">
        <span>
          {isReply ? 'Your reply · pending review' : `Your comment · line ${range} · pending review`}
        </span>
        <div className="flex gap-1">
          <Tooltip content="Edit">
            <Button variant="ghost" size="icon" onClick={onEdit} aria-label="Edit comment">
              ✎
            </Button>
          </Tooltip>
          <Tooltip content="Delete">
            <Button variant="ghost" size="icon" onClick={onDelete} aria-label="Delete comment">
              ×
            </Button>
          </Tooltip>
        </div>
      </div>
      <Markdown compact>{comment.body}</Markdown>
    </div>
  )
}

function localReviewTarget(repoPath: string, source: DiffSourceSpec): ReviewTarget {
  return { kind: 'local', repoPath, source }
}

/**
 * Count added/removed lines in a unified-diff patch, skipping the
 * +++/--- file headers (which also start with +/-).
 */
function diffStats(patch: string): { additions: number; deletions: number } {
  let additions = 0
  let deletions = 0
  for (const line of patch.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) additions++
    else if (line.startsWith('-') && !line.startsWith('---')) deletions++
  }
  return { additions, deletions }
}

type ViewMode = 'conversation' | 'code'

/**
 * Segmented Conversation / Code switch for the title bar. The whole
 * window is one or the other — Conversation holds the description and
 * threads, Code holds the diff, tree, and review panel.
 */
function ViewModeToggle({ mode, onMode }: { mode: ViewMode; onMode: (m: ViewMode) => void }) {
  const seg = (value: ViewMode, label: string) => (
    <Tooltip content={`Show ${label.toLowerCase()}`} shortcut="⌘E">
      <button
        onClick={() => onMode(value)}
        aria-pressed={mode === value}
        className={cn(
          'px-2.5 py-0.5 rounded-[6px] text-[12px] [-webkit-app-region:no-drag]',
          mode === value ? 'bg-elevated text-fg shadow-sm' : 'text-muted hover:text-fg'
        )}
      >
        {label}
      </button>
    </Tooltip>
  )
  return (
    <div className="flex items-center gap-0.5 p-0.5 rounded-[8px] bg-hover">
      {seg('conversation', 'Conversation')}
      {seg('code', 'Code')}
    </div>
  )
}

/**
 * File + line-change overview shown in Conversation view. Each row
 * jumps to that file in Code view via onOpenFile.
 */
function CodeSummary({
  files,
  onOpenFile
}: {
  files: { path: string; patch: string; status?: FileStatus }[]
  onOpenFile: (path: string) => void
}) {
  const rows = files.map(f => ({ path: f.path, status: f.status, ...diffStats(f.patch) }))
  const totalAdd = rows.reduce((s, r) => s + r.additions, 0)
  const totalDel = rows.reduce((s, r) => s + r.deletions, 0)
  return (
    <div className="flex flex-col gap-2">
      <h3 className="m-0 text-[14px] font-semibold">
        Changes{' '}
        <span className="text-subtle font-normal text-[12.5px]">
          · {files.length} file{files.length === 1 ? '' : 's'} ·{' '}
          <span className="text-success">+{totalAdd}</span>{' '}
          <span className="text-danger">−{totalDel}</span>
        </span>
      </h3>
      <ul className="list-none p-0 m-0 flex flex-col border border-hairline rounded-lg overflow-hidden">
        {rows.map(r => (
          <li key={r.path} className="border-b border-hairline last:border-b-0">
            <button
              onClick={() => onOpenFile(r.path)}
              className="flex items-center justify-between gap-3 w-full px-3 py-1.5 text-left hover:bg-hover cursor-pointer [-webkit-app-region:no-drag]"
            >
              <span className="truncate font-mono text-[12px] text-fg">{r.path}</span>
              <span className="shrink-0 tabular-nums text-[11.5px]">
                <span className="text-success">+{r.additions}</span>{' '}
                <span className="text-danger">−{r.deletions}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Full-width Conversation view: PR description, threads, inline
 * comments, and the code summary. In Local Mode only the summary is
 * present (no description or threads exist).
 */
function ConversationPane({
  description,
  conversation,
  inline,
  files,
  onOpenFile
}: {
  description?: string
  conversation?: ConversationComment[]
  inline?: InlineComment[]
  files: { path: string; patch: string; status?: FileStatus }[]
  onOpenFile: (path: string) => void
}) {
  const hasDescription = description != null && description.trim() !== ''
  const inlineByFile = useMemo(() => {
    const map = new Map<string, InlineComment[]>()
    for (const c of inline ?? []) {
      const list = map.get(c.path) ?? []
      list.push(c)
      map.set(c.path, list)
    }
    return map
  }, [inline])
  return (
    <section className="flex-1 min-h-0 overflow-auto bg-surface">
      <div className="max-w-3xl mx-auto px-6 py-6 flex flex-col gap-6">
        {hasDescription && (
          <div className="flex flex-col gap-2">
            <h3 className="m-0 text-[14px] font-semibold">Description</h3>
            <Markdown>{description!}</Markdown>
          </div>
        )}
        <CodeSummary files={files} onOpenFile={onOpenFile} />
        {conversation && conversation.length > 0 && (
          <div className="flex flex-col gap-2">
            <h3 className="m-0 text-[14px] font-semibold">Conversation</h3>
            <div className="flex flex-col gap-2">
              {conversation.map(c => (
                <CommentCard key={`conv-${c.id}`}>
                  <div className="text-[11px] text-subtle">
                    {c.author} · {new Date(c.createdAt).toLocaleString()}
                  </div>
                  <Markdown compact>{c.body}</Markdown>
                </CommentCard>
              ))}
            </div>
          </div>
        )}
        {inlineByFile.size > 0 && (
          <div className="flex flex-col gap-2">
            <h3 className="m-0 text-[14px] font-semibold">Inline comments</h3>
            {[...inlineByFile.entries()].map(([path, comments]) => (
              <div key={path} className="flex flex-col gap-1.5">
                <button
                  onClick={() => onOpenFile(path)}
                  className="self-start text-[11px] uppercase tracking-wide text-muted hover:text-fg cursor-pointer [-webkit-app-region:no-drag]"
                >
                  {path}
                </button>
                {comments.map(c => (
                  <CommentCard key={`inline-${c.id}`}>
                    <div className="text-[11px] text-subtle">
                      {c.author} · line {formatLineRange(c.startLine, c.lineNumber)} (
                      {c.side === 'LEFT' ? 'old' : 'new'}) ·{' '}
                      {new Date(c.createdAt).toLocaleString()}
                    </div>
                    <Markdown compact>{c.body}</Markdown>
                  </CommentCard>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

/**
 * Where the single window is currently pointed. The app navigates
 * between these in place rather than spawning windows (ADR 0003).
 */
type Route =
  | { kind: 'inbox' }
  | { kind: 'local'; repoPath: string }
  | { kind: 'pr'; target: PrTarget }

interface Nav {
  openInbox: () => void
  openLocal: (repoPath: string) => void
  openPR: (target: PrTarget) => void
}

const NavContext = createContext<Nav | null>(null)

/** Navigation helpers for the single window. Available to any view. */
function useNav(): Nav {
  const nav = useContext(NavContext)
  if (!nav) throw new Error('useNav used outside NavContext')
  return nav
}

function initialRoute(): Route {
  switch (window.api.purpose) {
    case 'inbox':
      return { kind: 'inbox' }
    case 'pr-review':
      return window.api.prTarget ? { kind: 'pr', target: window.api.prTarget } : { kind: 'inbox' }
    case 'local':
      return { kind: 'local', repoPath: window.api.repoPath }
  }
}

export default function App() {
  const [helpOpen, setHelpOpen] = useState(false)
  // `window.api` is undefined only in a broken preload; guard before
  // using it for the initial route.
  const hasApi = !!window.api
  const [route, setRoute] = useState<Route>(() => (hasApi ? initialRoute() : { kind: 'inbox' }))
  // The repo to offer "local changes" for from the inbox. Seeded from
  // the launch and updated whenever we navigate into a local view.
  const [localRepo, setLocalRepo] = useState<string | null>(
    () => (hasApi ? window.api.launchRepo : null)
  )

  useKeyboardShortcut({
    key: '?',
    handler: () => setHelpOpen(o => !o)
  })

  useEffect(() => {
    const onShow = () => setHelpOpen(true)
    window.addEventListener(HELP_EVENT, onShow)
    return () => window.removeEventListener(HELP_EVENT, onShow)
  }, [])

  // A second `dv` invocation focuses this window and pushes a route.
  useEffect(() => {
    if (!window.api?.onNavigate) return
    return window.api.onNavigate((r: NavRoute) => {
      if (r.kind === 'local') setLocalRepo(r.repoPath)
      setRoute(r.kind === 'pr' ? { kind: 'pr', target: r.target } : r)
    })
  }, [])

  const nav: Nav = useMemo(
    () => ({
      openInbox: () => setRoute({ kind: 'inbox' }),
      openLocal: repoPath => {
        setLocalRepo(repoPath)
        setRoute({ kind: 'local', repoPath })
      },
      openPR: target => setRoute({ kind: 'pr', target })
    }),
    []
  )

  if (!hasApi) {
    return (
      <main className="h-screen flex flex-col bg-surface">
        <TitleBar>window.api is undefined</TitleBar>
      </main>
    )
  }

  const view = (() => {
    switch (route.kind) {
      case 'inbox':
        return <InboxView localRepo={localRepo} />
      case 'pr':
        return (
          <PRReviewView
            key={`${route.target.owner}/${route.target.repo}/${route.target.number}`}
            target={route.target}
          />
        )
      case 'local':
        return <LocalRoot key={route.repoPath} repoPath={route.repoPath} />
    }
  })()

  return (
    <NavContext.Provider value={nav}>
      {view}
      {helpOpen && <HelpOverlay shortcuts={SHORTCUT_HELP} onClose={() => setHelpOpen(false)} />}
    </NavContext.Provider>
  )
}

const SHORTCUT_HELP: ShortcutHelp[] = [
  { keys: '?', description: 'Show / hide this help' },
  { keys: 'R', description: 'Start review (Local Mode or PR window)' },
  { keys: '⌘↩', description: 'Submit the pending review' },
  { keys: 'Esc', description: 'Discard the pending review (with confirm)' },
  { keys: '⌘B', description: 'Toggle the file tree' },
  { keys: '⌘E', description: 'Switch between Conversation and Code view' },
  { keys: '⌘L', description: 'Toggle the review panel' },
  { keys: '↑ / ↓', description: 'Navigate the file tree (focus the tree first)' }
]

/** Title-bar button that returns to the inbox from a PR or local view. */
function InboxButton() {
  const nav = useNav()
  return (
    <Tooltip content="Back to inbox">
      <Button
        variant="ghost"
        size="sm"
        onClick={nav.openInbox}
        aria-label="Back to inbox"
        className="[-webkit-app-region:no-drag]"
      >
        ‹ Inbox
      </Button>
    </Tooltip>
  )
}

function LocalRoot({ repoPath: repo }: { repoPath: string }) {
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
      <main className="h-screen flex flex-col bg-surface">
        <TitleBar>
          <InboxButton />
          <span className="flex-1 truncate">
            {status.type === 'loading' && 'Loading…'}
            {status.type === 'empty' && `${status.repo} — no changes for this source`}
            {status.type === 'error' && `Error: ${status.message}`}
          </span>
          {sourcePicker}
          <GhAuthIndicator />
          <HelpButton />
        </TitleBar>
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
    <div className="flex items-center gap-1.5 text-[12px]">
      <Select
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
        className="text-[12px]"
      >
        <option value="working-tree-vs-head">Working tree vs HEAD</option>
        <option value="staged-vs-head">Staged vs HEAD</option>
        <option value="working-tree-vs-staged">Working tree vs staged</option>
        <option value="branch-vs-base">Branch vs base</option>
        <option value="commit-range">Commit range</option>
        <option value="single-commit">Single commit</option>
      </Select>
      {value.type === 'branch-vs-base' && (
        <>
          <Input
            value={value.head}
            onChange={e => onChange({ ...value, head: e.target.value })}
            placeholder="head"
            className="w-[100px] text-[11.5px]"
          />
          <span className="text-subtle">vs</span>
          <Input
            value={value.base}
            onChange={e => onChange({ ...value, base: e.target.value })}
            placeholder="base"
            className="w-[100px] text-[11.5px]"
          />
        </>
      )}
      {value.type === 'commit-range' && (
        <>
          <Input
            value={value.from}
            onChange={e => onChange({ ...value, from: e.target.value })}
            placeholder="from"
            className="w-[90px] text-[11.5px]"
          />
          <span className="text-subtle">..</span>
          <Input
            value={value.to}
            onChange={e => onChange({ ...value, to: e.target.value })}
            placeholder="to"
            className="w-[90px] text-[11.5px]"
          />
        </>
      )}
      {value.type === 'single-commit' && (
        <Input
          value={value.sha}
          onChange={e => onChange({ ...value, sha: e.target.value })}
          placeholder="sha or ref"
          className="w-[140px] text-[11.5px]"
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
        const files = splitPatchByFile(rawDiff)
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
      <main className="h-screen flex flex-col bg-surface">
        <TitleBar>
          <InboxButton />
          <span className="flex-1 truncate">
            {target.owner}/{target.repo}#{target.number}
            {status.type === 'loading' && ' — loading…'}
            {status.type === 'error' && ` — error: ${status.message}`}
          </span>
          <OpenOnGithubButton url={prHtmlUrl(target)} />
          <GhAuthIndicator />
          <HelpButton />
        </TitleBar>
      </main>
    )
  }

  return <PRReviewLoaded {...status} target={target} />
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

  const [submitting, setSubmitting] = useState(false)
  const codeViewRef = useRef<CodeViewHandle<AnnotationMeta>>(null)

  const buildSnapshot = useCallback(
    (): DiffSnapshot => ({
      files: files.map(f => ({ ...f, status: 'modified' as const, isBinary: false, oldPath: undefined }))
    }),
    [files]
  )

  const draft = useReviewDraft({
    target: reviewTarget,
    buildSnapshot,
    defaultEvent: 'COMMENT',
    onAfterCommit: () => codeViewRef.current?.clearSelectedLines()
  })
  const { pending } = draft

  const paths = useMemo(() => files.map(f => f.path), [files])
  const sortByDiffOrder = useDiffOrderSort(paths)
  const { model } = useFileTree({
    paths,
    sort: sortByDiffOrder,
    initialExpansion: 'open',
    initialSelectedPaths: paths.length > 0 ? [paths[0]] : []
  })
  const selectedPaths = useFileTreeSelection(model)
  const selectedPath = selectedPaths[0] ?? paths[0]

  const startEdit = draft.startEdit
  const updateEditBody = draft.updateBody
  const submitEdit = draft.commit
  const cancelEdit = draft.cancel
  const removeFromPending = draft.remove
  const setSummary = draft.setSummary
  const setEvent = draft.setEvent
  const editingComments = draft.editing

  // New drafts (not yet added to pending) also need an annotation slot
  // so the editor can render at the right line.
  const annotationsByPath = useMemo(
    () =>
      buildAnnotationMap({
        existing: inline,
        pending: pending?.lineComments,
        drafts: draftComments(editingComments)
      }),
    [inline, pending, editingComments]
  )

  // PR files carry no binary flag; they're all text patches from GitHub.
  const codeFiles = useMemo(() => files.map(f => ({ ...f, isBinary: false })), [files])
  const shell = useReviewSurfaceShell({ files: codeFiles, annotationsByPath, model, selectedPath, draft })
  const { openFile, startReview, startDraft, codeMode, setCodeMode, fileTreeOpen, reviewPanelOpen } = shell

  type Destination = 'github' | 'agent'
  const [destination, setDestination] = useState<Destination>('github')

  const submit = async () => {
    if (!pending) return
    setSubmitting(true)
    try {
      if (destination === 'github') {
        const { url } = await window.api.reviewSubmitToGithub(pending)
        draft.markSubmitted()
        toast.success('Review submitted', {
          actionLabel: 'Open on GitHub',
          onAction: () => window.open(url, '_blank', 'noreferrer')
        })
      } else {
        await window.api.reviewSubmitToAgent(pending)
        draft.markSubmitted()
        toast.success('Copied to clipboard', { timeout: 3000 })
      }
    } catch (err) {
      toast.error('Submit failed', {
        description: (err as Error).message,
        actionLabel: 'Retry',
        onAction: submit
      })
    } finally {
      setSubmitting(false)
    }
  }

  const discard = async () => {
    if (!pending) return
    const ok = await confirm({
      title: 'Discard pending review?',
      description: 'All drafted comments and the summary will be lost.',
      confirmLabel: 'Discard',
      destructive: true
    })
    if (!ok) return
    draft.discard()
  }

  useKeyboardShortcut(pending ? null : { key: 'r', handler: startReview })
  useKeyboardShortcut(pending ? { key: 'Enter', meta: true, allowInForm: true, handler: submit } : null)
  useKeyboardShortcut(pending ? { key: 'Escape', handler: discard } : null)

  return (
    <main className="h-screen flex flex-col bg-surface">
      <TitleBar>
        <InboxButton />
        <span className="flex-1 truncate min-w-0">
          <span className="font-semibold">
            {target.owner}/{target.repo}#{pr.number}
          </span>
          <span className="ml-2">{pr.title}</span>
          <span className="text-subtle ml-2">
            · {pr.author} · {pr.headRef} → {pr.baseRef} · +{pr.additions} −{pr.deletions}
          </span>
          {pending && (
            <span className="ml-2 text-subtle">
              · review in progress ({pending.lineComments.length} comment{pending.lineComments.length === 1 ? '' : 's'})
            </span>
          )}
        </span>
        <ViewModeToggle
          mode={codeMode ? 'code' : 'conversation'}
          onMode={m => setCodeMode(m === 'code')}
        />
        {!pending && (
          <Button variant="primary" onClick={startReview}>
            Start review
          </Button>
        )}
        <StateBadge state={pr.state} />
        <OpenOnGithubButton url={pr.url || prHtmlUrl(target)} />
        <GhAuthIndicator />
        <HelpButton />
      </TitleBar>
      {!codeMode ? (
        <ConversationPane
          description={pr.body}
          conversation={conversation}
          inline={inline}
          files={files}
          onOpenFile={openFile}
        />
      ) : (
        <ReviewSurface
          panesId="pr-review-panes"
          model={model}
          fileTreeOpen={fileTreeOpen}
          treeSize="18%"
          diffSize="60%"
          panelSize="22%"
          codeViewRef={codeViewRef}
          diffSectionRef={shell.diffSectionRef}
          items={shell.codeViewItems}
          renderHeaderPrefix={shell.renderHeaderPrefix}
          enableLineSelection
          onGutterDraft={startDraft}
          emptyState="No diff to display"
          renderAnnotation={ann => {
            const meta = ann.metadata!
            if (meta.kind === 'existing') {
              const replyDraftId = meta.comment.id
              const hasReply =
                (pending?.lineComments ?? []).some(c => c.inReplyToId === replyDraftId) ||
                Array.from(editingComments.values()).some(
                  e => e.isNew && e.comment.inReplyToId === replyDraftId
                )
              return (
                <ExistingThreadAnnotation
                  comment={meta.comment}
                  hasReply={hasReply}
                  onReply={() =>
                    startDraft({
                      path: meta.comment.path,
                      anchor: {
                        lineNumber: meta.comment.lineNumber,
                        side: meta.comment.side === 'LEFT' ? 'old' : 'new'
                      },
                      inReplyToId: meta.comment.id
                    })
                  }
                />
              )
            }
            const id = meta.comment.id
            const editing = editingComments.get(id)
            if (editing) {
              return (
                <PendingCommentEditor
                  comment={editing.comment}
                  onChange={body => updateEditBody(id, body)}
                  onSubmit={() => submitEdit(id)}
                  onCancel={() => cancelEdit(id)}
                />
              )
            }
            const submitted = pending?.lineComments.find(c => c.id === id)
            if (!submitted) return null
            return (
              <PendingCommentCard
                comment={submitted}
                onEdit={() => startEdit(id)}
                onDelete={() => removeFromPending(id)}
              />
            )
          }}
          reviewPanel={
            pending && reviewPanelOpen ? (
              <PRReviewPanel
                pending={pending}
                submitting={submitting}
                destination={destination}
                onDestination={setDestination}
                onSummary={setSummary}
                onEvent={setEvent}
                onSubmit={submit}
                onDiscard={discard}
              />
            ) : null
          }
        />
      )}
    </main>
  )
}

function PRReviewPanel({
  pending,
  submitting,
  destination,
  onDestination,
  onSummary,
  onEvent,
  onSubmit,
  onDiscard
}: {
  pending: PendingReview
  submitting: boolean
  destination: 'github' | 'agent'
  onDestination: (d: 'github' | 'agent') => void
  onSummary: (s: string) => void
  onEvent: (e: ReviewEvent) => void
  onSubmit: () => void
  onDiscard: () => void
}) {
  const newCount = pending.lineComments.filter(c => c.inReplyToId == null).length
  const replyCount = pending.lineComments.length - newCount
  return (
    <aside className="h-full w-full bg-sidebar p-3 flex flex-col gap-3 overflow-hidden">
      <h3 className="m-0 text-[14px] font-semibold">Pending PR review</h3>

      <div className="text-[12px] text-muted">
        {pending.lineComments.length === 0 ? (
          'No comments yet — click the + in the gutter to add one'
        ) : (
          <>
            {newCount} new {newCount === 1 ? 'comment' : 'comments'}
            {replyCount > 0 && ` · ${replyCount} ${replyCount === 1 ? 'reply' : 'replies'}`}
          </>
        )}
      </div>

      {pending.lineComments.length > 0 && (
        <div className="overflow-auto flex flex-col gap-1.5 max-h-[40%] shrink-0">
          {pending.lineComments.map(c => (
            <div
              key={c.id}
              className="p-1.5 border border-hairline rounded text-[11.5px] bg-elevated"
            >
              <div className="text-subtle text-[10.5px] truncate">
                {c.path}:{formatLineRange(c.startLineNumber, c.lineNumber)}
                {c.inReplyToId != null && ' · reply'}
              </div>
              <div className="line-clamp-2 text-fg">{c.body || '(empty)'}</div>
            </div>
          ))}
        </div>
      )}

      <label className="flex flex-col gap-1 flex-1 min-h-0">
        <span className="text-[11px] text-muted">Summary</span>
        <Textarea
          value={pending.summary}
          onChange={e => onSummary(e.target.value)}
          placeholder="Overall feedback…"
          className="w-full text-[12.5px] flex-1 min-h-[80px]"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-muted">Submit to</span>
        <Select
          value={destination}
          onChange={e => onDestination(e.target.value as 'github' | 'agent')}
        >
          <option value="github">GitHub</option>
          <option value="agent">Agent (clipboard)</option>
        </Select>
      </label>

      {destination === 'github' && (
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-muted">Submit as</span>
          <Select
            value={pending.event ?? 'COMMENT'}
            onChange={e => onEvent(e.target.value as ReviewEvent)}
          >
            <option value="COMMENT">Comment</option>
            <option value="APPROVE">Approve</option>
            <option value="REQUEST_CHANGES">Request changes</option>
          </Select>
        </label>
      )}

      <div className="flex gap-2">
        <Button
          variant="primary"
          onClick={onSubmit}
          disabled={submitting}
          className="flex-1"
        >
          {submitting
            ? 'Submitting…'
            : destination === 'agent'
              ? 'Copy for Agent'
              : 'Submit review'}
        </Button>
        <Button onClick={onDiscard}>Discard</Button>
      </div>
    </aside>
  )
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

function prHtmlUrl(t: PrTarget): string {
  return `https://github.com/${t.owner}/${t.repo}/pull/${t.number}`
}

function OpenOnGithubButton({ url }: { url: string }) {
  return (
    <Tooltip content="Open PR on GitHub">
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        aria-label="Open PR on GitHub"
        className="inline-flex items-center gap-1 text-[11.5px] text-muted hover:text-fg px-1.5 py-0.5 rounded hover:bg-hover [-webkit-app-region:no-drag]"
      >
        <ExternalLink size={12} strokeWidth={2.2} />
      </a>
    </Tooltip>
  )
}

/**
 * Minimum interval between automatic (focus / poll) inbox refreshes.
 * Each refresh fans out to 3 search/issues calls, and GitHub's search
 * resource caps at 30/min — without this, rapid focus toggling burns
 * through the quota in seconds and trips a 403. The manual Refresh
 * button bypasses this cooldown.
 */
const INBOX_AUTO_REFRESH_COOLDOWN_MS = 30_000

function InboxView({ localRepo }: { localRepo: string | null }) {
  const nav = useNav()
  const [status, setStatus] = useState<InboxStatus>({ type: 'loading' })
  const [lastFetched, setLastFetched] = useState<number | null>(null)
  const [urlInput, setUrlInput] = useState('')
  const [urlError, setUrlError] = useState('')
  const lastLoadAtRef = useRef(0)

  const load = (opts: { manual?: boolean } = {}) => {
    if (!opts.manual && Date.now() - lastLoadAtRef.current < INBOX_AUTO_REFRESH_COOLDOWN_MS) {
      return
    }
    lastLoadAtRef.current = Date.now()
    window.api
      .githubListPRs()
      .then(result => {
        setStatus({ type: 'loaded', result })
        setLastFetched(Date.now())
      })
      .catch((err: Error) => setStatus({ type: 'error', message: err.message ?? String(err) }))
  }

  useEffect(() => {
    load({ manual: true })
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
    <main className="h-screen flex flex-col bg-surface">
      <TitleBar>
        <span className="flex-1 truncate">
          <span className="font-semibold text-fg">PR Inbox</span>
          {lastFetched && (
            <span className="ml-3 text-subtle">
              · updated {new Date(lastFetched).toLocaleTimeString()}
            </span>
          )}
        </span>
        <Button onClick={() => load({ manual: true })}>Refresh</Button>
        <GhAuthIndicator />
        <HelpButton />
      </TitleBar>
      <section className="flex-1 overflow-auto px-4 py-3">
        {localRepo && (
          <button
            onClick={() => nav.openLocal(localRepo)}
            className="flex items-center gap-2 w-full mb-4 px-3 py-2 text-left text-[12.5px] text-fg rounded-[7px] border border-hairline hover:bg-hover cursor-pointer [-webkit-app-region:no-drag]"
          >
            <span>📁</span>
            <span className="truncate">
              Local changes in <span className="font-medium">{localRepo}</span>
            </span>
          </button>
        )}
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
            nav.openPR(target)
          }}
          className="flex gap-2 mb-4"
        >
          <Input
            type="text"
            value={urlInput}
            onChange={e => setUrlInput(e.target.value)}
            placeholder="Paste a GitHub PR URL…"
            className="flex-1 px-2 py-1 text-[12.5px]"
          />
          <Button type="submit" variant="primary">Open</Button>
        </form>
        {urlError && <div className="text-danger text-[12px] mb-2">{urlError}</div>}
        {status.type === 'loading' && <div className="text-subtle">Loading…</div>}
        {status.type === 'error' && (
          <div className="text-danger">Failed to load: {status.message}</div>
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
    <div className="mb-5">
      <div className="section-label px-1 pb-1.5">
        {title} <span className="text-subtle font-normal">· {prs.length}</span>
      </div>
      {prs.length === 0 ? (
        <div className="text-subtle text-[12.5px] px-2.5 py-0.5">None.</div>
      ) : (
        <ul className="list-none p-0 m-0 flex flex-col gap-0.5">
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
  const nav = useNav()
  const onClick = () => {
    const [owner, repo] = pr.repo.split('/')
    nav.openPR({ owner, repo, number: pr.number })
  }
  return (
    <button
      onClick={onClick}
      className="grid grid-cols-[1fr_auto] items-center gap-2.5 w-full px-2.5 py-1.5 text-left text-[12.5px] text-fg rounded-[7px] hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent focus-visible:-outline-offset-2 cursor-pointer [-webkit-app-region:no-drag]"
    >
      <span className="overflow-hidden text-ellipsis whitespace-nowrap">
        <span className="font-medium">{pr.title}</span>
        <span className="text-subtle ml-2">
          {pr.repo} #{pr.number} · {pr.author}
        </span>
      </span>
      <span className="flex items-center gap-2">
        {pr.commentCount > 0 && (
          <span className="text-subtle text-[11px]">💬 {pr.commentCount}</span>
        )}
        <StateBadge state={pr.state} />
      </span>
    </button>
  )
}

function StateBadge({ state }: { state: PullRequestSummary['state'] }) {
  const tone = (
    {
      open: 'success',
      draft: 'neutral',
      merged: 'purple',
      closed: 'danger'
    } as const
  )[state]
  return <Badge tone={tone}>{state}</Badge>
}

const HELP_EVENT = 'dv:show-help'

function HelpButton() {
  return (
    <Tooltip content="Keyboard shortcuts" shortcut="?">
      <Button
        size="sm"
        onClick={() => window.dispatchEvent(new CustomEvent(HELP_EVENT))}
        aria-label="Keyboard shortcuts"
        className="rounded-full px-2"
      >
        ?
      </Button>
    </Tooltip>
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

  const cls = 'cursor-help'

  if (!auth) return <Badge className={cls}>gh: …</Badge>

  switch (auth.kind) {
    case 'authenticated':
      return (
        <Tooltip content="GitHub CLI is authenticated">
          <Badge tone="success" className={cls}>gh @{auth.user}</Badge>
        </Tooltip>
      )
    case 'not-authenticated':
      return (
        <Tooltip content="Run `gh auth login` in a terminal">
          <Badge tone="warning" className={cls}>gh: not signed in</Badge>
        </Tooltip>
      )
    case 'gh-not-installed':
      return (
        <Tooltip content="Install gh: https://cli.github.com">
          <Badge tone="danger" className={cls}>gh: not installed</Badge>
        </Tooltip>
      )
    case 'error':
      return (
        <Tooltip content={auth.message}>
          <Badge tone="danger" className={cls}>gh: error</Badge>
        </Tooltip>
      )
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
  const codeViewRef = useRef<CodeViewHandle<AnnotationMeta>>(null)

  const buildSnapshot = useCallback((): DiffSnapshot => ({ files: liveFiles }), [liveFiles])
  const draft = useReviewDraft({
    target,
    buildSnapshot,
    onAfterCommit: () => codeViewRef.current?.clearSelectedLines()
  })
  const { pending } = draft
  const editingComments = draft.editing

  // Snapshot semantics (ADR 0001): when a review is pending, show the snapshot,
  // not the live working tree. The live diff is only used to seed a new review.
  const files = pending ? pending.snapshot.files : liveFiles

  const paths = useMemo(() => files.map(f => f.path), [files])
  const gitStatus = useMemo(
    () => files.map(f => ({ path: f.path, status: f.status })),
    [files]
  )

  const sortByDiffOrder = useDiffOrderSort(paths)
  const { model } = useFileTree({
    paths,
    gitStatus,
    sort: sortByDiffOrder,
    initialExpansion: 'open',
    initialSelectedPaths: paths.length > 0 ? [paths[0]] : []
  })

  const selectedPaths = useFileTreeSelection(model)
  const selectedPath = selectedPaths[0] ?? paths[0]
  const selectedFile = files.find(f => f.path === selectedPath)

  const annotationsByPath = useMemo(
    () => buildAnnotationMap({ pending: pending?.lineComments, drafts: draftComments(editingComments) }),
    [pending, editingComments]
  )

  const shell = useReviewSurfaceShell({ files, annotationsByPath, model, selectedPath, draft })
  const { openFile, startReview, startDraft, codeMode, setCodeMode, fileTreeOpen, reviewPanelOpen } = shell

  const refreshSnapshot = async () => {
    if (!pending) return
    const ok = await confirm({
      title: 'Refresh snapshot?',
      description:
        'Comments anchored to lines that have moved or been removed may become stale.',
      confirmLabel: 'Refresh'
    })
    if (!ok) return
    const { files: fresh } = await window.api.getLocalDiff(repo)
    draft.refresh({ files: fresh })
  }

  const startEdit = draft.startEdit
  const updateEditBody = draft.updateBody
  const submitEdit = draft.commit
  const cancelEdit = draft.cancel
  const removeFromPending = draft.remove
  const updateSummary = draft.setSummary

  const submitToAgent = async () => {
    if (!pending) return
    try {
      await window.api.reviewSubmitToAgent(pending)
      draft.markSubmitted()
      toast.success('Copied to clipboard', { timeout: 3000 })
    } catch (err) {
      toast.error('Copy failed', { description: (err as Error).message })
    }
  }

  const discardReview = async () => {
    if (!pending) return
    const ok = await confirm({
      title: 'Discard pending review?',
      description: 'All drafted comments and the summary will be lost.',
      confirmLabel: 'Discard',
      destructive: true
    })
    if (!ok) return
    draft.discard()
  }

  useKeyboardShortcut(pending ? null : { key: 'r', handler: startReview })
  useKeyboardShortcut(pending ? { key: 'Enter', meta: true, allowInForm: true, handler: submitToAgent } : null)
  useKeyboardShortcut(pending ? { key: 'Escape', handler: discardReview } : null)

  return (
    <main className="h-screen flex flex-col bg-surface">
      <TitleBar>
        <InboxButton />
        <span className="flex-1 truncate min-w-0">
          <span className="text-fg">{repo}</span>{' '}
          <span className="text-subtle">({files.length} file{files.length === 1 ? '' : 's'})</span>
          {pending && (
            <span className="ml-3 text-subtle">
              · review in progress ({pending.lineComments.length} comment{pending.lineComments.length === 1 ? '' : 's'})
            </span>
          )}
        </span>
        {sourcePicker}
        <ViewModeToggle
          mode={codeMode ? 'code' : 'conversation'}
          onMode={m => setCodeMode(m === 'code')}
        />
        {!pending && (
          <Button variant="primary" onClick={startReview}>
            Start review
          </Button>
        )}
        <GhAuthIndicator />
        <HelpButton />
      </TitleBar>
      {!codeMode ? (
        <ConversationPane files={files} onOpenFile={openFile} />
      ) : (
        <ReviewSurface
          panesId="local-panes"
          model={model}
          fileTreeOpen={fileTreeOpen}
          treeSize="20%"
          diffSize={pending ? '55%' : '80%'}
          panelSize="25%"
          codeViewRef={codeViewRef}
          diffSectionRef={shell.diffSectionRef}
          items={shell.codeViewItems}
          renderHeaderPrefix={shell.renderHeaderPrefix}
          onGutterDraft={startDraft}
          emptyState={
            selectedFile?.isBinary ? 'Binary file — no diff preview' : 'No diff to display'
          }
          renderAnnotation={ann => {
            const meta = ann.metadata!
            if (meta.kind === 'existing') return null
            const id = meta.comment.id
            const editing = editingComments.get(id)
            if (editing) {
              return (
                <PendingCommentEditor
                  comment={editing.comment}
                  onChange={body => updateEditBody(id, body)}
                  onSubmit={() => submitEdit(id)}
                  onCancel={() => cancelEdit(id)}
                />
              )
            }
            const submitted = pending?.lineComments.find(c => c.id === id)
            if (!submitted) return null
            return (
              <PendingCommentCard
                comment={submitted}
                onEdit={() => startEdit(id)}
                onDelete={() => removeFromPending(id)}
              />
            )
          }}
          reviewPanel={
            pending && reviewPanelOpen ? (
              <ReviewPanel
                pending={pending}
                onSummaryChange={updateSummary}
                onRefresh={refreshSnapshot}
                onSubmit={submitToAgent}
                onDiscard={discardReview}
              />
            ) : null
          }
        />
      )}
    </main>
  )
}

function ReviewPanel({
  pending,
  onSummaryChange,
  onRefresh,
  onSubmit,
  onDiscard
}: {
  pending: PendingReview
  onSummaryChange: (summary: string) => void
  onRefresh: () => void
  onSubmit: () => void
  onDiscard: () => void
}) {
  const count = pending.lineComments.length
  return (
    <aside className="h-full w-full bg-sidebar p-3 flex flex-col gap-3 overflow-hidden">
      <h3 className="m-0 text-[14px] font-semibold">Pending review</h3>

      <div className="text-[12px] text-muted">
        {count === 0 ? 'No comments yet — click the + in the gutter' : `${count} ${count === 1 ? 'comment' : 'comments'}`}
      </div>

      {count > 0 && (
        <div className="overflow-auto flex flex-col gap-1.5 max-h-[40%] shrink-0">
          {pending.lineComments.map(c => (
            <div
              key={c.id}
              className="p-1.5 border border-hairline rounded text-[11.5px] bg-elevated"
            >
              <div className="text-subtle text-[10.5px] truncate">
                {c.path}:{formatLineRange(c.startLineNumber, c.lineNumber)}
              </div>
              <div className="line-clamp-2 text-fg">{c.body || '(empty)'}</div>
            </div>
          ))}
        </div>
      )}

      <label className="flex flex-col gap-1 flex-1 min-h-0">
        <span className="text-[11px] text-muted">Summary</span>
        <Textarea
          value={pending.summary}
          onChange={e => onSummaryChange(e.target.value)}
          placeholder="Overall feedback for the agent…"
          className="w-full text-[12.5px] flex-1 min-h-[80px]"
        />
      </label>

      <div className="flex gap-2">
        <Button variant="primary" onClick={onSubmit} className="flex-1">
          Submit to Agent (copy)
        </Button>
        <Tooltip content="Re-snapshot the diff">
          <Button variant="ghost" size="icon" onClick={onRefresh} aria-label="Re-snapshot the diff">
            ↻
          </Button>
        </Tooltip>
        <Button onClick={onDiscard}>Discard</Button>
      </div>
    </aside>
  )
}

function CommentCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="border border-hairline rounded-lg p-2 flex flex-col gap-1.5 bg-elevated">
      {children}
    </div>
  )
}
