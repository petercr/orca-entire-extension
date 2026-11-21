import test from 'node:test'
import assert from 'node:assert/strict'
import { isWorkspace, matchServerWorktreeById, matchServerWorktrees, matchWorktrees, pairedServers, resolveFocusedWorkspace, serverResolution, shortBranch } from '../src/worker/workspace.mjs'

test("Orca CLI refs compare with readContext's short branch names", () => {
  assert.equal(shortBranch('refs/heads/feat/trails'), 'feat/trails')
  assert.equal(shortBranch('main'), 'main')
  assert.equal(shortBranch(''), '')
})

test('branch and name must both match, and archived workspaces never do', () => {
  const worktrees = [
    { path: 'a', branch: 'refs/heads/main', displayName: 'main' },
    { path: 'b', branch: 'refs/heads/main', displayName: 'api' },
    { path: 'c', branch: 'refs/heads/main', displayName: 'main', isArchived: true },
    { path: 'd', branch: '', displayName: 'main' }
  ]
  const matches = matchWorktrees(worktrees, { branch: 'main', displayName: 'main' })
  assert.deepEqual(
    matches.map((worktree) => worktree.path),
    ['a']
  )
})

test('paired servers come from the selectors a local listing left out', () => {
  const hostScope = {
    hostIds: ['local'],
    omittedHostIds: ['runtime:c9b8', 'ssh:ssh-1'],
    omittedHostSelectors: [
      { hostId: 'runtime:c9b8', selector: '--environment Endo VPS Server' },
      { hostId: 'ssh:ssh-1', selector: null }
    ]
  }
  assert.deepEqual(pairedServers(hostScope), ['Endo VPS Server'])
  assert.deepEqual(pairedServers(undefined), [])
  assert.deepEqual(pairedServers({ hostIds: ['local'], omittedHostIds: [] }), [])
})

// As `orca repo list` and `orca worktree list --environment "Endo VPS Server"` print them.
const repos = [
  { id: 'c78b', displayName: 'Endo VPS Server', gitRemoteIdentity: { remoteUrl: 'git@github.com:petercr/endo.chat_backend.git' } },
  { id: 'd735', displayName: 'leadgen' }
]
const worktrees = [
  { id: 'c78b::/home/ubuntu', displayName: 'fix/issue-620', branch: 'refs/heads/fix/issue-620', path: '/home/ubuntu' },
  { id: 'd735::/home/ubuntu/leadgen', repoId: 'd735', displayName: 'main', branch: 'refs/heads/main', path: '/home/ubuntu/leadgen' },
  { id: 'd735::/home/ubuntu/old', repoId: 'd735', displayName: 'old', branch: 'refs/heads/old', path: '/home/ubuntu/old', isArchived: true }
]

test("a server workspace matches by its repo's name, which is all readContext gives", () => {
  const [match, ...rest] = matchServerWorktrees(worktrees, repos, { displayName: 'Endo VPS Server', branch: '', terminals: [] })
  assert.equal(rest.length, 0)
  assert.equal(match.worktree.path, '/home/ubuntu')
  assert.equal(match.repo.gitRemoteIdentity.remoteUrl, 'git@github.com:petercr/endo.chat_backend.git')
  assert.deepEqual(
    matchServerWorktrees(worktrees, repos, { displayName: 'leadgen', branch: '', terminals: [] }).map((m) => m.worktree.path),
    ['/home/ubuntu/leadgen']
  )
  assert.deepEqual(matchServerWorktrees(worktrees, repos, { displayName: 'other', branch: '', terminals: [] }), [])
})

test('a server workspace with a branch matches by name and branch, like a local one', () => {
  assert.deepEqual(
    matchServerWorktrees(worktrees, repos, { displayName: 'main', branch: 'main', terminals: [] }).map((m) => m.worktree.path),
    ['/home/ubuntu/leadgen']
  )
  assert.deepEqual(matchServerWorktrees(worktrees, repos, { displayName: 'leadgen', branch: 'main', terminals: [] }), [])
})

