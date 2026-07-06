import { describe, test, expect } from 'bun:test'
import { toGitHubReview } from './review-formatter'
import type { PendingReview, ReviewTarget } from './pending-review-store'

const prTarget: ReviewTarget = { owner: 'o', repo: 'r', number: 7 }

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

describe('toGitHubReview', () => {
  test('passes summary as body and event defaults to COMMENT', () => {
    const payload = toGitHubReview(review(prTarget, { summary: 'lgtm' }))
    expect(payload.body).toBe('lgtm')
    expect(payload.event).toBe('COMMENT')
    expect(payload.comments).toEqual([])
    expect(payload.replies).toEqual([])
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

  test('routes a reply (inReplyToId set) to replies, never into createReview comments', () => {
    const payload = toGitHubReview(
      review(prTarget, {
        lineComments: [
          { id: 'r1', path: 'src/x.ts', lineNumber: 12, side: 'new', body: 'thanks', inReplyToId: 999 }
        ]
      })
    )
    // createReview's comments array has no `in_reply_to` — a reply there
    // 422s the whole submit — so replies must not appear in it.
    expect(payload.comments).toEqual([])
    expect(payload.replies).toEqual([{ inReplyTo: 999, body: 'thanks' }])
  })

  test('separates new line comments from replies in one review', () => {
    const payload = toGitHubReview(
      review(prTarget, {
        lineComments: [
          { id: 'a', path: 'src/x.ts', lineNumber: 12, side: 'new', body: 'rename' },
          { id: 'r1', path: 'src/x.ts', lineNumber: 12, side: 'new', body: 'thanks', inReplyToId: 999 }
        ]
      })
    )
    expect(payload.comments).toEqual([
      { path: 'src/x.ts', line: 12, side: 'RIGHT', body: 'rename' }
    ])
    expect(payload.replies).toEqual([{ inReplyTo: 999, body: 'thanks' }])
    // No createReview comment ever carries an in_reply_to key.
    for (const c of payload.comments) expect('in_reply_to' in c).toBe(false)
  })

  test('maps a multi-line comment with start_line + start_side', () => {
    const payload = toGitHubReview(
      review(prTarget, {
        lineComments: [
          {
            id: 'm1',
            path: 'src/x.ts',
            lineNumber: 18,
            side: 'new',
            startLineNumber: 12,
            startSide: 'new',
            body: 'refactor this block'
          }
        ]
      })
    )
    expect(payload.comments).toEqual([
      {
        path: 'src/x.ts',
        line: 18,
        side: 'RIGHT',
        start_line: 12,
        start_side: 'RIGHT',
        body: 'refactor this block'
      }
    ])
  })
})
