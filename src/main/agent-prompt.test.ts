import { describe, test, expect } from 'bun:test'
import {
  SECTION_CAP,
  DEFAULT_GUIDE_GUIDANCE,
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

  test('includes the shipped default guidance (tight prose, load-bearing) by default', () => {
    expect(prompt).toContain(DEFAULT_GUIDE_GUIDANCE)
    const lower = prompt.toLowerCase()
    expect(lower).toContain('load-bearing')
    expect(lower).toContain('tight')
  })

  test('always states honest degradation onto the Diff view (contract)', () => {
    expect(prompt.toLowerCase()).toMatch(/diff view/)
  })

  test('the cap is configurable', () => {
    expect(buildSystemPrompt(NAMES, null, 4)).toContain('4')
  })

  describe('custom guidance', () => {
    const custom = 'Always narrate the tests last, and focus on the auth flow.'

    test('includes the custom guidance when provided', () => {
      const p = buildSystemPrompt(NAMES, custom)
      expect(p).toContain(custom)
    })

    test('drops the shipped default when a custom guidance is provided', () => {
      const p = buildSystemPrompt(NAMES, custom)
      expect(p).not.toContain(DEFAULT_GUIDE_GUIDANCE)
    })

    test('keeps the fixed contract + cap present even with custom guidance', () => {
      const p = buildSystemPrompt(NAMES, custom)
      expect(p).toContain(NAMES.emitSection)
      expect(p).toContain(NAMES.finalizeGuide)
      expect(p).toContain(String(SECTION_CAP))
      expect(p.toLowerCase()).toMatch(/diff view/)
    })

    test('keeps the fixed contract even with an empty/garbage guidance', () => {
      for (const bad of ['', '   ', '\n\t']) {
        const p = buildSystemPrompt(NAMES, bad)
        expect(p).toContain(NAMES.emitSection)
        expect(p).toContain(NAMES.finalizeGuide)
        expect(p).toContain(String(SECTION_CAP))
        // Falls back to the shipped default guidance.
        expect(p).toContain(DEFAULT_GUIDE_GUIDANCE)
      }
    })
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
