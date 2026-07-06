import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { splitPatchByFile } from '../shared/split-patch'
import { GuideContractError, type CodeReference, type CoverageMap } from '../shared/guide-schema'
import type { RenderableSection } from '../shared/guide-view'
import {
  GuideToolHost,
  type GuideEvent,
  type GuideRequest,
  type GuideSource,
  type ReferenceResolver
} from './guide-source'
import { AgentStreamParser } from './agent-stream'
import { buildSystemPrompt, buildUserPrompt } from './agent-prompt'
import { GUIDE_TOOL_NAMES, type AgentConfig } from './agent-config'
import type { GitHubClient } from './github-client'
import type { PrWorktreeManager } from './pr-worktree-manager'

/** Spawn signature — injectable so the subprocess boundary stays isolated. */
export type SpawnFn = (
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv }
) => ChildProcessWithoutNullStreams

export interface AgentRunnerDeps {
  /** Materializes the PR Worktree the Agent runs in. */
  worktrees: PrWorktreeManager
  /** Resolves the GitHub client (PR details + diff); null when `gh` isn't authed. */
  github: () => Promise<GitHubClient | null>
  /** The local repo the app was launched in — the source repo for the worktree. */
  repoPath: string
  config: AgentConfig
  /** Override the spawn implementation (defaults to node's child_process.spawn). */
  spawnFn?: SpawnFn
}

/**
 * The real Agent: spawns the user's local `claude` CLI in the PR Worktree and
 * turns its run into a stream of validated Guide events, implementing the same
 * `GuideSource` seam as the stub so no caller changes.
 *
 * Everything subprocess-shaped is quarantined here: it acquires the worktree at
 * the head SHA, spawns `claude` with `--output-format stream-json` and the two
 * hosted tools registered via an MCP bridge, reads each `emit_section` /
 * `finalize_guide` tool call off the stream, and routes every payload through
 * `GuideToolHost` — the single trust boundary — which validates against
 * GuideSchema and resolves each reference to displayable content (files from the
 * worktree for context, the diff for changed refs). Callers see only
 * `generate() → AsyncIterable<GuideEvent>`.
 *
 * The Agent is additive: any failure throws out of the iterator so the IPC layer
 * can surface a `guide:error` (with whatever streamed) without touching
 * Activity or Diff.
 */
export class AgentRunner implements GuideSource {
  private readonly spawn: SpawnFn

  constructor(private readonly deps: AgentRunnerDeps) {
    this.spawn = deps.spawnFn ?? (spawn as unknown as SpawnFn)
  }

