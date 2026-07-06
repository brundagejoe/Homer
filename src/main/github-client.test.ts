import { describe, test, expect } from 'bun:test'
import {
  GitHubClient,
  OctokitLike,
  PullResponseData,
  ReviewCommentData,
  IssueCommentData,
  CreateReviewParams,
  CreateReplyParams,
  CreateReviewResponse
} from './github-client'

interface MockOptions {
  pullData?: PullResponseData
  pullDiff?: string
  reviewComments?: ReviewCommentData[]
  issueComments?: IssueCommentData[]
  createReviewResponse?: CreateReviewResponse
  capturedReviews?: CreateReviewParams[]
  capturedReplies?: CreateReplyParams[]
}

function mockOctokit(opts: MockOptions = {}): { octokit: OctokitLike; calls: string[] } {
  const calls: string[] = []
  const octokit: OctokitLike = {
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
      },
      async createReplyForReviewComment(params) {
        calls.push(`pulls.createReplyForReviewComment ${params.owner}/${params.repo}#${params.pull_number} <-${params.comment_id}`)
        opts.capturedReplies?.push(params)
        return { data: { id: 555 } }
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
      headSha: 'def',
      baseSha: 'abc',
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
      comments: [{ path: 'a.ts', line: 5, side: 'RIGHT', body: 'nit' }],
      replies: []
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

  test('does not forward replies into the createReview comments array', async () => {
    const capturedReviews: CreateReviewParams[] = []
    const { octokit } = mockOctokit({ capturedReviews })
    const client = new GitHubClient(octokit)
    await client.submitReview('o', 'r', 7, {
      body: '',
      event: 'COMMENT',
      comments: [{ path: 'a.ts', line: 5, side: 'RIGHT', body: 'nit' }],
      replies: [{ inReplyTo: 999, body: 'thanks' }]
    })
    // The batched createReview must carry only new comments; replies would
    // 422 the whole request there.
    expect(capturedReviews[0].comments).toEqual([{ path: 'a.ts', line: 5, side: 'RIGHT', body: 'nit' }])
  })

  test('posts each reply against its parent comment after the review is created', async () => {
    const capturedReplies: CreateReplyParams[] = []
    const { octokit, calls } = mockOctokit({ capturedReplies })
    const client = new GitHubClient(octokit)
    await client.submitReview('o', 'r', 7, {
      body: '',
      event: 'COMMENT',
      comments: [],
      replies: [
        { inReplyTo: 111, body: 'first' },
        { inReplyTo: 222, body: 'second' }
      ]
    })
    expect(capturedReplies).toEqual([
      { owner: 'o', repo: 'r', pull_number: 7, comment_id: 111, body: 'first' },
      { owner: 'o', repo: 'r', pull_number: 7, comment_id: 222, body: 'second' }
    ])
    // The review is created before the replies are posted.
    const reviewIdx = calls.findIndex(c => c.startsWith('pulls.createReview'))
    const firstReplyIdx = calls.findIndex(c => c.startsWith('pulls.createReplyForReviewComment'))
    expect(reviewIdx).toBeGreaterThanOrEqual(0)
    expect(firstReplyIdx).toBeGreaterThan(reviewIdx)
  })

  test('submits with no reply calls when there are no replies', async () => {
    const capturedReplies: CreateReplyParams[] = []
    const { octokit, calls } = mockOctokit({ capturedReplies })
    const client = new GitHubClient(octokit)
    await client.submitReview('o', 'r', 7, {
      body: 'lgtm',
      event: 'APPROVE',
      comments: [],
      replies: []
    })
    expect(capturedReplies).toEqual([])
    expect(calls.some(c => c.startsWith('pulls.createReplyForReviewComment'))).toBe(false)
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
