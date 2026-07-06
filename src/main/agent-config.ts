/**
 * Configuration for the Agent — the values AgentRunner needs to spawn `claude`
 * and host its tools, kept out of the runner so nothing is a hardcoded magic
 * constant. The model, the CLI binary, and the tool allow-list are all
 * overridable via environment so operators can tune them without a rebuild.
 */

import type { ToolNames } from './agent-stream'

/**
 * Default model: an Opus-class alias. Passed straight to `claude --model`, which
 * resolves the alias to the latest Opus build. Override with `DV_AGENT_MODEL`.
 */
export const DEFAULT_AGENT_MODEL = 'opus'

/** MCP server key the tool bridge registers under; drives the tool namespace. */
export const MCP_SERVER_KEY = 'dv'

/**
 * The (server-namespaced) names `claude` exposes the hosted tools under. MCP
 * namespaces a server's tools as `mcp__<server>__<tool>`, so these must match
 * what AgentStreamParser looks for in the stream.
 */
export const GUIDE_TOOL_NAMES: ToolNames = {
  emitSection: `mcp__${MCP_SERVER_KEY}__emit_section`,
  finalizeGuide: `mcp__${MCP_SERVER_KEY}__finalize_guide`
}

/**
 * Tools the Agent is pre-authorized to use non-interactively. Read/Grep/Glob/Bash
 * let it explore the PR Worktree; the two `mcp__dv__*` tools are how it emits the
 * Guide. In `-p` mode there is no one to answer a permission prompt, so every
 * tool the Agent needs must be listed here.
 */
export const DEFAULT_ALLOWED_TOOLS = [
  'Read',
  'Grep',
  'Glob',
  'Bash',
  GUIDE_TOOL_NAMES.emitSection,
  GUIDE_TOOL_NAMES.finalizeGuide
]

/** How the tool bridge (an MCP stdio server) is spawned by `claude`. */
export interface McpBridgeSpec {
  command: string
  args: string[]
  env?: Record<string, string>
}

export interface AgentConfig {
  /** Model alias/name passed to `claude --model`. */
  model: string
  /** The `claude` executable (name on PATH or absolute path). */
  claudeBin: string
  /** Tools pre-approved via `--allowedTools`. */
  allowedTools: string[]
  /** The `--mcp-config` value: inline JSON registering the tool bridge. */
  mcpConfigJson: string
  /**
   * Extra CLI args appended verbatim. Empty by default. NB: `--bare` is
   * deliberately NOT here — on this CLI version `--bare` forces API-key auth and
   * never reads the user's subscription/OAuth, which contradicts the "no API
   * key" requirement. Subscription auth works precisely by NOT passing it.
   */
  extraArgs: string[]
  /** Extra environment for the `claude` process. */
  env: Record<string, string>
  /**
   * When false (default), `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` are
   * stripped from the child env so the run uses the user's subscription/OAuth
   * rather than silently billing the API. Set true (via `DV_AGENT_USE_API_KEY`)
   * to deliberately opt into API-key auth.
   */
  useApiKey: boolean
}

/** Serialize the `--mcp-config` payload that tells `claude` how to launch the bridge. */
export function buildMcpConfigJson(bridge: McpBridgeSpec): string {
  return JSON.stringify({
    mcpServers: {
      [MCP_SERVER_KEY]: {
        command: bridge.command,
        args: bridge.args,
        env: bridge.env ?? {}
      }
    }
  })
}

/** Assemble the AgentConfig, honoring `DV_AGENT_MODEL` / `DV_CLAUDE_BIN` overrides. */
export function resolveAgentConfig(
  bridge: McpBridgeSpec,
  env: NodeJS.ProcessEnv = process.env
): AgentConfig {
  return {
    model: env.DV_AGENT_MODEL || DEFAULT_AGENT_MODEL,
    claudeBin: env.DV_CLAUDE_BIN || 'claude',
    allowedTools: DEFAULT_ALLOWED_TOOLS,
    mcpConfigJson: buildMcpConfigJson(bridge),
    extraArgs: [],
    env: {},
    useApiKey: env.DV_AGENT_USE_API_KEY === '1'
  }
}
