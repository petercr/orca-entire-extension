import { failureLine, runEntire } from './entire-cli.mjs'
import { diffStat, safeRef } from './git.mjs'
import { workspaceHost } from './hosts.mjs'
import { trailSummary } from './trail.mjs'
import { resolveFocusedWorkspace } from './workspace.mjs'

const VERSION = { key: 'version', label: 'Entire CLI', args: ['--version'], parse: (out) => out.trim().split('\n')[0] }

// Each step keeps its own outcome, so one failed call (a branch without a trail, say) hides nothing else.
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
  const { context, path, via, candidates } = resolved
  if (!context) return { ...snapshot, problem: 'No workspace is focused' }
  const workspace = {
    name: context.displayName,
    branch: context.branch,
    terminals: context.terminals.map((terminal) => terminal.id),
    path,
    via
  }
  if (!path) {
    // Without a terminal, only branch and name identify the workspace, and many repos share "main".
    const why = candidates.length > 0 ? `${candidates.length} workspaces match it` : 'no workspace matches it'
    return { ...snapshot, workspace, problem: `${context.displayName} on ${context.branch}: ${why}. Open a terminal in it and try again.` }
  }
  const host = workspaceHost(path)
  workspace.where = host.kind === 'wsl' ? `WSL ${host.distro} ${host.path}` : path

  const version = await runStep(host, VERSION, signal)
  if (!version.ok) return { ...snapshot, workspace, steps: [version.step] }
  const [findings, ...results] = await Promise.all([FINDINGS, ...STEPS].map((step) => runStep(host, step, signal)))
  const data = Object.fromEntries(results.filter((result) => result.ok).map((result) => [result.step.key, result.value]))
  if (data.checkpoints) data.checkpoints = data.checkpoints.slice(0, CHECKPOINT_LIMIT)
  if (data.trail) {
    const found = findings.ok ? findings.value : null
    const base = safeRef(found?.trail?.base)
    data.trail = trailSummary(data.trail, { findings: found, diff: base ? await diffStat(host, base, { signal }) : null })
  }
  return { ...snapshot, workspace, steps: [version.step, ...results.map((result) => result.step)], data }
}

async function runStep(host, { key, label, args, optional = false, parse, summarize = (value) => value }, signal) {
  const step = { key, label, optional, ok: false }
  let result
  try {
    result = await runEntire(host, args, { signal })
  } catch (error) {
    return { ok: false, step: { ...step, text: error.message } }
  }
  if (result.code !== 0) return { ok: false, step: { ...step, text: failureLine(result), ms: result.ms } }
  try {
    const value = parse(result.stdout)
    return { ok: true, value, step: { ...step, ok: true, text: summarize(value), ms: result.ms } }
  } catch {
    return { ok: false, step: { ...step, text: `unexpected output: ${result.stdout.slice(0, 120)}`, ms: result.ms } }
  }
}
