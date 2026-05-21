import { describe, test, expect } from 'bun:test'
import { toAgentPrompt, toGitHubReview } from './review-formatter'
import type { PendingReview, ReviewTarget } from './pending-review-store'

const localTarget: ReviewTarget = {
  kind: 'local',
  repoPath: '/tmp/repo',
  source: { type: 'working-tree-vs-head' }
}

const prTarget: ReviewTarget = { kind: 'pr', owner: 'o', repo: 'r', number: 7 }

function review(target: ReviewTarget, overrides: Partial<PendingReview> = {}): PendingReview {
  return {
    target,
    snapshot: { files: [] },
    lineComments: [],
    summary: '',
    createdAt: 0,
    updatedAt: 0,
    ...overrides
  }
}

describe('toAgentPrompt', () => {
  test('includes the summary when present', () => {
    const out = toAgentPrompt(review(localTarget, { summary: 'Looks mostly good, two notes below.' }))
    expect(out).toContain('Looks mostly good, two notes below.')
  })

  test('renders each line comment with path, line number, and body', () => {
    const out = toAgentPrompt(
      review(localTarget, {
        lineComments: [
          { id: '1', path: 'src/foo.ts', lineNumber: 42, side: 'new', body: 'Rename this please' }
        ]
      })
    )
    expect(out).toContain('src/foo.ts:42')
    expect(out).toContain('Rename this please')
  })

  test('groups multiple comments on the same file together', () => {
    const out = toAgentPrompt(
      review(localTarget, {
        lineComments: [
          { id: '1', path: 'a.ts', lineNumber: 10, side: 'new', body: 'first' },
          { id: '2', path: 'a.ts', lineNumber: 20, side: 'new', body: 'second' },
          { id: '3', path: 'b.ts', lineNumber: 5, side: 'new', body: 'third' }
        ]
      })
    )
    const idxA = out.indexOf('a.ts:10')
    const idxA2 = out.indexOf('a.ts:20')
    const idxB = out.indexOf('b.ts:5')
    expect(idxA).toBeLessThan(idxA2)
    expect(idxA2).toBeLessThan(idxB)
  })

  test('includes code context from the snapshot when available', () => {
    const out = toAgentPrompt(
      review(localTarget, {
        snapshot: {
          files: [
            {
              path: 'src/foo.ts',
              status: 'modified',
              isBinary: false,
              patch:
                'diff --git a/src/foo.ts b/src/foo.ts\n' +
                '--- a/src/foo.ts\n' +
                '+++ b/src/foo.ts\n' +
                '@@ -40,5 +40,5 @@\n' +
                ' context-40\n' +
                ' context-41\n' +
                '-old-42\n' +
                '+new-42\n' +
                ' context-43\n'
            }
          ]
        },
        lineComments: [
          { id: '1', path: 'src/foo.ts', lineNumber: 42, side: 'new', body: 'Fix this' }
        ]
      })
    )
    expect(out).toContain('new-42')
    expect(out).toContain('Fix this')
  })
})

describe('toGitHubReview', () => {
  test('passes summary as body and event defaults to COMMENT', () => {
    const payload = toGitHubReview(review(prTarget, { summary: 'lgtm' }))
    expect(payload.body).toBe('lgtm')
    expect(payload.event).toBe('COMMENT')
    expect(payload.comments).toEqual([])
  })

  test('uses the chosen event', () => {
    const payload = toGitHubReview(review(prTarget, { summary: 'ship it', event: 'APPROVE' }))
    expect(payload.event).toBe('APPROVE')
  })

  test('maps line comments into octokit comment shape with side', () => {
    const payload = toGitHubReview(
      review(prTarget, {
        lineComments: [
          { id: 'a', path: 'src/x.ts', lineNumber: 12, side: 'new', body: 'rename' },
          { id: 'b', path: 'src/y.ts', lineNumber: 30, side: 'old', body: 'why?' }
        ]
      })
    )
    expect(payload.comments).toEqual([
      { path: 'src/x.ts', line: 12, side: 'RIGHT', body: 'rename' },
      { path: 'src/y.ts', line: 30, side: 'LEFT', body: 'why?' }
    ])
  })

  test('maps a reply (inReplyToId set) into in_reply_to without line/side', () => {
    const payload = toGitHubReview(
      review(prTarget, {
        lineComments: [
          { id: 'r1', path: 'src/x.ts', lineNumber: 12, side: 'new', body: 'thanks', inReplyToId: 999 }
        ]
      })
    )
    expect(payload.comments).toEqual([
      { path: 'src/x.ts', body: 'thanks', in_reply_to: 999 }
    ])
  })
})
