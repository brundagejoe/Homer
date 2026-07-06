/**
 * Pure parser for the `claude` CLI's `--output-format stream-json` output.
 *
 * The stream is NDJSON: one JSON event per line. The only events this app cares
 * about are the assistant's `tool_use` blocks for the two hosted tools — every
 * call the Agent makes to `emit_section` / `finalize_guide` shows up in the
 * stream with its full `input`, so AgentRunner reads the tool payloads straight
 * off stdout rather than needing a back-channel from the tool bridge.
 *
 * This module knows nothing about subprocesses, git, or the GuideSchema shapes —
 * it only splits lines and pulls out matching tool-call inputs, so it is a pure
 * function of its input and unit-tested in isolation.
 */

/** The (server-namespaced) MCP tool names the bridge exposes. */
export interface ToolNames {
  emitSection: string
  finalizeGuide: string
}

/** A raw, still-unvalidated tool call lifted from the stream. */
export type AgentToolCall =
  | { tool: 'emit_section'; input: unknown }
  | { tool: 'finalize_guide'; input: unknown }

/**
 * Accumulates raw stdout chunks and returns any complete tool calls found. Holds
 * a buffer across `push` calls so a JSON event split across chunk boundaries is
 * only parsed once its terminating newline arrives; a malformed or partial line
 * is skipped rather than throwing.
 */
export class AgentStreamParser {
  private buffer = ''

  constructor(private readonly names: ToolNames) {}

  push(chunk: string): AgentToolCall[] {
    this.buffer += chunk
    const calls: AgentToolCall[] = []
    let newline: number
    while ((newline = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newline)
      this.buffer = this.buffer.slice(newline + 1)
      calls.push(...this.callsFromLine(line))
    }
    return calls
  }

  private callsFromLine(line: string): AgentToolCall[] {
    const trimmed = line.trim()
    if (!trimmed) return []

    let event: unknown
    try {
      event = JSON.parse(trimmed)
    } catch {
      return [] // Not a complete/valid JSON event — ignore.
    }

    const calls: AgentToolCall[] = []
    for (const block of contentBlocks(event)) {
      if (!isToolUse(block)) continue
      if (block.name === this.names.emitSection) {
        calls.push({ tool: 'emit_section', input: block.input })
      } else if (block.name === this.names.finalizeGuide) {
        calls.push({ tool: 'finalize_guide', input: block.input })
      }
    }
    return calls
  }
}

interface ToolUseBlock {
  type: 'tool_use'
  name: string
  input: unknown
}

/** The content blocks of an `assistant` stream event, or empty for anything else. */
function contentBlocks(event: unknown): unknown[] {
  if (typeof event !== 'object' || event === null) return []
  const e = event as { type?: unknown; message?: unknown }
  if (e.type !== 'assistant') return []
  const message = e.message
  if (typeof message !== 'object' || message === null) return []
  const content = (message as { content?: unknown }).content
  return Array.isArray(content) ? content : []
}

function isToolUse(block: unknown): block is ToolUseBlock {
  return (
    typeof block === 'object' &&
    block !== null &&
    (block as { type?: unknown }).type === 'tool_use' &&
    typeof (block as { name?: unknown }).name === 'string'
  )
}
