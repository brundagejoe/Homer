import type { PendingReview, ReviewEvent } from './pending-review-store'

/**
 * A brand-new Line Comment as the `POST /pulls/{n}/reviews` (createReview)
 * endpoint accepts it. That endpoint's comment objects support only
 * path/line/side/start_line/start_side/body — there is NO `in_reply_to`,
 * so replies are NOT expressible here and are routed separately.
 */
export interface GitHubReviewComment {
  path: string
  line?: number
  side?: 'LEFT' | 'RIGHT'
  /** Provide together with start_side for multi-line comments. */
  start_line?: number
  start_side?: 'LEFT' | 'RIGHT'
  body: string
}

/**
 * A reply to an existing review-comment thread. Posted against the parent
 * comment via the replies endpoint — it cannot ride in the batched
 * createReview call, which would 422 the whole submit.
 */
export interface GitHubReviewReply {
  inReplyTo: number
  body: string
}

export interface GitHubReviewPayload {
  body: string
  event: ReviewEvent
  /** New line comments for the batched createReview call. */
  comments: GitHubReviewComment[]
  /** Replies to existing threads, posted after the review lands. */
  replies: GitHubReviewReply[]
}

export function toGitHubReview(review: PendingReview): GitHubReviewPayload {
  const comments: GitHubReviewComment[] = []
  const replies: GitHubReviewReply[] = []
  for (const c of review.lineComments) {
    // Replies target an existing thread; they go through the replies
    // endpoint, never the createReview comments array.
    if (c.inReplyToId != null) {
      replies.push({ inReplyTo: c.inReplyToId, body: c.body })
      continue
    }
    const base: GitHubReviewComment = {
      path: c.path,
      line: c.lineNumber,
      side: c.side === 'old' ? 'LEFT' : 'RIGHT',
      body: c.body
    }
    if (c.startLineNumber != null && c.startLineNumber !== c.lineNumber) {
      base.start_line = c.startLineNumber
      base.start_side = (c.startSide ?? c.side) === 'old' ? 'LEFT' : 'RIGHT'
    }
    comments.push(base)
  }
  return { body: review.summary, event: review.event ?? 'COMMENT', comments, replies }
}
