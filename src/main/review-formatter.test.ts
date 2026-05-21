import { describe, test, expect } from 'bun:test'
import { toAgentPrompt } from './review-formatter'
import type { PendingReview } from './pending-review-store'

function review(overrides: Partial<PendingReview> = {}): PendingReview {
  return {
    repoPath: '/Users/joe/repo',
    sourceSpec: { type: 'working-tree-vs-head' },
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
    const out = toAgentPrompt(review({ summary: 'Looks mostly good, two notes below.' }))
    expect(out).toContain('Looks mostly good, two notes below.')
  })

  test('renders each line comment with path, line number, and body', () => {
    const out = toAgentPrompt(
      review({
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
      review({
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
    expect(idxA).toBeGreaterThan(-1)
    expect(idxA2).toBeGreaterThan(-1)
    expect(idxB).toBeGreaterThan(-1)
    expect(idxA).toBeLessThan(idxA2)
    expect(idxA2).toBeLessThan(idxB)
  })

  test('includes code context from the snapshot when available', () => {
    const out = toAgentPrompt(
      review({
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
