import { useEffect, useMemo, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { useKeyboardShortcut } from './useKeyboardShortcut'
import { HelpOverlay, ShortcutHelp } from './HelpOverlay'
import { DiffView } from './DiffView'
import { GuideView, useGuide } from './GuideView'
import { Markdown } from './Markdown'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tooltip } from '@/components/ui/tooltip'
import { TitleBar } from '@/components/TitleBar'
import { cn } from '@/lib/utils'
import type {
  AuthStatus,
  ConversationComment,
  InlineComment,
  NavRoute,
  PrTarget,
  PullRequestDetails
} from '../../preload'

const HELP_EVENT = 'dv:show-help'

/** The three tab Views the single Window navigates between (ADR 0003). */
type Tab = 'activity' | 'guide' | 'diff'

const TABS: { id: Tab; label: string; shortcut: string }[] = [
  { id: 'activity', label: 'Activity', shortcut: '1' },
  { id: 'guide', label: 'Guide', shortcut: '2' },
  { id: 'diff', label: 'Diff', shortcut: '3' }
]

const SHORTCUT_HELP: ShortcutHelp[] = [
  { keys: '?', description: 'Show / hide this help' },
  { keys: '1', description: 'Activity tab' },
  { keys: '2', description: 'Guide tab' },
  { keys: '3', description: 'Diff tab' },
  { keys: '] / [', description: 'Diff: next / previous file' },
  { keys: 'j / k', description: 'Diff: next / previous hunk' }
]

export default function App() {
  const [helpOpen, setHelpOpen] = useState(false)
  // `window.api` is undefined only in a broken preload; guard before use.
  const hasApi = !!window.api
  const [target, setTarget] = useState<PrTarget | null>(() =>
    hasApi ? window.api.prTarget : null
  )

  useKeyboardShortcut({ key: '?', handler: () => setHelpOpen(o => !o) })

  useEffect(() => {
    const onShow = () => setHelpOpen(true)
    window.addEventListener(HELP_EVENT, onShow)
    return () => window.removeEventListener(HELP_EVENT, onShow)
  }, [])

  // A second `dv <pr-url>` focuses this window and points it at that PR.
  useEffect(() => {
    if (!window.api?.onNavigate) return
    return window.api.onNavigate((r: NavRoute) => setTarget(r.target))
  }, [])

  if (!hasApi) {
    return (
      <main className="h-screen flex flex-col bg-surface">
        <TitleBar>window.api is undefined</TitleBar>
      </main>
    )
  }

  return (
    <>
      {target ? (
        <Window key={`${target.owner}/${target.repo}/${target.number}`} target={target} />
      ) : (
        <NoPrView />
      )}
      {helpOpen && <HelpOverlay shortcuts={SHORTCUT_HELP} onClose={() => setHelpOpen(false)} />}
    </>
  )
}

/**
 * Shown when the app is launched without a PR URL. The only V1 entry
 * point is `dv <github-pr-url>`, so there is nothing to render — we
 * explain how to launch rather than fall back to a discovery surface.
 */
function NoPrView() {
  return (
    <main className="h-screen flex flex-col bg-surface">
      <TitleBar>
        <span className="flex-1 truncate font-semibold text-fg">Guided PR Review</span>
        <GhAuthIndicator />
        <HelpButton />
      </TitleBar>
      <section className="flex-1 grid place-items-center px-6">
        <div className="max-w-md text-center flex flex-col gap-2">
          <h2 className="m-0 text-[15px] font-semibold">No pull request</h2>
          <p className="m-0 text-[13px] text-muted">
            Launch a review from your terminal inside a repo:
          </p>
          <code className="font-mono text-[12.5px] bg-sidebar border border-hairline rounded-md px-2.5 py-1.5">
            dv https://github.com/owner/repo/pull/123
          </code>
        </div>
      </section>
    </main>
  )
}

type Status =
  | { type: 'loading' }
  | {
      type: 'loaded'
      pr: PullRequestDetails
      inline: InlineComment[]
      conversation: ConversationComment[]
    }
  | { type: 'error'; message: string }

