import { describe, test, expect } from 'bun:test'
import {
  SECTION_CAP,
  buildSystemPrompt,
  buildUserPrompt,
  type PromptPrDetails
} from './agent-prompt'
import type { ToolNames } from './agent-stream'

const NAMES: ToolNames = {
  emitSection: 'mcp__dv__emit_section',
  finalizeGuide: 'mcp__dv__finalize_guide'
}

const PR: PromptPrDetails = {
  title: 'Add retry to the uploader',
  body: 'Fixes flaky uploads by retrying with backoff.',
  author: 'octocat',
  baseRef: 'main',
  headRef: 'feature/retry',
  changedFiles: 3
}

describe('buildSystemPrompt', () => {
  const prompt = buildSystemPrompt(NAMES)

  test('names both hosted tools so the Agent knows how to emit', () => {
    expect(prompt).toContain(NAMES.emitSection)
    expect(prompt).toContain(NAMES.finalizeGuide)
  })

  test('states the section cap as a number', () => {
    expect(prompt).toContain(String(SECTION_CAP))
  })

  test('instructs tight prose, prioritising load-bearing changes, and honest degradation', () => {
    const lower = prompt.toLowerCase()
    expect(lower).toContain('load-bearing')
    expect(lower).toContain('tight')
    expect(lower).toMatch(/diff view/)
  })

  test('the cap is configurable', () => {
    expect(buildSystemPrompt(NAMES, 4)).toContain('4')
  })
})

describe('buildUserPrompt', () => {
  test('includes the PR title, refs, and the diff body', () => {
    const prompt = buildUserPrompt({ pr: PR, diff: 'diff --git a/x b/x\n+hello' })
    expect(prompt).toContain('Add retry to the uploader')
    expect(prompt).toContain('main')
    expect(prompt).toContain('feature/retry')
    expect(prompt).toContain('+hello')
  })

  test('truncates an oversized diff and says so honestly', () => {
    const huge = 'x'.repeat(50)
    const prompt = buildUserPrompt({ pr: PR, diff: huge }, { maxDiffChars: 20 })
    expect(prompt.length).toBeLessThan(huge.length + 2000)
    expect(prompt.toLowerCase()).toContain('truncated')
  })
})
