import { failureLine, runEntire } from './entire-cli.mjs'
import { diffStat, safeRef } from './git.mjs'
import { serverHost, workspaceHost } from './hosts.mjs'
import { serverSshTarget } from './ssh-targets.mjs'
import { trailSummary } from './trail.mjs'
import { resolveFocusedWorkspace } from './workspace.mjs'

const VERSION = { key: 'version', label: 'Entire CLI', args: ['--version'], parse: (out) => out.trim().split('\n')[0] }

// Each step keeps its own outcome, so one failed call (a branch without a trail, say) hides nothing else.
// `byRepo` steps read Entire's server and also work for a paired server's workspace, given --repo and
// --branch; the others read the checkout, which for a paired server means over SSH.
const STEPS = [
  {
    key: 'status',
    label: 'Repo',
    args: ['status', '--json'],
    parse: JSON.parse,
    summarize: (status) =>
      status.enabled ? `enabled · agents: ${(status.agents ?? []).join(', ') || 'none'}` : 'Entire is not enabled here'
  },
  // A branch without a trail is normal, so this step reports instead of failing the check.
  {
    key: 'trail',
    label: 'Trail',
    args: ['trail', 'show', '--json'],
    byRepo: true,
    optional: true,
    parse: JSON.parse,
    summarize: (trail) => `#${trail.number} ${trail.title} · ${trail.status}`
  },
  {
    key: 'checkpoints',
    label: 'Checkpoints',
    args: ['checkpoint', 'list', '--json'],
    parse: JSON.parse,
    summarize: (list) => `${list.length} on this branch`
  }
]

// Fetched alongside the steps for the panel only: the connection check doesn't report them. Every status,
// so resolved findings and how they were fixed show too, as in Entire's web view.
const FINDINGS = {
  key: 'findings',
  label: 'Findings',
  args: ['trail', 'finding', 'list', '--status', 'any', '--freshness', 'any', '--json'],
  byRepo: true,
  parse: JSON.parse
}

// The panel keeps the newest checkpoints only.
const CHECKPOINT_LIMIT = 20

// Everything the panel and "Entire: Check connection" show for the focused workspace.
export async function collectSnapshot(orca, { signal } = {}) {
  const snapshot = { at: new Date().toISOString(), workspace: null, problem: null, steps: [], data: {} }

  let resolved
  try {
    resolved = await resolveFocusedWorkspace(orca, { signal })
  } catch (error) {
    return { ...snapshot, problem: `Workspace lookup failed: ${error.message}` }
  }
  const { context, path, via, candidates, server, unreachable = [] } = resolved
  if (!context) return { ...snapshot, problem: 'No workspace is focused' }
  const workspace = {
    name: context.displayName,
    branch: context.branch,
    terminals: context.terminals.map((terminal) => terminal.id),
    path,
    via
  }
  if (!path) return { ...snapshot, workspace, problem: unresolved(context, via, candidates, unreachable) }

  let host = workspaceHost(path)
  if (server) {
    let target = null
    let remoteProblem = null
    try {
      target = await serverSshTarget(server.environment, { signal })
    } catch (error) {
      remoteProblem = error.message
    }
    host = serverHost({ ...server, path, target, remoteProblem })
    // readContext gives a server workspace's repo name and no branch; the panel shows the real branch.
    workspace.server = { environment: server.environment, branch: server.branch }
    workspace.where = `${server.environment} ${path}`
    if (!host.repo) return { ...snapshot, workspace, problem: `${path} on ${server.environment} has no origin remote, so Entire can't tell which repository it is.` }
    if (!host.branch) return { ...snapshot, workspace, problem: `${path} on ${server.environment} is on no branch (detached HEAD?), so Entire has no trail to look up.` }
  } else {
    workspace.where = host.kind === 'wsl' ? `WSL ${host.distro} ${host.path}` : path
  }

  const version = await runStep(host, VERSION, signal)
  if (!version.ok) return { ...snapshot, workspace, steps: [version.step] }
  const [findings, ...results] = await Promise.all([FINDINGS, ...STEPS].map((step) => runStep(host, step, signal)))
  const data = Object.fromEntries(results.filter((result) => result.ok).map((result) => [result.step.key, result.value]))
  if (data.checkpoints) data.checkpoints = data.checkpoints.slice(0, CHECKPOINT_LIMIT)
  if (data.trail) {
    const found = findings.ok ? findings.value : null
    const base = safeRef(found?.trail?.base)
    const checkout = host.kind === 'server' ? host.remote : host
    const diff = base && checkout ? await diffStat(checkout, base, { signal }) : null
    data.trail = trailSummary(data.trail, { findings: found, diff })
  }
  return { ...snapshot, workspace, steps: [version.step, ...results.map((result) => result.step)], data }
}

