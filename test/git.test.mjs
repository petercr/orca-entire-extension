import test from 'node:test'
import assert from 'node:assert/strict'
import { parseShortstat, safeRef } from '../src/worker/git.mjs'
import { gitCommand } from '../src/worker/hosts.mjs'

test('shortstat counts, including the ones git leaves out', () => {
  assert.deepEqual(parseShortstat(' 3 files changed, 458 insertions(+), 20 deletions(-)\n'), { files: 3, additions: 458, deletions: 20 })
  assert.deepEqual(parseShortstat(' 1 file changed, 1 insertion(+)\n'), { files: 1, additions: 1, deletions: 0 })
  assert.deepEqual(parseShortstat(''), { files: 0, additions: 0, deletions: 0 })
})

test('only plain branch names from Entire reach git', () => {
  for (const ok of ['main', 'release/1.2', 'feat_x-y']) assert.equal(safeRef(ok), ok)
  for (const bad of ['-c', '--upload-pack=x', 'a..b', 'main;rm', 'a b', '', null, undefined]) assert.equal(safeRef(bad), null)
})

test('git runs in the workspace, inside WSL for WSL paths', () => {
  assert.deepEqual(gitCommand({ kind: 'local', path: 'C:/repo' }, ['diff']), { command: 'git', args: ['diff'], cwd: 'C:/repo' })
  assert.deepEqual(gitCommand({ kind: 'wsl', distro: 'Ubuntu', path: '/home/me/a b' }, ['diff']), {
    command: 'wsl.exe',
    args: ['-d', 'Ubuntu', '--cd', '/home/me/a b', '-e', 'git', 'diff']
  })
})
