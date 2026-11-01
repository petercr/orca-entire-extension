import test from 'node:test'
import assert from 'node:assert/strict'
import { matchServerWorktrees, matchWorktrees, pairedServers, shortBranch } from '../src/worker/workspace.mjs'

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