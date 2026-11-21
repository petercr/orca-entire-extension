import { orcaCli } from './orca-cli.mjs'

// readContext names the focused workspace's branch and terminals but not its path. Orca 1.4.265 adds
// a workspaceId for workers (a worktree id, or `identity:<key>`), which identifies the workspace
// exactly, on this desktop or a paired server. Without one, a terminal handle does; branch plus name
// is the fallback when it has none. A workspace on a paired Orca server (a VPS) is not in this
// desktop's runtime at all: older Orcas give its repo's name, an empty branch and no terminals, so
// the paired servers are asked as well.
// `cli` stands in for the Orca CLI in tests.
export async function resolveFocusedWorkspace(orca, { signal, cli = orcaCli } = {}) {
  const context = await orca.host.call('workspace.readContext', {}, { signal })
  if (!context) return { context: null, path: null, via: 'none', candidates: [] }
  // An id lookup that a silent server left open (or a worktree past the listing's limit) still lets a
  // terminal name the workspace exactly.
  const byId = context.workspaceId ? await resolveById(context, { signal, cli }) : null
  if (byId?.path) return byId
  const [terminal] = context.terminals
  if (terminal) {
    const result = await cli(['terminal', 'show', '--terminal', terminal.id], { signal }).catch((error) => {
      if (byId) return {}
      throw error
    })
    const path = (result.terminal ?? result).worktreePath
    if (path) return { context, path, via: 'terminal', candidates: [path] }
  }
  // The id is known but a server that didn't answer may hold it: say so rather than guess by name.
  if (byId) return byId
  const { worktrees, hostScope } = await cli(['worktree', 'list', '--limit', '500'], { signal })
  const candidates = matchWorktrees(worktrees, context).map((worktree) => worktree.path)
  if (candidates.length > 0 || context.terminals.length > 0) {
    return { context, path: candidates.length === 1 ? candidates[0] : null, via: 'branch', candidates }
  }
  return resolveOnServers(context, pairedServers(hostScope), { signal, cli })
}

// The workspace readContext's id names, here or on a paired server; an unresolved result (no path)
// when a server didn't answer; or null when every listing answered and none has it (a folder
// workspace, say), and the other ways of finding it apply.
async function resolveById(context, { signal, cli }) {
  const { worktrees, hostScope } = await cli(['worktree', 'list', '--limit', '500'], { signal })
  const local = worktrees.find((worktree) => !worktree.isArchived && isWorkspace(worktree, context.workspaceId))
  if (local) return { context, path: local.path, via: 'id', candidates: [local.path] }
  const environments = pairedServers(hostScope)
  if (environments.length === 0) return null
  const byId = (worktrees, repos) => matchServerWorktreeById(worktrees, repos, context.workspaceId)
  const { matches, unreachable } = await listServers(environments, byId, { signal, cli })
  // An id names one workspace, so a server that didn't answer can't hold another match.
  if (matches.length === 1) return serverResolution(context, matches)
  return matches.length === 0 && unreachable.length === 0 ? null : serverResolution(context, matches, unreachable)
}

// Orca's workspaceId is the worktree's id, or `identity:` and its identity key. A paired server may
// scope that key to itself, so its instance id, unique to the worktree, matches as well.
export function isWorkspace(worktree, workspaceId) {
  if (!workspaceId) return false
  if (worktree.id === workspaceId) return true
  if (!workspaceId.startsWith('identity:')) return false
  const key = workspaceId.slice('identity:'.length)
  const { identity } = worktree
  return Boolean(identity && (identity.key === key || (identity.instanceId && key.endsWith(`:${identity.instanceId}`))))
}

export function matchServerWorktreeById(worktrees, repos, workspaceId) {
  const repoById = new Map(repos.map((repo) => [repo.id, repo]))
  return worktrees
    .filter((worktree) => !worktree.isArchived && isWorkspace(worktree, workspaceId))
    .map((worktree) => ({ worktree, repo: repoById.get(worktree.repoId ?? worktree.id.split('::')[0]) }))
}

// Each paired server's repos and worktrees, filtered by `match`, with the servers that didn't answer.
async function listServers(environments, match, { signal, cli }) {
  const unreachable = []
  const found = await Promise.all(
    environments.map(async (environment) => {
      try {
        const [{ repos }, { worktrees }] = await Promise.all([
          cli(['repo', 'list'], { signal, environment }),
          cli(['worktree', 'list', '--limit', '500'], { signal, environment })
        ])
        return match(worktrees, repos).map((found) => ({ ...found, environment }))
      } catch (error) {
        unreachable.push(`${environment}: ${error.message}`)
        return []
      }
    })
  )
  return { matches: found.flat(), unreachable }
}

async function resolveOnServers(context, environments, { signal, cli }) {
  const byName = (worktrees, repos) => matchServerWorktrees(worktrees, repos, context)
  const { matches, unreachable } = await listServers(environments, byName, { signal, cli })
  return serverResolution(context, matches, unreachable)
}

// Only the repo's name identifies a server's workspace, so a match counts only when it is the sole one
// and every server answered: a server that didn't may hold the focused workspace under the same name.
export function serverResolution(context, matches, unreachable = []) {
  const candidates = matches.map((match) => `${match.environment} ${match.worktree.path}`)
  if (matches.length !== 1 || unreachable.length > 0) return { context, path: null, via: 'server', candidates, unreachable }
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
