import test from 'node:test'
import assert from 'node:assert/strict'
import { diffStat, parseShortstat, safeRef } from '../src/worker/git.mjs'
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

test('the diff tries the remote base then the local one, refuses a base that is not a ref name, and stops at its deadline', async () => {
  const host = { kind: 'local', path: 'C:\\app' }
  const calls = []
  const failing = async (_host, args, options) => (calls.push([args[2], options.timeoutMs]), { code: 128, stdout: '', stderr: '' })
  const found = async (_host, args, options) => (calls.push([args[2], options.timeoutMs]), { code: 0, stdout: ' 1 file changed, 2 insertions(+)', stderr: '' })

  assert.deepEqual(await diffStat(host, 'main', { head: 'feature', run: found }), { files: 1, additions: 2, deletions: 0 })
  assert.deepEqual(calls, [['origin/main...origin/feature', undefined]])

  // A base Entire gave that could be an option never reaches git.
  calls.length = 0
  assert.equal(await diffStat(host, '--output=C:\\x', { head: 'feature', run: found }), null)
  assert.equal(await diffStat(host, 'main', { head: '--output=C:\\x', run: found }), null)
  assert.deepEqual(calls, [])

  // Each attempt gets the time left plus a little, and none starts past the deadline.
  let clock = 0
  const slow = async (...args) => ((clock += 1000), failing(...args))
  assert.equal(await diffStat(host, 'main', { head: 'feature', deadline: 2500, now: () => clock, run: slow }), null)
  assert.deepEqual(calls, [
    ['origin/main...origin/feature', 5500],
    ['main...origin/feature', 4500],
    ['origin/main...feature', 3500]
  ])
})

test('git runs in the workspace, inside WSL for WSL paths', () => {
  assert.deepEqual(gitCommand({ kind: 'local', path: 'C:/repo' }, ['diff']), { command: 'git', args: ['diff'], cwd: 'C:/repo' })
  assert.deepEqual(gitCommand({ kind: 'wsl', distro: 'Ubuntu', path: '/home/me/a b' }, ['diff']), {
    command: 'wsl.exe',
    args: ['-d', 'Ubuntu', '--cd', '/home/me/a b', '-e', 'git', 'diff']
  })
})
