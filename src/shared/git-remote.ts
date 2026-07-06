/**
 * The `owner/repo` slug identifying a GitHub repository — the identity a PR
 * belongs to and the key repo-discovery matches a local clone against.
 */
export interface OwnerRepo {
  owner: string
  repo: string
}

/**
 * Normalize a git `origin` remote URL to its GitHub `owner/repo`, or `null` when
 * it isn't a GitHub remote. Pure: the single place remote-URL shape is
 * understood, so repo-discovery (main) and any future caller share one parser.
 *
 * Handles the forms git ships:
 *   - SCP-style ssh:   `git@github.com:owner/repo(.git)`
 *   - https:           `https://github.com/owner/repo(.git)` (with optional
 *                      embedded credentials, e.g. a token)
 *   - ssh:// URL:      `ssh://git@github.com/owner/repo(.git)`
 * The host match is case-insensitive; `owner`/`repo` case is preserved as-is
 * (GitHub treats slugs case-insensitively, so callers compare case-folded).
 */
export function parseOwnerRepo(remoteUrl: string): OwnerRepo | null {
  const trimmed = remoteUrl.trim()
  if (!trimmed) return null

  const path = extractHostPath(trimmed)
  if (!path) return null

  // path is the `owner/repo(/...)` after the host; take the first two segments.
  const segments = path.split('/').filter(Boolean)
  if (segments.length < 2) return null

  const owner = segments[0]
  const repo = stripDotGit(segments[1])
  if (!owner || !repo) return null
  return { owner, repo }
}

/**
 * Return the `owner/repo…` path following a `github.com` host, or `null` if the
 * remote's host isn't GitHub. Covers SCP-style (`host:path`) and URL-style
 * (`scheme://[creds@]host/path`) remotes.
 */
function extractHostPath(remote: string): string | null {
  // URL-style: https://…, ssh://…, git://…
  const urlMatch = remote.match(/^[a-z][a-z0-9+.-]*:\/\/(.+)$/i)
  if (urlMatch) {
    let rest = urlMatch[1]
    const at = rest.lastIndexOf('@')
    if (at !== -1) rest = rest.slice(at + 1) // drop embedded credentials
    const slash = rest.indexOf('/')
    if (slash === -1) return null
    const host = rest.slice(0, slash)
    if (!isGitHubHost(host)) return null
    return rest.slice(slash + 1)
  }

  // SCP-style: [user@]host:owner/repo
  const scpMatch = remote.match(/^([^/@]+@)?([^/:]+):(.+)$/)
  if (scpMatch) {
    const host = scpMatch[2]
    if (!isGitHubHost(host)) return null
    return scpMatch[3]
  }

  return null
}

/**
 * Whether a remote host is GitHub. Matches `github.com` exactly, and the common
 * SSH host-alias convention used to juggle multiple accounts —
 * `github.com-<alias>` / `github.com.<alias>` (e.g. `github.com-work`,
 * `github.com.personal`). The alias must be a single trailing label (no further
 * dots), so a genuinely foreign host — `github.computer.com`,
 * `github.com.evil.example` — is NOT matched.
 */
function isGitHubHost(host: string): boolean {
  const h = host.toLowerCase()
  if (h === 'github.com') return true
  for (const sep of ['github.com-', 'github.com.']) {
    if (h.startsWith(sep)) {
      const alias = h.slice(sep.length)
      return alias.length > 0 && !alias.includes('.')
    }
  }
  return false
}

function stripDotGit(segment: string): string {
  return segment.endsWith('.git') ? segment.slice(0, -'.git'.length) : segment
}
