import { describe, test, expect } from 'bun:test'
import { GitHubClient, OctokitLike, SearchResponseItem } from './github-client'

function mockOctokit(canned: Record<string, SearchResponseItem[]>): {
  octokit: OctokitLike
  queries: string[]
} {
  const queries: string[] = []
  const octokit: OctokitLike = {
    search: {
      async issuesAndPullRequests({ q, per_page }: { q: string; per_page?: number }) {
        queries.push(q)
        const items = canned[q] ?? []
        return { data: { total_count: items.length, items, incomplete_results: false } }
      }
    }
  }
  return { octokit, queries }
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
    const { octokit, queries } = mockOctokit({})
    const client = new GitHubClient(octokit)
    await client.listInvolvingPRs()
    expect(queries.some(q => q.includes('author:@me') && q.includes('is:open') && q.includes('is:pr'))).toBe(true)
  })

  test('uses review-requested:@me for the review-requested query', async () => {
    const { octokit, queries } = mockOctokit({})
    const client = new GitHubClient(octokit)
    await client.listInvolvingPRs()
    expect(queries.some(q => q.includes('review-requested:@me') && q.includes('is:open'))).toBe(true)
  })

  test('recently-merged query uses is:merged and a date 7 days ago', async () => {
    const { octokit, queries } = mockOctokit({})
    const client = new GitHubClient(octokit)
    await client.listInvolvingPRs(new Date('2026-05-21T12:00:00Z'))
    const mergedQuery = queries.find(q => q.includes('is:merged'))
    expect(mergedQuery).toBeDefined()
    expect(mergedQuery!).toContain('merged:>=2026-05-14')
    expect(mergedQuery!).toContain('author:@me')
  })

  test('normalizes a search item into a PullRequestSummary', async () => {
    const { octokit } = mockOctokit({
      'is:open is:pr author:@me archived:false': [
        samplePr({ id: 99, number: 7, title: 'Refactor', repository_url: 'https://api.github.com/repos/acme/widgets', user: { login: 'joe' } })
      ]
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
      'is:open is:pr author:@me archived:false': [samplePr({ draft: true })]
    })
    const client = new GitHubClient(octokit)
    const result = await client.listInvolvingPRs()
    expect(result.mine[0].state).toBe('draft')
  })

  test('marks a merged PR with state=merged', async () => {
    const { octokit } = mockOctokit({
      'is:pr is:merged author:@me archived:false merged:>=2026-05-14': [
        samplePr({ pull_request: { merged_at: '2026-05-15T00:00:00Z' } })
      ]
    })
    const client = new GitHubClient(octokit)
    const result = await client.listInvolvingPRs(new Date('2026-05-21T12:00:00Z'))
    expect(result.recentlyMerged[0].state).toBe('merged')
  })
})
