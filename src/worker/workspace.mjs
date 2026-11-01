import { orcaCli } from './orca-cli.mjs'

// Host API 1.0's readContext names the focused workspace's branch and terminals but not its path.
// A terminal handle identifies the workspace exactly; branch plus name is the fallback when it has none.
// A workspace on a paired Orca server (a VPS) is not in this desktop's runtime at all: readContext then
// gives its repo's name, an empty branch and no terminals, so the paired servers are asked as well.
export async function resolveFocusedWorkspace(orca, { signal } = {}) {
  const context = await orca.host.call('workspace.readContext', {}, { signal })
  if (!context) return { context: null, path: null, via: 'none', candidates: [] }
  const [terminal] = context.terminals
  if (terminal) {
    const result = await orcaCli(['terminal', 'show', '--terminal', terminal.id], { signal })
    const path = (result.terminal ?? result).worktreePath
    if (path) return { context, path, via: 'terminal', candidates: [path] }
  }
  const { worktrees, hostScope } = await orcaCli(['worktree', 'list', '--limit', '500'], { signal })
  const candidates = matchWorktrees(worktrees, context).map((worktree) => worktree.path)
  if (candidates.length > 0 || context.terminals.length > 0) {
    return { context, path: candidates.length === 1 ? candidates[0] : null, via: 'branch', candidates }
  }
  return resolveOnServers(context, pairedServers(hostScope), { signal })
}

async function resolveOnServers(context, environments, { signal }) {
  const unreachable = []
  const found = await Promise.all(
    environments.map(async (environment) => {
      try {
        const [{ repos }, { worktrees }] = await Promise.all([
          orcaCli(['repo', 'list'], { signal, environment }),
          orcaCli(['worktree', 'list', '--limit', '500'], { signal, environment })
        ])
        return matchServerWorktrees(worktrees, repos, context).map((match) => ({ ...match, environment }))
      } catch (error) {
        unreachable.push(`${environment}: ${error.message}`)
        return []
      }
    })
  )
  const matches = found.flat()
  const candidates = matches.map((match) => `${match.environment} ${match.worktree.path}`)
  if (matches.length !== 1) return { context, path: null, via: 'server', candidates, unreachable }
  const [{ environment, worktree, repo }] = matches
  return {
    context,
    path: worktree.path,
    via: 'server',
    candidates,
    unreachable,
    server: { environment, branch: shortBranch(worktree.branch), repoUrl: repo?.gitRemoteIdentity?.remoteUrl ?? null }
  }
}

// Orca's CLI reports full refs; readContext reports short branch names.
export function shortBranch(ref = '') {
  return ref.replace(/^refs\/heads\//, '')
}

export function matchWorktrees(worktrees, { branch, displayName }) {
  return worktrees.filter(
    (worktree) =>
      !worktree.isArchived && shortBranch(worktree.branch) === branch && worktree.displayName === displayName
  )
}

// The paired Orca servers a local listing left out, by the name `--environment` takes. SSH hosts
// without a server of their own have no selector, and the CLI can't reach them.
export function pairedServers(hostScope) {
  return (hostScope?.omittedHostSelectors ?? [])
    .map((host) => /^--environment (.+)$/.exec(host.selector ?? '')?.[1])
    .filter(Boolean)
}

// A server's workspace reaches readContext with its repo's display name and no branch. Should Orca
// start sending the workspace's own name and branch, those match the way local ones do.
export function matchServerWorktrees(worktrees, repos, context) {
  const repoById = new Map(repos.map((repo) => [repo.id, repo]))
  return worktrees
    .filter((worktree) => !worktree.isArchived)
    .map((worktree) => ({ worktree, repo: repoById.get(worktree.repoId ?? worktree.id.split('::')[0]) }))
    .filter(({ worktree, repo }) =>
      context.branch
        ? shortBranch(worktree.branch) === context.branch && worktree.displayName === context.displayName
        : repo?.displayName === context.displayName
    )
}
