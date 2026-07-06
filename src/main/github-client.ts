import type { GitHubReviewComment, GitHubReviewPayload } from './review-formatter'

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
  /** Set by GitHub when the comment spans multiple lines. */
  start_line?: number | null
  start_side?: 'LEFT' | 'RIGHT' | null
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

export interface CreateReviewParams {
  owner: string
  repo: string
  pull_number: number
  body?: string
  event?: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'
  comments?: GitHubReviewComment[]
}

export interface CreateReviewResponse {
  id: number
  state: string
  html_url: string
}

export interface CreateReplyParams {
  owner: string
  repo: string
  pull_number: number
  /** The parent review-comment id being replied to. */
  comment_id: number
  body: string
}

export interface CompareCommitsParams {
  owner: string
  repo: string
  /** GitHub's `base...head` basehead syntax. */
  basehead: string
}

export interface CompareCommitsData {
  ahead_by: number
  behind_by: number
  total_commits: number
}

export interface OctokitLike {
  pulls: {
    get(params: PullGetParams): Promise<{ data: PullResponseData | string }>
    listReviewComments(params: ListReviewCommentsParams): Promise<{ data: ReviewCommentData[] }>
    createReview(params: CreateReviewParams): Promise<{ data: CreateReviewResponse }>
    createReplyForReviewComment(params: CreateReplyParams): Promise<{ data: { id: number } }>
  }
  issues: {
    listComments(params: ListIssueCommentsParams): Promise<{ data: IssueCommentData[] }>
  }
  repos: {
    compareCommitsWithBasehead(params: CompareCommitsParams): Promise<{ data: CompareCommitsData }>
  }
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
  /** The head commit SHA — the exact revision the PR Worktree is materialized at. */
  headSha: string
  /** The base commit SHA the PR merges into. */
  baseSha: string
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
  /** Last line of the comment's anchor range (or the single line). */
  lineNumber: number
  /** Side for the last line. */
  side: 'LEFT' | 'RIGHT'
  /** First line of a multi-line range. Omit for single-line comments. */
  startLine?: number
  /** Side for the first line of a multi-line range. */
  startSide?: 'LEFT' | 'RIGHT'
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

export class GitHubClient {
  constructor(private readonly octokit: OctokitLike) {}

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
      headSha: data.head.sha,
      baseSha: data.base.sha,
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
      ...(c.start_line != null ? { startLine: c.start_line } : {}),
      ...(c.start_side != null ? { startSide: c.start_side } : {}),
      body: c.body,
      author: c.user?.login ?? 'unknown',
      createdAt: c.created_at,
      inReplyToId: c.in_reply_to_id
    }))
  }

  async submitReview(
    owner: string,
    repo: string,
    pull_number: number,
    payload: GitHubReviewPayload
  ): Promise<CreateReviewResponse> {
    const { replies, ...review } = payload
    const response = await this.octokit.pulls.createReview({
      owner,
      repo,
      pull_number,
      ...review
    })
    // Replies can't ride in createReview's comments array (that endpoint
    // has no in_reply_to and 422s if one is sent). Post each against its
    // parent review comment after the batched review lands, so one user
    // "submit" stays one logical action.
    for (const reply of replies) {
      await this.octokit.pulls.createReplyForReviewComment({
        owner,
        repo,
        pull_number,
        comment_id: reply.inReplyTo,
        body: reply.body
      })
    }
    return response.data
  }

  /**
   * How many commits `head` is ahead of `base`. Used to report the new-commit
   * count in the staleness banner when the PR gains commits mid-session — base
   * is the head SHA the session was built at, head is the PR's current head SHA.
   */
  async commitsAhead(owner: string, repo: string, base: string, head: string): Promise<number> {
    if (base === head) return 0
    const response = await this.octokit.repos.compareCommitsWithBasehead({
      owner,
      repo,
      basehead: `${base}...${head}`
    })
    return response.data.ahead_by
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
}
