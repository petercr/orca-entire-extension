import test from 'node:test'
import assert from 'node:assert/strict'
import { matchWorktrees, shortBranch } from '../src/worker/workspace.mjs'

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
