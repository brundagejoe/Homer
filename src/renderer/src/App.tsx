import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, ExternalLink } from 'lucide-react'
import { CodeView } from '@pierre/diffs/react'
import { processFile } from '@pierre/diffs'
import type { CodeViewDiffItem, DiffLineAnnotation } from '@pierre/diffs'
import { FileTree, useFileTree, useFileTreeSelection } from '@pierre/trees/react'
import { useKeyboardShortcut } from './useKeyboardShortcut'
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
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle
} from '@/components/ui/resizable'
import { TitleBar } from '@/components/TitleBar'
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

type Annotator<T> = (path: string) => DiffLineAnnotation<T>[] | undefined

function buildCodeViewItems<T>(
  files: { path: string; patch: string; isBinary: boolean }[],
  annotationsFor?: Annotator<T>,
  collapsedPaths?: ReadonlySet<string>
): CodeViewDiffItem<T>[] {
  const items: CodeViewDiffItem<T>[] = []
  for (const f of files) {
    if (f.isBinary || !f.patch) continue
    const fileDiff = processFile(f.patch)
    if (!fileDiff) continue
    const collapsed = collapsedPaths?.has(f.path) ?? false
    items.push({
      id: f.path,
      type: 'diff',
      fileDiff,
      annotations: annotationsFor?.(f.path),
      collapsed,
      // Pierre uses `version` to detect item changes; bumping it when
      // collapse state changes forces a re-render of that file's body.
      version: collapsed ? 1 : 0
    })
  }
  return items
}

