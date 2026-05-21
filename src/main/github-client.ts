export interface SearchParams {
  q: string
  per_page?: number
  sort?: string
  order?: 'asc' | 'desc'
}

export interface SearchResponseItem {
  id: number
  number: number
  title: string
  html_url: string
  updated_at: string
  comments: number
  draft?: boolean
  state: string
  user?: { login: string } | null
  repository_url: string
  pull_request?: { merged_at: string | null } | null
}

export interface SearchResponse {
  data: {
    total_count: number
    incomplete_results: boolean
    items: SearchResponseItem[]
  }
}

export interface OctokitLike {
  search: {
    issuesAndPullRequests(params: SearchParams): Promise<SearchResponse>
  }
}

export interface PullRequestSummary {
  id: number
  number: number
  title: string
  repo: string
  author: string
  state: 'open' | 'draft' | 'merged' | 'closed'
  url: string
  updatedAt: string
  commentCount: number
}

export interface InboxResult {
  mine: PullRequestSummary[]
  reviewRequested: PullRequestSummary[]
  recentlyMerged: PullRequestSummary[]
}

const QUERIES = {
  mine: 'is:open is:pr author:@me archived:false',
  reviewRequested: 'is:open is:pr review-requested:@me archived:false',
  recentlyMerged: (since: string) => `is:pr is:merged author:@me archived:false merged:>=${since}`
}

export class GitHubClient {
  constructor(private readonly octokit: OctokitLike) {}

  async listInvolvingPRs(now: Date = new Date()): Promise<InboxResult> {
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10)
    const [mine, reviewRequested, recentlyMerged] = await Promise.all([
      this.search(QUERIES.mine),
      this.search(QUERIES.reviewRequested),
      this.search(QUERIES.recentlyMerged(sevenDaysAgo))
    ])
    return { mine, reviewRequested, recentlyMerged }
  }

  private async search(q: string): Promise<PullRequestSummary[]> {
    const response = await this.octokit.search.issuesAndPullRequests({
      q,
      per_page: 50,
      sort: 'updated',
      order: 'desc'
    })
    return response.data.items.map(normalizeItem)
  }
}

function normalizeItem(item: SearchResponseItem): PullRequestSummary {
  const repoFromUrl = item.repository_url.replace('https://api.github.com/repos/', '')
  const merged = item.pull_request?.merged_at != null
  const state: PullRequestSummary['state'] = merged
    ? 'merged'
    : item.draft
      ? 'draft'
      : item.state === 'closed'
        ? 'closed'
        : 'open'
  return {
    id: item.id,
    number: item.number,
    title: item.title,
    repo: repoFromUrl,
    author: item.user?.login ?? 'unknown',
    state,
    url: item.html_url,
    updatedAt: item.updated_at,
    commentCount: item.comments
  }
}
