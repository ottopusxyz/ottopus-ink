import { access, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { delimiter, join } from 'node:path'
import type { AgentStatus } from '../../shared/ipc'
import { run, type RunResult } from './run'
import { AGENT_SPECS, agentState, missingFromHelp, parseVersion, type AgentSpec } from './specs'

/** Long enough for a cold Node CLI on a slow disk, short enough not to hang the picker. */
const PROBE_TIMEOUT_MS = 15_000

/**
 * Which required flags each installed version lacks, keyed by agent and
 * version: `--help` runs once per version, not on every check.
 */
const flagTable = new Map<string, string[]>()

/**
 * Finds and checks every agent on the given PATH, in parallel. Read-only: it
 * runs `--version`, `--help` and the sign-in status command, nothing that
 * changes the agent's config or starts a session.
 */
export function detectAgents(path: string): Promise<AgentStatus[]> {
  return Promise.all(AGENT_SPECS.map((spec) => detectAgent(spec, path)))
}

async function detectAgent(spec: AgentSpec, path: string): Promise<AgentStatus> {
  const binary = await findExecutable(spec.binary, path)
  if (!binary) return { id: spec.id, state: 'missing', path: null, version: null, missing: [], signedIn: null }

  const env = { ...process.env, PATH: path }
  const [versionRun, authRun] = await Promise.all([probe(binary, ['--version'], env), probe(binary, spec.auth.args, env)])
  const version = versionRun.code === 0 ? parseVersion(versionRun.stdout) : null

  let missing: string[] = []
  if (version) {
    const key = `${spec.id}@${version}`
    const known = flagTable.get(key)
    if (known) {
      missing = known
    } else {
      const help = await probe(binary, ['--help'], env)
      missing = missingFromHelp(`${help.stdout}\n${help.stderr}`, spec.requires)
      // A failed or timed-out --help is not remembered, so the next check tries again.
      if (help.code === 0) flagTable.set(key, missing)
    }
  }

  const found = { path: binary, version, missing, signedIn: spec.auth.parse(authRun) }
  return { id: spec.id, state: agentState(found), ...found }
}

/** The first file named `name` on PATH that this user may execute. */
export async function findExecutable(name: string, path: string): Promise<string | null> {
  for (const dir of path.split(delimiter)) {
    if (!dir) continue
    const candidate = join(dir, name)
    try {
      await access(candidate, constants.X_OK)
      if ((await stat(candidate)).isFile()) return candidate
    } catch {
      // Not here; keep looking.
    }
  }
  return null
}

function probe(file: string, args: readonly string[], env: NodeJS.ProcessEnv): Promise<RunResult> {
  return run(file, args, { env, timeoutMs: PROBE_TIMEOUT_MS })
}