  async *generate(request: GuideRequest, signal?: AbortSignal): AsyncIterable<GuideEvent> {
    if (signal?.aborted) return

    const client = await this.deps.github()
    if (!client) {
      throw new Error('Cannot generate the Guide: the GitHub CLI (`gh`) is not authenticated.')
    }

    // getPR/getPRDiff still fetch the prompt metadata (title/body/diff); the head
    // SHA the worktree is materialized at comes from `request.headSha` — resolved
    // once upstream — so it can't diverge from the SHA the cache is keyed by.
    const pr = await client.getPR(request.owner, request.repo, request.number)
    const diff = await client.getPRDiff(request.owner, request.repo, request.number)
    if (signal?.aborted) return
    const worktreePath = await this.deps.worktrees.acquire(this.deps.repoPath, request.headSha)
    if (signal?.aborted) return

    const host = new GuideToolHost(makeResolver(worktreePath, diff))

    const child = this.spawn(this.deps.config.claudeBin, this.claudeArgs(), {
      cwd: worktreePath,
      env: this.childEnv()
    })

    // Kill the `claude` child on abort; that closes the tool bridge's stdin, so
    // the bridge exits too — no subprocess outlives its Window/target.
    const onAbort = (): void => {
      child.kill()
    }
    signal?.addEventListener('abort', onAbort)

    // The per-PR prompt (which carries the diff) goes over stdin so a large diff
    // never hits the OS arg-length limit.
    child.stdin.write(buildUserPrompt({ pr, diff }))
    child.stdin.end()

    let stderr = ''
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString()
    })
    let spawnError: Error | null = null
    child.on('error', err => {
      spawnError = err
      child.stdout.destroy()
    })
    const exit = new Promise<number | null>(resolve => child.on('close', code => resolve(code)))

    const parser = new AgentStreamParser(GUIDE_TOOL_NAMES)
    let finalized = false

    try {
      for await (const chunk of child.stdout) {
        if (signal?.aborted) break
        for (const call of parser.push(chunk.toString())) {
          if (call.tool === 'emit_section') {
            const section = await tryEmit(host, call.input)
            if (section) yield { type: 'section', section }
          } else {
            const coverage = tryFinalize(host, call.input)
            if (coverage) {
              finalized = true
              yield { type: 'finalized', coverage }
            }
          }
        }
      }
    } finally {
      signal?.removeEventListener('abort', onAbort)
    }

    const code = await exit
    // Aborted intentionally (e.g. navigated to another PR): not an error.
    if (signal?.aborted) return
    if (spawnError) {
      throw new Error(
        `Could not start the Agent (\`${this.deps.config.claudeBin}\`): ${(spawnError as Error).message}`
      )
    }
    if (!finalized) {
      const detail = stderr.trim().split('\n').pop() || `exit code ${code}`
      throw new Error(`The Agent did not finish generating the Guide (${detail}).`)
    }
  }

  /**
   * Environment for the `claude` child. Unless the config opts into API-key auth,
   * strip `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` so a user who has one
   * exported still runs on their subscription rather than silently billing the API.
   */
  private childEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env, ...this.deps.config.env }
    if (!this.deps.config.useApiKey) {
      delete env.ANTHROPIC_API_KEY
      delete env.ANTHROPIC_AUTH_TOKEN
    }
    return env
  }

  /** The `claude` invocation — non-interactive, streaming JSON, tools hosted via the MCP bridge. */
  private claudeArgs(): string[] {
    const { model, allowedTools, mcpConfigJson, extraArgs } = this.deps.config
    return [
      '-p',
      '--output-format',
      'stream-json',
      '--verbose', // required by the CLI for stream-json output
      '--model',
      model,
      '--system-prompt',
      buildSystemPrompt(GUIDE_TOOL_NAMES),
      '--mcp-config',
      mcpConfigJson,
      '--strict-mcp-config', // ignore the user's other MCP servers; only ours
      '--allowedTools',
      ...allowedTools,
      ...extraArgs
    ]
  }
}

/**
 * Resolve a Code Reference to displayable content: changed refs to the file's
 * slice of the PR diff, unchanged/context refs to the full file text read from
 * the worktree (which is checked out at the head SHA). Never throws — a missing
 * file or diff resolves to a short placeholder so one bad reference can't abort
 * the stream.
 */
function makeResolver(worktreePath: string, diff: string): ReferenceResolver {
  const patchByPath = new Map(splitPatchByFile(diff).map(p => [p.path, p.patch]))
  return async (ref: CodeReference): Promise<string> => {
    if (ref.renderMode === 'diff') {
      return patchByPath.get(ref.path) ?? `(no diff available for ${ref.path})`
    }
    try {
      return await readFile(join(worktreePath, ref.path), 'utf8')
    } catch {
      return `(could not read ${ref.path} from the PR worktree)`
    }
  }
}

/**
 * Validate + resolve an `emit_section` payload. A contract violation is dropped
 * (logged) rather than thrown: the bridge already returned the error to the
 * Agent, which typically re-emits a corrected Section — one bad call shouldn't
 * kill the whole run.
 */
async function tryEmit(host: GuideToolHost, input: unknown): Promise<RenderableSection | null> {
  try {
    return await host.emitSection(input)
  } catch (err) {
    if (err instanceof GuideContractError) {
      console.warn('Skipping invalid emit_section payload:', err.message)
      return null
    }
    throw err
  }
}

function tryFinalize(host: GuideToolHost, input: unknown): CoverageMap | null {
  try {
    return host.finalizeGuide(input)
  } catch (err) {
    if (err instanceof GuideContractError) {
      console.warn('Skipping invalid finalize_guide payload:', err.message)
      return null
    }
    throw err
  }
}
