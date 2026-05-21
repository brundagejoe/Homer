import { describe, test, expect } from 'bun:test'
import {
  GitHubClient,
  OctokitLike,
  SearchResponseItem,
  PullResponseData,
  ReviewCommentData,
  IssueCommentData,
  CreateReviewParams,
  CreateReviewResponse
} from './github-client'

interface MockOptions {
  search?: Record<string, SearchResponseItem[]>
  pullData?: PullResponseData
  pullDiff?: string
  reviewComments?: ReviewCommentData[]
  issueComments?: IssueCommentData[]
  createReviewResponse?: CreateReviewResponse
  capturedReviews?: CreateReviewParams[]
}

function mockOctokit(opts: MockOptions = {}): { octokit: OctokitLike; calls: string[] } {
  const calls: string[] = []
  const octokit: OctokitLike = {
    search: {
      async issuesAndPullRequests({ q }: { q: string }) {
        calls.push(`search ${q}`)
        const items = opts.search?.[q] ?? []
        return { data: { total_count: items.length, items, incomplete_results: false } }
      }
    },
    pulls: {
      async get(params) {
        calls.push(`pulls.get ${params.owner}/${params.repo}#${params.pull_number} ${params.mediaType?.format ?? 'json'}`)
        if (params.mediaType?.format === 'diff') {
          return { data: opts.pullDiff ?? '' } as { data: string }
        }
        return { data: opts.pullData! } as { data: PullResponseData }
      },
      async listReviewComments(params) {
        calls.push(`pulls.listReviewComments ${params.owner}/${params.repo}#${params.pull_number}`)
        return { data: opts.reviewComments ?? [] }
      },
      async createReview(params) {
        calls.push(`pulls.createReview ${params.owner}/${params.repo}#${params.pull_number} ${params.event}`)
        opts.capturedReviews?.push(params)
        return {
          data: opts.createReviewResponse ?? {
            id: 1,
            state: 'submitted',
            html_url: 'https://github.com/o/r/pull/7#pullrequestreview-1'
          }
        }
      }
    },
    issues: {
      async listComments(params) {
        calls.push(`issues.listComments ${params.owner}/${params.repo}#${params.issue_number}`)
        return { data: opts.issueComments ?? [] }
      }
    }
  }
  return { octokit, calls }
}

const samplePr = (overrides: Partial<SearchResponseItem> = {}): SearchResponseItem => ({
  id: 1,
  number: 42,
  title: 'My PR',
  html_url: 'https://github.com/o/r/pull/42',
  updated_at: '2026-05-01T12:00:00Z',
  comments: 3,
  draft: false,
  pull_request: { merged_at: null },
  user: { login: 'joe' },
  repository_url: 'https://api.github.com/repos/o/r',
  state: 'open',
  ...overrides
})

describe('GitHubClient.listInvolvingPRs', () => {
  test("uses author:@me for the 'mine' query", async () => {
    const { octokit, calls } = mockOctokit({})
    const client = new GitHubClient(octokit)
    await client.listInvolvingPRs()
    expect(calls.some(q => q.includes('author:@me') && q.includes('is:open') && q.includes('is:pr'))).toBe(true)
  })

  test('uses review-requested:@me for the review-requested query', async () => {
    const { octokit, calls } = mockOctokit({})
    const client = new GitHubClient(octokit)
    await client.listInvolvingPRs()
    expect(calls.some(q => q.includes('review-requested:@me') && q.includes('is:open'))).toBe(true)
  })

  test('recently-merged query uses is:merged and a date 7 days ago', async () => {
    const { octokit, calls } = mockOctokit({})
    const client = new GitHubClient(octokit)
    await client.listInvolvingPRs(new Date('2026-05-21T12:00:00Z'))
    const mergedQuery = calls.find(q => q.startsWith('search ') && q.includes('is:merged'))
    expect(mergedQuery).toBeDefined()
    expect(mergedQuery!).toContain('merged:>=2026-05-14')
    expect(mergedQuery!).toContain('author:@me')
  })

  test('normalizes a search item into a PullRequestSummary', async () => {
    const { octokit } = mockOctokit({
      search: {
        'is:open is:pr author:@me archived:false': [
          samplePr({ id: 99, number: 7, title: 'Refactor', repository_url: 'https://api.github.com/repos/acme/widgets', user: { login: 'joe' } })
        ]
      }
    })
    const client = new GitHubClient(octokit)
    const result = await client.listInvolvingPRs()
    expect(result.mine).toEqual([
      {
        id: 99,
        number: 7,
        title: 'Refactor',
        repo: 'acme/widgets',
        author: 'joe',
        state: 'open',
        url: 'https://github.com/o/r/pull/42',
        updatedAt: '2026-05-01T12:00:00Z',
        commentCount: 3
      }
    ])
  })

  test('marks a draft PR with state=draft', async () => {
    const { octokit } = mockOctokit({
      search: { 'is:open is:pr author:@me archived:false': [samplePr({ draft: true })] }
    })
    const client = new GitHubClient(octokit)
    const result = await client.listInvolvingPRs()
    expect(result.mine[0].state).toBe('draft')
  })

  test('marks a merged PR with state=merged', async () => {
    const { octokit } = mockOctokit({
      search: {
        'is:pr is:merged author:@me archived:false merged:>=2026-05-14': [
          samplePr({ pull_request: { merged_at: '2026-05-15T00:00:00Z' } })
        ]
      }
    })
    const client = new GitHubClient(octokit)
    const result = await client.listInvolvingPRs(new Date('2026-05-21T12:00:00Z'))
    expect(result.recentlyMerged[0].state).toBe('merged')
  })
})

