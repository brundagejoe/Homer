import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

/** Open links externally rather than navigating the renderer. */
const linkComponent: Components['a'] = ({ href, children, ...props }) => (
  <a
    {...props}
    href={href}
    onClick={(e) => {
      e.preventDefault()
      if (href) window.open(href, '_blank')
    }}
  >
    {children}
  </a>
)

export function Markdown({ children, compact }: { children: string; compact?: boolean }) {
  return (
    <div className={compact ? 'md md--compact' : 'md'}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: linkComponent }}>
        {children}
      </ReactMarkdown>
    </div>
  )
}

/**
 * Inline-only Markdown: renders code spans, emphasis, and links without any
 * block wrapper, so it can sit inside a heading or other inline context (e.g. a
 * Section title, where the Agent writes `symbol` in backticks). The paragraph
 * node is unwrapped to a fragment so no `<p>` breaks the surrounding element.
 */
export function InlineMarkdown({ children }: { children: string }) {
  return (
    <span className="md-inline">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{ a: linkComponent, p: ({ children }) => <>{children}</> }}
      >
        {children}
      </ReactMarkdown>
    </span>
  )
}