function ChevronToggle({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const Icon = collapsed ? ChevronRight : ChevronDown
  const label = collapsed ? 'Expand file' : 'Collapse file'
  return (
    <Tooltip content={label}>
      <button
        onClick={onToggle}
        aria-label={label}
        className="inline-flex items-center justify-center w-4 h-4 p-0 m-0 appearance-none bg-transparent border-0 rounded-none shadow-none text-subtle hover:text-fg hover:bg-hover/60 [-webkit-app-region:no-drag]"
      >
        <Icon size={12} strokeWidth={2.4} />
      </button>
    </Tooltip>
  )
}

function localReviewTarget(repoPath: string, source: DiffSourceSpec): ReviewTarget {
  return { kind: 'local', repoPath, source }
}

export default function App() {
  const [helpOpen, setHelpOpen] = useState(false)

  useKeyboardShortcut({
    key: '?',
    handler: () => setHelpOpen(o => !o)
  })

  useEffect(() => {
    const onShow = () => setHelpOpen(true)
    window.addEventListener(HELP_EVENT, onShow)
    return () => window.removeEventListener(HELP_EVENT, onShow)
  }, [])

  if (!window.api) {
    return (
      <main className="h-screen flex flex-col bg-surface">
        <TitleBar>window.api is undefined</TitleBar>
      </main>
    )
  }

  const view = (() => {
    switch (window.api.purpose) {
      case 'inbox':
        return <InboxView />
      case 'pr-review':
        return window.api.prTarget ? <PRReviewView target={window.api.prTarget} /> : <FatalError msg="PR target missing from launch args" />
      case 'local':
        return <LocalRoot />
    }
  })()

  return (
    <>
      {view}
      {helpOpen && <HelpOverlay shortcuts={SHORTCUT_HELP} onClose={() => setHelpOpen(false)} />}
    </>
  )
}

const SHORTCUT_HELP: ShortcutHelp[] = [
  { keys: '?', description: 'Show / hide this help' },
  { keys: 'R', description: 'Start review (Local Mode or PR window)' },
  { keys: '⌘↩', description: 'Submit the pending review' },
  { keys: 'Esc', description: 'Discard the pending review (with confirm)' },
  { keys: '↑ / ↓', description: 'Navigate the file tree (focus the tree first)' }
]

function FatalError({ msg }: { msg: string }) {
  return (
    <main className="h-screen flex flex-col bg-surface">
      <TitleBar>{msg}</TitleBar>
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
      <main className="h-screen flex flex-col bg-surface">
        <TitleBar>
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
      <main className="h-screen flex flex-col bg-surface">
        <TitleBar>
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
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    window.api.reviewGet(reviewTarget).then(setPending)
  }, [reviewTarget])

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
    setSubmitting(true)
    try {
      const { url } = await window.api.reviewSubmitToGithub(pending)
      setPending(null)
      toast.success('Review submitted', {
        actionLabel: 'Open on GitHub',
        onAction: () => window.open(url, '_blank', 'noreferrer')
      })
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
    await window.api.reviewDelete(reviewTarget)
    setPending(null)
  }

  useKeyboardShortcut(pending ? null : { key: 'r', handler: startReview })
  useKeyboardShortcut(pending ? { key: 'Enter', meta: true, allowInForm: true, handler: submit } : null)
  useKeyboardShortcut(pending ? { key: 'Escape', handler: discard } : null)

  const annotationsByPath = useMemo(() => {
    const map = new Map<string, DiffLineAnnotation<InlineComment>[]>()
    for (const c of inline) {
      const list = map.get(c.path) ?? []
      list.push({
        side: c.side === 'LEFT' ? 'deletions' : 'additions',
        lineNumber: c.lineNumber,
        metadata: c
      })
      map.set(c.path, list)
    }
    return map
  }, [inline])

  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(new Set())
  const [conversationOpen, setConversationOpen] = useState(true)

  const toggleCollapsed = useCallback((path: string) => {
    setCollapsedPaths(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  const codeViewItems = useMemo(
    () =>
      buildCodeViewItems<InlineComment>(
        files.map(f => ({ ...f, isBinary: false })),
        p => annotationsByPath.get(p),
        collapsedPaths
      ),
    [files, annotationsByPath, collapsedPaths]
  )

  const totalThreads = conversation.length + inline.length

  const diffSectionRef = useRef<HTMLElement>(null)
  const codeViewItemsRef = useRef(codeViewItems)
  codeViewItemsRef.current = codeViewItems
  useEffect(() => {
    if (!selectedPath || !diffSectionRef.current) return
    setCollapsedPaths(prev => {
      if (!prev.has(selectedPath)) return prev
      const next = new Set(prev)
      next.delete(selectedPath)
      return next
    })
    requestAnimationFrame(() => {
      const idx = codeViewItemsRef.current.findIndex(i => i.id === selectedPath)
      if (idx < 0) return
      const containers = diffSectionRef.current?.querySelectorAll('diffs-container')
      const target = containers?.[idx] as HTMLElement | undefined
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }, [selectedPath])

  const renderHeaderPrefix = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (item: any) => (
      <ChevronToggle
        collapsed={collapsedPaths.has(item.id)}
        onToggle={() => toggleCollapsed(item.id)}
      />
    ),
    [collapsedPaths, toggleCollapsed]
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
    <main className="h-screen flex flex-col bg-surface">
      <TitleBar>
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
        {!pending && (
          <Button variant="primary" onClick={startReview}>
            Start review
          </Button>
        )}
        <Tooltip content={conversationOpen ? 'Hide conversation' : 'Show conversation'}>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setConversationOpen(o => !o)}
            aria-label={conversationOpen ? 'Hide conversation' : 'Show conversation'}
          >
            💬{totalThreads > 0 ? ` ${totalThreads}` : ''}
          </Button>
        </Tooltip>
        <StateBadge state={pr.state} />
        <OpenOnGithubButton url={pr.url || prHtmlUrl(target)} />
        <GhAuthIndicator />
        <HelpButton />
      </TitleBar>
      <ResizablePanelGroup orientation="horizontal" id="pr-review-panes" className="flex-1 min-h-0">
        <ResizablePanel defaultSize="18%" minSize="10%" maxSize="40%" className="overflow-hidden">
          <aside className="w-full h-full overflow-auto bg-sidebar py-1.5">
            <FileTree model={model} />
          </aside>
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel defaultSize="60%" minSize="30%" className="overflow-hidden">
        <section
          ref={diffSectionRef}
          className="diff-host w-full h-full overflow-auto"
        >
          {pr.body && (
            <details open className="px-4 py-2 border-b border-hairline shrink-0 bg-surface">
              <summary className="cursor-pointer text-muted text-[12.5px]">
                Description
              </summary>
              <div className="mt-2">
                <Markdown>{pr.body}</Markdown>
              </div>
            </details>
          )}
          {codeViewItems.length > 0 ? (
            <CodeView
              items={codeViewItems}
              renderHeaderPrefix={renderHeaderPrefix}
              renderAnnotation={(ann) => {
                const meta = (ann as DiffLineAnnotation<InlineComment>).metadata!
                return (
                  <div className="review-annotation rounded-md px-2.5 py-1.5 mx-2 my-1 text-[12.5px]">
                    <div className="text-[11px] text-subtle">
                      {meta.author} · {new Date(meta.createdAt).toLocaleString()}
                    </div>
                    <Markdown compact>{meta.body}</Markdown>
                  </div>
                )
              }}
            />
          ) : (
            <div className="p-4 text-subtle">No diff to display</div>
          )}
        </section>
        </ResizablePanel>
        {pending && (
          <>
            <ResizableHandle />
            <ResizablePanel defaultSize="22%" minSize="15%" maxSize="45%" className="overflow-hidden">
              <PRReviewPanel
                pending={pending}
                selectedPath={selectedPath}
                submitting={submitting}
                onAddComment={() => addComment(selectedPath)}
                onEditComment={editComment}
                onRemoveComment={removeComment}
                onSummary={setSummary}
                onEvent={setEvent}
                onSubmit={submit}
                onDiscard={discard}
              />
            </ResizablePanel>
          </>
        )}
        {conversationOpen && (
        <>
        <ResizableHandle />
        <ResizablePanel defaultSize="20%" minSize="15%" maxSize="40%" className="overflow-hidden">
        <aside className="w-full h-full px-3.5 py-3 flex flex-col gap-2 bg-sidebar overflow-hidden">
          <div className="flex justify-between items-center">
            <h3 className="m-0 text-[14px] font-semibold">Conversation</h3>
            <Tooltip content="Hide conversation">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setConversationOpen(false)}
                aria-label="Hide conversation"
              >
                ×
              </Button>
            </Tooltip>
          </div>
          <div className="overflow-auto flex flex-col gap-2">
            {conversation.length === 0 && inlineForFile.length === 0 && (
              <div className="text-subtle text-[12.5px]">No comments yet.</div>
            )}
            {conversation.map(c => (
              <CommentCard key={`conv-${c.id}`}>
                <div className="text-[11px] text-subtle">
                  {c.author} · {new Date(c.createdAt).toLocaleString()}
                </div>
                <Markdown compact>{c.body}</Markdown>
              </CommentCard>
            ))}
            {inlineForFile.length > 0 && (
              <div className="text-[11px] uppercase tracking-wide text-muted mt-3">
                Inline on {selectedPath}
              </div>
            )}
            {inlineForFile.map(c => {
              const replies = repliesByParent.get(c.id) ?? []
              return (
                <CommentCard key={`inline-${c.id}`}>
                  <div className="text-[11px] text-subtle">
                    {c.author} · line {c.lineNumber} ({c.side === 'LEFT' ? 'old' : 'new'}) ·{' '}
                    {new Date(c.createdAt).toLocaleString()}
                  </div>
                  <Markdown compact>{c.body}</Markdown>
                  {pending && replies.length === 0 && (
                    <Button size="sm" onClick={() => addReply(c)} className="self-start">
                      Reply
                    </Button>
                  )}
                  {replies.map(reply => (
                    <div
                      key={reply.id}
                      className="border border-hairline rounded-lg p-2 flex flex-col gap-1.5 bg-selected ml-3"
                    >
                      <div className="text-[11px] text-muted">Your reply (pending)</div>
                      <Textarea
                        value={reply.body}
                        onChange={e => editComment(reply.id, { body: e.target.value })}
                        rows={2}
                        className="w-full text-[12px]"
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => removeComment(reply.id)}
                        className="self-start"
                      >
                        Remove reply
                      </Button>
                    </div>
                  ))}
                </CommentCard>
              )
            })}
          </div>
        </aside>
        </ResizablePanel>
        </>
        )}
      </ResizablePanelGroup>
    </main>
  )
}

function PRReviewPanel({
  pending,
  selectedPath,
  submitting,
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
  submitting: boolean
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
    <aside className="h-full w-full bg-sidebar p-3 flex flex-col gap-3 overflow-hidden">
      <h3 className="m-0 text-[14px] font-semibold">Pending PR review</h3>

      <Button onClick={onAddComment} className="self-start">
        + Comment on {selectedPath || '(no file selected)'}
      </Button>

      <div className="flex-1 overflow-auto flex flex-col gap-2">
        {fresh.length === 0 && (
          <div className="text-subtle text-[12.5px]">
            No new comments yet. Use Reply on existing threads or add new comments here.
          </div>
        )}
        {fresh.map(c => (
          <CommentCard key={c.id}>
            <div className="flex gap-2 items-center text-[12px]">
              <code className="flex-1 truncate">{c.path}:</code>
              <Input
                type="number"
                min={1}
                value={c.lineNumber}
                onChange={e => onEditComment(c.id, { lineNumber: Number(e.target.value) })}
                className="w-14"
              />
              <Select
                value={c.side}
                onChange={e => onEditComment(c.id, { side: e.target.value as 'old' | 'new' })}
              >
                <option value="new">new</option>
                <option value="old">old</option>
              </Select>
              <Tooltip content="Remove comment">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onRemoveComment(c.id)}
                  aria-label="Remove comment"
                >
                  ×
                </Button>
              </Tooltip>
            </div>
            <Textarea
              value={c.body}
              onChange={e => onEditComment(c.id, { body: e.target.value })}
              rows={3}
              className="w-full text-[12.5px]"
            />
          </CommentCard>
        ))}
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-muted">Summary</span>
        <Textarea
          value={pending.summary}
          onChange={e => onSummary(e.target.value)}
          rows={4}
          placeholder="Overall feedback…"
          className="w-full text-[12.5px]"
        />
      </label>

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

      <div className="flex gap-2">
        <Button
          variant="primary"
          onClick={onSubmit}
          disabled={submitting}
          className="flex-1"
        >
          {submitting ? 'Submitting…' : 'Submit review'}
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
        <Button onClick={load}>Refresh</Button>
        <GhAuthIndicator />
        <HelpButton />
      </TitleBar>
      <section className="flex-1 overflow-auto px-4 py-3">
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
  const onClick = () => {
    const [owner, repo] = pr.repo.split('/')
    window.api.openPRReview({ owner, repo, number: pr.number })
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

  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(new Set())

  const toggleCollapsed = useCallback((path: string) => {
    setCollapsedPaths(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  const codeViewItems = useMemo(
    () => buildCodeViewItems(files, undefined, collapsedPaths),
    [files, collapsedPaths]
  )
  const diffSectionRef = useRef<HTMLElement>(null)
  const codeViewItemsRef = useRef(codeViewItems)
  codeViewItemsRef.current = codeViewItems
  useEffect(() => {
    if (!selectedPath || !diffSectionRef.current) return
    setCollapsedPaths(prev => {
      if (!prev.has(selectedPath)) return prev
      const next = new Set(prev)
      next.delete(selectedPath)
      return next
    })
    requestAnimationFrame(() => {
      const idx = codeViewItemsRef.current.findIndex(i => i.id === selectedPath)
      if (idx < 0) return
      const containers = diffSectionRef.current?.querySelectorAll('diffs-container')
      const target = containers?.[idx] as HTMLElement | undefined
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }, [selectedPath])

  const renderHeaderPrefix = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (item: any) => (
      <ChevronToggle
        collapsed={collapsedPaths.has(item.id)}
        onToggle={() => toggleCollapsed(item.id)}
      />
    ),
    [collapsedPaths, toggleCollapsed]
  )

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
    const ok = await confirm({
      title: 'Refresh snapshot?',
      description:
        'Comments anchored to lines that have moved or been removed may become stale.',
      confirmLabel: 'Refresh'
    })
    if (!ok) return
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
    try {
      await window.api.reviewSubmitToAgent(pending)
      setPending(null)
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
    await window.api.reviewDelete(target)
    setPending(null)
  }

  useKeyboardShortcut(pending ? null : { key: 'r', handler: startReview })
  useKeyboardShortcut(pending ? { key: 'Enter', meta: true, allowInForm: true, handler: submitToAgent } : null)
  useKeyboardShortcut(pending ? { key: 'Escape', handler: discardReview } : null)

  return (
    <main className="h-screen flex flex-col bg-surface">
      <TitleBar>
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
        {!pending && (
          <Button variant="primary" onClick={startReview}>
            Start review
          </Button>
        )}
        <GhAuthIndicator />
        <HelpButton />
      </TitleBar>
      <ResizablePanelGroup orientation="horizontal" id="local-panes" className="flex-1 min-h-0">
        <ResizablePanel defaultSize="20%" minSize="10%" maxSize="40%" className="overflow-hidden">
          <aside className="w-full h-full overflow-auto bg-sidebar py-1.5">
            <FileTree model={model} />
          </aside>
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel defaultSize={pending ? '55%' : '80%'} minSize="30%" className="overflow-hidden">
          <section
            ref={diffSectionRef}
            className="diff-host w-full h-full overflow-auto"
          >
            {codeViewItems.length > 0 ? (
              <CodeView
                items={codeViewItems}
                renderHeaderPrefix={renderHeaderPrefix}
              />
            ) : (
              <div className="p-4 text-subtle">
                {selectedFile?.isBinary
                  ? 'Binary file — no diff preview'
                  : 'No diff to display'}
              </div>
            )}
          </section>
        </ResizablePanel>
        {pending && (
          <>
            <ResizableHandle />
            <ResizablePanel defaultSize="25%" minSize="15%" maxSize="45%" className="overflow-hidden">
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
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
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
    <aside className="h-full w-full bg-sidebar p-3 flex flex-col gap-3 overflow-hidden">
      <h3 className="m-0 text-[14px] font-semibold">Pending review</h3>

      <Button onClick={onAddComment} className="self-start">
        + Comment on {selectedPath || '(no file selected)'}
      </Button>

      <div className="flex-1 overflow-auto flex flex-col gap-2">
        {pending.lineComments.length === 0 && (
          <div className="text-subtle text-[12.5px]">No comments yet.</div>
        )}
        {pending.lineComments.map(c => (
          <CommentCard key={c.id}>
            <div className="flex gap-2 items-center text-[12px]">
              <code className="flex-1 truncate">{c.path}:</code>
              <Input
                type="number"
                min={1}
                value={c.lineNumber}
                onChange={e => onEditComment(c.id, { lineNumber: Number(e.target.value) })}
                className="w-14"
              />
              <Select
                value={c.side}
                onChange={e => onEditComment(c.id, { side: e.target.value as 'old' | 'new' })}
              >
                <option value="new">new</option>
                <option value="old">old</option>
              </Select>
              <Tooltip content="Remove comment">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onRemoveComment(c.id)}
                  aria-label="Remove comment"
                >
                  ×
                </Button>
              </Tooltip>
            </div>
            <Textarea
              value={c.body}
              onChange={e => onEditComment(c.id, { body: e.target.value })}
              placeholder="Comment body…"
              rows={3}
              className="w-full text-[12.5px]"
            />
          </CommentCard>
        ))}
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-muted">Summary</span>
        <Textarea
          value={pending.summary}
          onChange={e => onSummaryChange(e.target.value)}
          rows={4}
          placeholder="Overall feedback for the agent…"
          className="w-full text-[12.5px]"
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
