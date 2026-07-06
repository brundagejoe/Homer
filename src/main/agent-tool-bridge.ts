/**
 * The tool bridge — a minimal MCP stdio server that `claude` launches (via
 * `--mcp-config`) so the Agent can CALL the two hosted tools, `emit_section` and
 * `finalize_guide`.
 *
 * Why it exists: MCP is how the local `claude` CLI is told about app-defined
 * tools. This process declares the two tools and their schemas, validates each
 * call's SHAPE against GuideSchema (so a malformed call comes back as an error
 * the Agent can fix), and acks. It intentionally does NO content resolution and
 * holds no app state: AgentRunner reads every tool call's payload straight off
 * `claude`'s `--output-format stream-json` stdout and does the authoritative
 * validation + reference resolution there. The bridge is the thin protocol shim;
 * the real hosting lives in AgentRunner/GuideToolHost.
 *
 * Runs as a plain Node process (spawned with ELECTRON_RUN_AS_NODE=1), so it must
 * not import electron — only node builtins and the pure GuideSchema.
 */

import {
  parseEmitSection,
  parseFinalizeGuide,
  GuideContractError,
  EMIT_SECTION_JSON_SCHEMA,
  FINALIZE_GUIDE_JSON_SCHEMA
} from '../shared/guide-schema'

const PROTOCOL_VERSION = '2024-11-05'

interface JsonRpcMessage {
  jsonrpc: '2.0'
  id?: number | string
  method?: string
  params?: unknown
  result?: unknown
  error?: unknown
}

// The input schemas ARE the contract — imported from guide-schema (the single
// source of truth), never restated here, so what the Agent is told and what the
// validators enforce can't drift.
const TOOLS = [
  {
    name: 'emit_section',
    description:
      'Emit one Section of the Guide, in reading order. Call once per Section. Keep explanations tight and prioritise load-bearing changes.',
    inputSchema: EMIT_SECTION_JSON_SCHEMA
  },
  {
    name: 'finalize_guide',
    description:
      'Call exactly once at the end. Declare the Coverage Map: which changed hunks the Guide narrated vs. deliberately omitted.',
    inputSchema: FINALIZE_GUIDE_JSON_SCHEMA
  }
]

function send(message: JsonRpcMessage): void {
  process.stdout.write(JSON.stringify(message) + '\n')
}

function reply(id: number | string, result: unknown): void {
  send({ jsonrpc: '2.0', id, result })
}

/** A successful tool result carries an ack; the payload itself is consumed by AgentRunner via the stream. */
function toolOk(id: number | string, text: string): void {
  reply(id, { content: [{ type: 'text', text }] })
}

/** An errored tool result the Agent can read and correct. */
function toolError(id: number | string, text: string): void {
  reply(id, { content: [{ type: 'text', text }], isError: true })
}

function handleToolCall(id: number | string, params: unknown): void {
  const { name, arguments: args } = (params ?? {}) as { name?: string; arguments?: unknown }
  try {
    if (name === 'emit_section') {
      const section = parseEmitSection(args)
      toolOk(id, `Section ${section.ordinal} accepted.`)
    } else if (name === 'finalize_guide') {
      parseFinalizeGuide(args)
      toolOk(id, 'Guide finalized.')
    } else {
      toolError(id, `Unknown tool: ${String(name)}`)
    }
  } catch (err) {
    if (err instanceof GuideContractError) {
      toolError(id, `Rejected: ${err.message}. Fix the arguments and call the tool again.`)
    } else {
      toolError(id, `Tool error: ${(err as Error).message ?? String(err)}`)
    }
  }
}

function handle(message: JsonRpcMessage): void {
  const { id, method, params } = message
  switch (method) {
    case 'initialize':
      if (id === undefined) return
      reply(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'dv-guide-tools', version: '1.0.0' }
      })
      return
    case 'tools/list':
      if (id === undefined) return
      reply(id, { tools: TOOLS })
      return
    case 'tools/call':
      if (id === undefined) return
      handleToolCall(id, params)
      return
    case 'ping':
      if (id !== undefined) reply(id, {})
      return
    default:
      // Notifications (e.g. notifications/initialized) and anything unknown: no
      // response. A request (has id) for an unknown method gets a JSON-RPC error.
      if (id !== undefined) {
        send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } })
      }
  }
}

/** Read newline-delimited JSON-RPC from stdin and serve the two tools until stdin closes. */
export function runToolBridge(): void {
  let buffer = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk: string) => {
    buffer += chunk
    let newline: number
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (!line) continue
      try {
        handle(JSON.parse(line) as JsonRpcMessage)
      } catch {
        // Ignore unparseable lines rather than crash the bridge.
      }
    }
  })
  process.stdin.on('end', () => process.exit(0))
}

// Activated only when spawned as the bridge (env set in the --mcp-config entry),
// so importing this module for typecheck/build never starts a server.
if (process.env.DV_TOOL_BRIDGE === '1') {
  runToolBridge()
}
