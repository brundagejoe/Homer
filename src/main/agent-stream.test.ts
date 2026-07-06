import { describe, test, expect } from 'bun:test'
import { AgentStreamParser, type ToolNames } from './agent-stream'

const NAMES: ToolNames = {
  emitSection: 'mcp__dv__emit_section',
  finalizeGuide: 'mcp__dv__finalize_guide'
}

/** A single NDJSON assistant event carrying one or more tool_use blocks. */
function assistantLine(blocks: Array<{ name: string; input: unknown }>): string {
  return (
    JSON.stringify({
      type: 'assistant',
      message: {
        content: blocks.map(b => ({ type: 'tool_use', id: 'x', name: b.name, input: b.input }))
      }
    }) + '\n'
  )
}

describe('AgentStreamParser', () => {
  test('extracts an emit_section tool call with its input', () => {
    const parser = new AgentStreamParser(NAMES)
    const calls = parser.push(assistantLine([{ name: NAMES.emitSection, input: { ordinal: 1 } }]))
    expect(calls).toEqual([{ tool: 'emit_section', input: { ordinal: 1 } }])
  })

  test('extracts a finalize_guide tool call', () => {
    const parser = new AgentStreamParser(NAMES)
    const calls = parser.push(assistantLine([{ name: NAMES.finalizeGuide, input: { narrated: [] } }]))
    expect(calls).toEqual([{ tool: 'finalize_guide', input: { narrated: [] } }])
  })

  test('ignores non-assistant events and unknown tools', () => {
    const parser = new AgentStreamParser(NAMES)
    const noise =
      JSON.stringify({ type: 'system', subtype: 'init' }) +
      '\n' +
      JSON.stringify({ type: 'result', result: 'done' }) +
      '\n' +
      assistantLine([{ name: 'Read', input: { file: 'x' } }])
    expect(parser.push(noise)).toEqual([])
  })

  test('buffers a JSON object split across chunk boundaries', () => {
    const parser = new AgentStreamParser(NAMES)
    const full = assistantLine([{ name: NAMES.emitSection, input: { ordinal: 2 } }])
    const mid = Math.floor(full.length / 2)
    expect(parser.push(full.slice(0, mid))).toEqual([])
    expect(parser.push(full.slice(mid))).toEqual([{ tool: 'emit_section', input: { ordinal: 2 } }])
  })

  test('returns each tool_use block when one message carries several', () => {
    const parser = new AgentStreamParser(NAMES)
    const calls = parser.push(
      assistantLine([
        { name: NAMES.emitSection, input: { ordinal: 1 } },
        { name: NAMES.emitSection, input: { ordinal: 2 } }
      ])
    )
    expect(calls).toEqual([
      { tool: 'emit_section', input: { ordinal: 1 } },
      { tool: 'emit_section', input: { ordinal: 2 } }
    ])
  })

  test('tolerates blank lines and malformed JSON without throwing', () => {
    const parser = new AgentStreamParser(NAMES)
    expect(parser.push('\n')).toEqual([])
    expect(parser.push('not json at all\n')).toEqual([])
    expect(parser.push('{ partial')).toEqual([])
  })
})