function unresolved(context, via, candidates, unreachable) {
  const name = context.branch ? `${context.displayName} on ${context.branch}` : context.displayName
  const offline = unreachable.length > 0 ? ` (couldn't ask ${unreachable.join('; ')})` : ''
  if (via === 'server' && unreachable.length > 0) {
    // A server that didn't answer may hold the focused workspace under the same repo name.
    const found = candidates.length > 0 ? `${candidates.length} other ${candidates.length === 1 ? 'match' : 'matches'}, but ` : ''
    return `${name}: ${found}couldn't ask every paired server, so the focused workspace is unknown${offline}. Use ↻ once it answers.`
  }
  if (via === 'server' && candidates.length > 1) {
    // Orca names only the repo of a paired server's workspace, so its worktrees look alike.
    return `${name}: ${candidates.length} workspaces of this repository match on paired servers, and Orca doesn't tell plugins which one is focused.`
  }
  if (candidates.length > 0) {
    // Without a terminal, only branch and name identify the workspace, and many repos share "main".
    return `${name}: ${candidates.length} workspaces match it. Open a terminal in it and try again.`
  }
  return `${name}: no workspace matches it${offline}. Open a terminal in it and try again.`
}

async function runStep(host, { key, label, args, byRepo = false, optional = false, parse, summarize = (value) => value }, signal) {
  const step = { key, label, optional, ok: false }
  if (host.kind === 'server' && key !== 'version') {
    if (byRepo) args = [...args, '--repo', host.repo, '--branch', host.branch]
    else if (host.remote) host = host.remote
    // Without SSH only Entire's server is in reach; say so instead of failing.
    else return { ok: false, step: { ...step, optional: true, text: `only readable on ${host.environment}, which the plugin can't reach over SSH (${host.remoteProblem ?? 'no SSH target'})` } }
  }
  let result
  try {
    result = await runEntire(host, args, { signal })
  } catch (error) {
    return { ok: false, step: { ...step, text: error.message } }
  }
  if (result.code !== 0) return { ok: false, step: { ...step, text: explainFailure(host, result), ms: result.ms } }
  try {
    const value = parse(result.stdout)
    return { ok: true, value, step: { ...step, ok: true, text: summarize(value), ms: result.ms } }
  } catch {
    return { ok: false, step: { ...step, text: `unexpected output: ${result.stdout.slice(0, 120)}`, ms: result.ms } }
  }
}

// Entire answers a repository it doesn't track, or this desktop's login can't see, with a bare 404.
function explainFailure(host, result) {
  const line = failureLine(result)
  if (host.kind === 'server' && /repository not found/i.test(line)) return 'repository not on Entire for this computer’s login'
  // ssh exits 255 for its own failures, as opposed to the remote command's.
  if (host.kind === 'ssh' && result.code === 255) {
    const hint = /permission denied/i.test(line) ? ' Is its key in ssh-agent (ssh-add)?' : ''
    return `SSH to ${host.environment} failed: ${line}${hint}`
  }
  return line
}