test("Orca's workspaceId matches a worktree's id or its identity key", () => {
  const worktree = {
    id: 'd735::/home/ubuntu/leadgen',
    identity: { key: 'wt2:local:ca8a', executionHostId: 'local', instanceId: 'ca8a' }
  }
  assert.ok(isWorkspace(worktree, 'd735::/home/ubuntu/leadgen'))
  assert.ok(isWorkspace(worktree, 'identity:wt2:local:ca8a'))
  // The desktop may scope a server's identity key to that server; the instance id still names it.
  assert.ok(isWorkspace(worktree, 'identity:wt2:runtime:c9b8:ca8a'))
  assert.ok(!isWorkspace(worktree, 'identity:wt2:local:other'))
  assert.ok(!isWorkspace(worktree, 'd735::/home/ubuntu'))
  assert.ok(!isWorkspace({ id: 'x' }, 'identity:wt2:local:x'))
  assert.ok(!isWorkspace(worktree, undefined))
})

test('a server workspace matches by id whatever its name and branch', () => {
  const [match, ...rest] = matchServerWorktreeById(worktrees, repos, 'd735::/home/ubuntu/leadgen')
  assert.equal(rest.length, 0)
  assert.equal(match.worktree.path, '/home/ubuntu/leadgen')
  assert.equal(match.repo.displayName, 'leadgen')
  assert.deepEqual(matchServerWorktreeById(worktrees, repos, 'd735::/home/ubuntu/old'), [])
})

// A desktop whose listing lacks the focused workspace (past its 500 limit, say) and whose one paired
// server doesn't answer.
function offlineServerCli({ terminalPath = null } = {}) {
  return async (args, { environment } = {}) => {
    if (environment) throw new Error('timed out')
    if (args[0] === 'terminal') return { terminal: { worktreePath: terminalPath } }
    return {
      worktrees: [{ id: 'r1::C:\\other', path: 'C:\\other', branch: 'refs/heads/main', displayName: 'main' }],
      hostScope: { omittedHostSelectors: [{ selector: '--environment VPS' }] }
    }
  }
}
const focus = (context) => ({ host: { call: async () => context } })

test("an id a silent server left open still resolves by the workspace's terminal", async () => {
  const context = { workspaceId: 'identity:wt2:local:aaa', displayName: 'main', branch: 'main', terminals: [{ id: 't1' }] }
  const resolved = await resolveFocusedWorkspace(focus(context), { cli: offlineServerCli({ terminalPath: 'C:\\api' }) })
  assert.equal(resolved.path, 'C:\\api')
  assert.equal(resolved.via, 'terminal')
})

test("without a terminal, an id a silent server left open says so instead of guessing by name", async () => {
  const context = { workspaceId: 'identity:wt2:local:aaa', displayName: 'main', branch: 'main', terminals: [] }
  const resolved = await resolveFocusedWorkspace(focus(context), { cli: offlineServerCli() })
  assert.equal(resolved.path, null)
  assert.equal(resolved.via, 'server')
  assert.deepEqual(resolved.unreachable, ['VPS: timed out'])
})

test('a server match counts only when it is the only one and every server answered', () => {
  const context = { displayName: 'leadgen', branch: '', terminals: [] }
  const match = (environment) => ({ environment, worktree: worktrees[1], repo: repos[1] })
  const one = serverResolution(context, [match('VPS one')])
  assert.equal(one.path, '/home/ubuntu/leadgen')
  assert.deepEqual(one.server, { environment: 'VPS one', branch: 'main', repoUrl: null })
  // Another server with a leadgen of its own failed to answer: it may be the focused one.
  const partial = serverResolution(context, [match('VPS one')], ['VPS two: timed out'])
  assert.equal(partial.path, null)
  assert.equal(partial.server, undefined)
  assert.deepEqual(partial.candidates, ['VPS one /home/ubuntu/leadgen'])
  assert.equal(serverResolution(context, [match('VPS one'), match('VPS two')]).path, null)
  assert.equal(serverResolution(context, []).path, null)
})