/**
 * The single Window for one PR: a title bar with the three-tab switcher
 * (Activity · Guide · Diff), landing on Activity with free navigation.
 * Activity renders the real PR; Guide and Diff are placeholders in this
 * slice (they never depend on Activity's data — the Agent is additive).
 */
function Window({ target }: { target: PrTarget }) {
  const [tab, setTab] = useState<Tab>('activity')
  const [status, setStatus] = useState<Status>({ type: 'loading' })

  // Fire Guide generation at launch, in the background, so it streams in while
  // the reviewer reads Activity — independent of the PR-details fetch and of
  // which tab is open (the Agent is additive).
  const guide = useGuide(target)

  useEffect(() => {
    let cancelled = false
    setStatus({ type: 'loading' })
    Promise.all([
      window.api.githubGetPR(target),
      window.api.githubGetPRInlineComments(target),
      window.api.githubGetPRConversation(target)
    ])
      .then(([pr, inline, conversation]) => {
        if (!cancelled) setStatus({ type: 'loaded', pr, inline, conversation })
      })
      .catch((err: Error) => {
        if (!cancelled) setStatus({ type: 'error', message: err.message ?? String(err) })
      })
    return () => {
      cancelled = true
    }
  }, [target.owner, target.repo, target.number])

  useKeyboardShortcut({ key: '1', handler: () => setTab('activity') })
  useKeyboardShortcut({ key: '2', handler: () => setTab('guide') })
  useKeyboardShortcut({ key: '3', handler: () => setTab('diff') })

  const loaded = status.type === 'loaded' ? status : null

  return (
    <main className="h-screen flex flex-col bg-surface">
      <TitleBar>
        <span className="flex-1 truncate min-w-0">
          <span className="font-semibold text-fg">
            {target.owner}/{target.repo}#{target.number}
          </span>
          {loaded && <span className="ml-2 text-fg">{loaded.pr.title}</span>}
          {status.type === 'loading' && <span className="ml-2 text-subtle">— loading…</span>}
          {status.type === 'error' && (
            <span className="ml-2 text-danger">— {status.message}</span>
          )}
        </span>
        <TabBar tab={tab} onTab={setTab} />
        {loaded && <StateBadge state={loaded.pr.state} />}
        <OpenOnGithubButton url={loaded?.pr.url || prHtmlUrl(target)} />
        <GhAuthIndicator />
        <HelpButton />
      </TitleBar>
      {tab === 'activity' && <ActivityView status={status} />}
      {tab === 'guide' && <GuideView guide={guide} onRetry={guide.retry} />}
      {tab === 'diff' && <DiffView target={target} />}
    </main>
  )
}

/** Segmented three-tab switcher. Free navigation — any tab, any time. */
function TabBar({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
  return (
    <div role="tablist" className="flex items-center gap-0.5 p-0.5 rounded-[8px] bg-hover">
      {TABS.map(t => (
        <Tooltip key={t.id} content={t.label} shortcut={t.shortcut}>
          <button
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => onTab(t.id)}
            className={cn(
              'px-2.5 py-0.5 rounded-[6px] text-[12px] [-webkit-app-region:no-drag]',
              tab === t.id ? 'bg-elevated text-fg shadow-sm' : 'text-muted hover:text-fg'
            )}
          >
            {t.label}
          </button>
        </Tooltip>
      ))}
    </div>
  )
}

function ActivityView({ status }: { status: Status }) {
  if (status.type === 'loading') {
    return <CenteredNote>Loading pull request…</CenteredNote>
  }
  if (status.type === 'error') {
    return <CenteredNote tone="danger">Failed to load: {status.message}</CenteredNote>
  }
  return <ActivityLoaded pr={status.pr} inline={status.inline} conversation={status.conversation} />
}

/**
 * The GitHub-landing-page-style view of the PR: title, body, author,
 * base ← head, and the existing conversation and inline review threads.
 */
