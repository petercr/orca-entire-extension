import { orcaCli } from './orca-cli.mjs'

// Host API 1.0's readContext names the focused workspace's branch and terminals but not its path.
// A terminal handle identifies the workspace exactly; branch plus name is the fallback when it has none.
export async function resolveFocusedWorkspace(orca, { signal } = {}) {
  const context = await orca.host.call('workspace.readContext', {}, { signal })
  if (!context) return { context: null, path: null, via: 'none', candidates: [] }
  const [terminal] = context.terminals
  if (terminal) {
    const result = await orcaCli(['terminal', 'show', '--terminal', terminal.id], { signal })
    const path = (result.terminal ?? result).worktreePath
    if (path) return { context, path, via: 'terminal', candidates: [path] }
  }
  const { worktrees } = await orcaCli(['worktree', 'list', '--limit', '500'], { signal })
  const candidates = matchWorktrees(worktrees, context).map((worktree) => worktree.path)
  return { context, path: candidates.length === 1 ? candidates[0] : null, via: 'branch', candidates }
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
