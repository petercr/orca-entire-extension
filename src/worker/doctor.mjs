import { failureLine, runEntire } from './entire-cli.mjs'
import { workspaceHost } from './hosts.mjs'
import { resolveFocusedWorkspace } from './workspace.mjs'

const STEPS = [
  { label: 'Entire CLI', args: ['--version'], summarize: (out) => out.trim().split('\n')[0] },
  {
    label: 'Repo',
    args: ['status', '--json'],
    summarize: (out) => {
      const status = JSON.parse(out)
      if (!status.enabled) return 'Entire is not enabled here'
      return `enabled · agents: ${(status.agents ?? []).join(', ') || 'none'}`
    }
  },
  // A branch without a trail is normal, so this step reports instead of failing the check.
  // Until we have real fixtures, list the keys so the first run shows the trail's JSON shape.
  {
    label: 'Trail',
    args: ['trail', 'show', '--json'],
    optional: true,
    summarize: (out) => `found (${Object.keys(JSON.parse(out)).join(', ')})`
  }
]

// "Entire: Check connection" walks every link the plugin depends on and reports one line per link.
export async function checkConnection(orca, { signal } = {}) {
  const lines = [`Orca host API ${orca.api.major}.${orca.api.minor} · Node ${process.version} on ${process.platform}`]
  const report = (line) => [...lines, line].join('\n')

  let workspace
  try {
    workspace = await resolveFocusedWorkspace(orca, { signal })
  } catch (error) {
    return report(`✗ Workspace lookup failed: ${error.message}`)
  }
  const { context, path, via, candidates } = workspace
  if (!context) return report('✗ No workspace is focused')
  if (!path) {
    // Without a terminal, only branch and name identify the workspace, and many repos share "main".
    const why = candidates.length > 0 ? `${candidates.length} workspaces match it` : 'no workspace matches it'
    return report(`✗ ${context.displayName} on ${context.branch}: ${why}. Open a terminal in it and try again.`)
  }
  const host = workspaceHost(path)
  const where = host.kind === 'wsl' ? `WSL ${host.distro} ${host.path}` : path
  lines.push(`✓ ${context.displayName} on ${context.branch} → ${where} (via ${via})`)

  for (const step of STEPS) {
    let result
    try {
      result = await runEntire(host, step.args, { signal })
    } catch (error) {
      return report(`✗ ${step.label}: ${error.message}`)
    }
    if (result.code !== 0) {
      lines.push(`${step.optional ? '·' : '✗'} ${step.label}: ${failureLine(result)}`)
      if (step.optional) continue
      break
    }
    try {
      lines.push(`✓ ${step.label}: ${step.summarize(result.stdout)} (${result.ms} ms)`)
    } catch {
      lines.push(`✗ ${step.label}: unexpected output: ${result.stdout.slice(0, 120)}`)
      break
    }
  }
  return lines.join('\n')
}
