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

export interface PullResponseData {
  number: number
  title: string
  body: string | null
  state: 'open' | 'closed'
  draft?: boolean
  merged: boolean
  user: { login: string } | null
  base: { ref: string; sha: string }
  head: { ref: string; sha: string }
  html_url: string
  comments: number
  review_comments: number
  changed_files: number
  additions: number
  deletions: number
  created_at: string
  updated_at: string
}

export interface ReviewCommentData {
  id: number
  path: string
  line: number | null
  original_line: number | null
  side: 'LEFT' | 'RIGHT' | null
  body: string
  user: { login: string } | null
  created_at: string
  in_reply_to_id?: number
}

export interface IssueCommentData {
  id: number
  body: string
  user: { login: string } | null
  created_at: string
}

export interface PullGetParams {
  owner: string
  repo: string
  pull_number: number
  mediaType?: { format?: 'diff' | 'json' }
}

export interface ListReviewCommentsParams {
  owner: string
  repo: string
  pull_number: number
}

export interface ListIssueCommentsParams {
  owner: string
  repo: string
  issue_number: number
}

export interface OctokitLike {
  search: {
    issuesAndPullRequests(params: SearchParams): Promise<SearchResponse>
  }
  pulls: {
    get(params: PullGetParams): Promise<{ data: PullResponseData | string }>
    listReviewComments(params: ListReviewCommentsParams): Promise<{ data: ReviewCommentData[] }>
  }
  issues: {
    listComments(params: ListIssueCommentsParams): Promise<{ data: IssueCommentData[] }>
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

export interface PullRequestDetails {
  owner: string
  repo: string
  number: number
  title: string
  body: string
  author: string
  state: 'open' | 'draft' | 'merged' | 'closed'
  baseRef: string
  headRef: string
  url: string
  commentCount: number
  reviewCommentCount: number
  changedFiles: number
  additions: number
  deletions: number
  updatedAt: string
}

export interface InlineComment {
  id: number
  path: string
  lineNumber: number
  side: 'LEFT' | 'RIGHT'
  body: string
  author: string
  createdAt: string
  inReplyToId?: number
}

export interface ConversationComment {
  id: number
  body: string
  author: string
  createdAt: string
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

  async getPR(owner: string, repo: string, pull_number: number): Promise<PullRequestDetails> {
    const response = await this.octokit.pulls.get({ owner, repo, pull_number })
    const data = response.data as PullResponseData
    const state: PullRequestDetails['state'] = data.merged
      ? 'merged'
      : data.draft
        ? 'draft'
        : data.state === 'closed'
          ? 'closed'
          : 'open'
    return {
      owner,
      repo,
      number: data.number,
      title: data.title,
      body: data.body ?? '',
      author: data.user?.login ?? 'unknown',
      state,
      baseRef: data.base.ref,
      headRef: data.head.ref,
      url: data.html_url,
      commentCount: data.comments,
      reviewCommentCount: data.review_comments,
      changedFiles: data.changed_files,
      additions: data.additions,
      deletions: data.deletions,
      updatedAt: data.updated_at
    }
  }

  async getPRDiff(owner: string, repo: string, pull_number: number): Promise<string> {
    const response = await this.octokit.pulls.get({
      owner,
      repo,
      pull_number,
      mediaType: { format: 'diff' }
    })
    return response.data as string
  }

  async getPRInlineComments(owner: string, repo: string, pull_number: number): Promise<InlineComment[]> {
    const response = await this.octokit.pulls.listReviewComments({ owner, repo, pull_number })
    return response.data.map(c => ({
      id: c.id,
      path: c.path,
      lineNumber: c.line ?? c.original_line ?? 0,
      side: c.side ?? 'RIGHT',
      body: c.body,
      author: c.user?.login ?? 'unknown',
      createdAt: c.created_at,
      inReplyToId: c.in_reply_to_id
    }))
  }

  async getPRConversation(owner: string, repo: string, pull_number: number): Promise<ConversationComment[]> {
    const response = await this.octokit.issues.listComments({
      owner,
      repo,
      issue_number: pull_number
    })
    return response.data.map(c => ({
      id: c.id,
      body: c.body,
      author: c.user?.login ?? 'unknown',
      createdAt: c.created_at
    }))
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