function ActivityLoaded({
  pr,
  inline,
  conversation
}: {
  pr: PullRequestDetails
  inline: InlineComment[]
  conversation: ConversationComment[]
}) {
  const hasBody = pr.body.trim() !== ''
  const inlineByFile = useMemo(() => {
    const map = new Map<string, InlineComment[]>()
    for (const c of inline) {
      const list = map.get(c.path) ?? []
      list.push(c)
      map.set(c.path, list)
    }
    return map
  }, [inline])

  return (
    <section className="flex-1 min-h-0 overflow-auto bg-surface">
      <div className="max-w-3xl mx-auto px-6 py-6 flex flex-col gap-6">
        <header className="flex flex-col gap-2 pb-4 border-b border-hairline">
          <h1 className="m-0 text-[20px] font-semibold leading-snug">{pr.title}</h1>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-subtle">
            <StateBadge state={pr.state} />
            <span className="font-medium text-fg">{pr.author}</span>
            <span>wants to merge</span>
            <span className="font-mono text-[11.5px] bg-sidebar border border-hairline rounded px-1.5 py-0.5">
              {pr.headRef}
            </span>
            <span>→</span>
            <span className="font-mono text-[11.5px] bg-sidebar border border-hairline rounded px-1.5 py-0.5">
              {pr.baseRef}
            </span>
            <span>·</span>
            <span>
              {pr.changedFiles} file{pr.changedFiles === 1 ? '' : 's'}
            </span>
            <span className="text-success">+{pr.additions}</span>
            <span className="text-danger">−{pr.deletions}</span>
          </div>
        </header>

        <div className="flex flex-col gap-2">
          <h3 className="m-0 text-[14px] font-semibold">Description</h3>
          {hasBody ? (
            <Markdown>{pr.body}</Markdown>
          ) : (
            <p className="m-0 text-[12.5px] text-subtle italic">No description provided.</p>
          )}
        </div>

        {conversation.length > 0 && (
          <div className="flex flex-col gap-2">
            <h3 className="m-0 text-[14px] font-semibold">
              Conversation <span className="text-subtle font-normal">· {conversation.length}</span>
            </h3>
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
            <h3 className="m-0 text-[14px] font-semibold">Review threads</h3>
            {[...inlineByFile.entries()].map(([path, comments]) => (
              <div key={path} className="flex flex-col gap-1.5">
                <span className="text-[11px] uppercase tracking-wide text-muted">{path}</span>
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

function CenteredNote({
  children,
  tone
}: {
  children: React.ReactNode
  tone?: 'danger'
}) {
  return (
    <section className="flex-1 grid place-items-center px-6">
      <p className={cn('m-0 text-[13px] text-center', tone === 'danger' ? 'text-danger' : 'text-subtle')}>
        {children}
      </p>
    </section>
  )
}

/** "12-18" if multi-line, "12" otherwise. */
function formatLineRange(start: number | undefined, end: number): string {
  return start != null && start !== end ? `${start}-${end}` : `${end}`
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

function StateBadge({ state }: { state: PullRequestDetails['state'] }) {
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
          <Badge tone="success" className={cls}>
            gh @{auth.user}
          </Badge>
        </Tooltip>
      )
    case 'not-authenticated':
      return (
        <Tooltip content="Run `gh auth login` in a terminal">
          <Badge tone="warning" className={cls}>
            gh: not signed in
          </Badge>
        </Tooltip>
      )
    case 'gh-not-installed':
      return (
        <Tooltip content="Install gh: https://cli.github.com">
          <Badge tone="danger" className={cls}>
            gh: not installed
          </Badge>
        </Tooltip>
      )
    case 'error':
      return (
        <Tooltip content={auth.message}>
          <Badge tone="danger" className={cls}>
            gh: error
          </Badge>
        </Tooltip>
      )
  }
}

function CommentCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="border border-hairline rounded-lg p-2 flex flex-col gap-1.5 bg-elevated">
      {children}
    </div>
  )
}