const samplePullData = (overrides: Partial<PullResponseData> = {}): PullResponseData => ({
  number: 7,
  title: 'Add thing',
  body: 'Implements the thing',
  state: 'open',
  merged: false,
  user: { login: 'joe' },
  base: { ref: 'main', sha: 'abc' },
  head: { ref: 'feat/thing', sha: 'def' },
  html_url: 'https://github.com/o/r/pull/7',
  comments: 2,
  review_comments: 4,
  changed_files: 5,
  additions: 100,
  deletions: 20,
  created_at: '2026-05-01T00:00:00Z',
  updated_at: '2026-05-02T00:00:00Z',
  ...overrides
})

describe('GitHubClient.getPR', () => {
  test('returns normalized PR details', async () => {
    const { octokit } = mockOctokit({ pullData: samplePullData() })
    const client = new GitHubClient(octokit)
    const pr = await client.getPR('o', 'r', 7)
    expect(pr).toEqual({
      owner: 'o',
      repo: 'r',
      number: 7,
      title: 'Add thing',
      body: 'Implements the thing',
      author: 'joe',
      state: 'open',
      baseRef: 'main',
      headRef: 'feat/thing',
      url: 'https://github.com/o/r/pull/7',
      commentCount: 2,
      reviewCommentCount: 4,
      changedFiles: 5,
      additions: 100,
      deletions: 20,
      updatedAt: '2026-05-02T00:00:00Z'
    })
  })

  test('reports merged when the PR is merged', async () => {
    const { octokit } = mockOctokit({ pullData: samplePullData({ merged: true, state: 'closed' }) })
    const client = new GitHubClient(octokit)
    expect((await client.getPR('o', 'r', 7)).state).toBe('merged')
  })

  test('reports draft when draft=true', async () => {
    const { octokit } = mockOctokit({ pullData: samplePullData({ draft: true }) })
    const client = new GitHubClient(octokit)
    expect((await client.getPR('o', 'r', 7)).state).toBe('draft')
  })
})

describe('GitHubClient.getPRDiff', () => {
  test('returns the raw diff text', async () => {
    const diff = 'diff --git a/foo b/foo\n+hello\n'
    const { octokit, calls } = mockOctokit({ pullDiff: diff })
    const client = new GitHubClient(octokit)
    const result = await client.getPRDiff('o', 'r', 7)
    expect(result).toBe(diff)
    expect(calls).toContain('pulls.get o/r#7 diff')
  })
})

describe('GitHubClient.getPRInlineComments', () => {
  test('normalizes inline review comments', async () => {
    const { octokit } = mockOctokit({
      reviewComments: [
        {
          id: 1,
          path: 'src/foo.ts',
          line: 42,
          original_line: 40,
          side: 'RIGHT',
          body: 'rename',
          user: { login: 'alice' },
          created_at: '2026-05-01T00:00:00Z'
        }
      ]
    })
    const client = new GitHubClient(octokit)
    const comments = await client.getPRInlineComments('o', 'r', 7)
    expect(comments).toEqual([
      {
        id: 1,
        path: 'src/foo.ts',
        lineNumber: 42,
        side: 'RIGHT',
        body: 'rename',
        author: 'alice',
        createdAt: '2026-05-01T00:00:00Z',
        inReplyToId: undefined
      }
    ])
  })

  test('falls back to original_line when line is null', async () => {
    const { octokit } = mockOctokit({
      reviewComments: [
        {
          id: 2,
          path: 'a.ts',
          line: null,
          original_line: 12,
          side: 'LEFT',
          body: 'outdated',
          user: { login: 'bob' },
          created_at: '2026-05-01T00:00:00Z'
        }
      ]
    })
    const client = new GitHubClient(octokit)
    const comments = await client.getPRInlineComments('o', 'r', 7)
    expect(comments[0].lineNumber).toBe(12)
  })
})

describe('GitHubClient.submitReview', () => {
  test('sends event, body, and comments through Octokit and returns the created review', async () => {
    const capturedReviews: CreateReviewParams[] = []
    const { octokit, calls } = mockOctokit({ capturedReviews })
    const client = new GitHubClient(octokit)
    const response = await client.submitReview('o', 'r', 7, {
      body: 'ship it',
      event: 'APPROVE',
      comments: [{ path: 'a.ts', line: 5, side: 'RIGHT', body: 'nit' }]
    })
    expect(calls).toContain('pulls.createReview o/r#7 APPROVE')
    expect(capturedReviews[0]).toMatchObject({
      owner: 'o',
      repo: 'r',
      pull_number: 7,
      body: 'ship it',
      event: 'APPROVE',
      comments: [{ path: 'a.ts', line: 5, side: 'RIGHT', body: 'nit' }]
    })
    expect(response.state).toBe('submitted')
  })
})

describe('GitHubClient.getPRConversation', () => {
  test('normalizes issue-level comments', async () => {
    const { octokit, calls } = mockOctokit({
      issueComments: [
        { id: 1, body: 'lgtm', user: { login: 'carol' }, created_at: '2026-05-01T00:00:00Z' }
      ]
    })
    const client = new GitHubClient(octokit)
    const conv = await client.getPRConversation('o', 'r', 7)
    expect(conv).toEqual([
      { id: 1, body: 'lgtm', author: 'carol', createdAt: '2026-05-01T00:00:00Z' }
    ])
    expect(calls).toContain('issues.listComments o/r#7')
  })
})
