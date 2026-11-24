import test from 'node:test'
import assert from 'node:assert/strict'
import { actionArgs, actionRequest, checkShown, confirmedEntry, entryHost, runAction } from '../src/worker/actions.mjs'

const WSL_A = '\\\\wsl.localhost\\Ubuntu\\home\\me\\a'
const WSL_B = '\\\\wsl.localhost\\Ubuntu\\home\\me\\b'

test('the panel asks only to approve or merge a numbered trail on a valid branch, in a named workspace', () => {
  assert.deepEqual(actionRequest({ action: 'approve', trail: 7, branch: 'feature/x', path: WSL_A }), {
    action: 'approve',
    trail: 7,
    branch: 'feature/x',
    path: WSL_A,
    environment: null
  })
  assert.equal(actionRequest({ action: 'merge', trail: 7, branch: 'x', path: '/srv/a', environment: 'vps' }).environment, 'vps')
  assert.throws(() => actionRequest({ action: 'close', trail: 7, branch: 'x', path: WSL_A }), /Unknown/)
  assert.throws(() => actionRequest({ action: 'toString', trail: 7, branch: 'x', path: WSL_A }), /Unknown/)
  assert.throws(() => actionRequest({ action: 'merge', trail: 0, branch: 'x', path: WSL_A }), /trail number/)
  assert.throws(() => actionRequest({ action: 'merge', trail: '7; rm', branch: 'x', path: WSL_A }), /trail number/)
  assert.throws(() => actionRequest({ action: 'merge', trail: 7, branch: '--force', path: WSL_A }), /branch/)
  assert.throws(() => actionRequest({ action: 'merge', trail: 7, branch: 'x' }), /workspace/)
  assert.throws(() => actionRequest({ action: 'merge', trail: 7, branch: 'x', path: WSL_A, environment: {} }), /paired server/)
  assert.throws(() => actionRequest(null), /Unknown/)
})

const trail = (extra) => ({ number: 7, branch: 'feature', open: true, blockers: [], ...extra })
const shown = (extra) => ({ data: { trail: trail(extra) } })

test('an action runs only on the trail its workspace shows, and a merge only with nothing blocking', () => {
  const approve = { action: 'approve', trail: 7, branch: 'feature' }
  const merge = { ...approve, action: 'merge' }
  assert.doesNotThrow(() => checkShown(approve, shown()))
  assert.doesNotThrow(() => checkShown(merge, shown()))
  assert.throws(() => checkShown(approve, null), /no longer shows trail #7/)
  assert.throws(() => checkShown(approve, shown({ number: 8 })), /no longer shows/)
  assert.throws(() => checkShown(approve, shown({ branch: 'main' })), /no longer shows/)
  assert.throws(() => checkShown(approve, shown({ open: false })), /isn't open/)
  // Approving doesn't wait on the gates; merging does.
  assert.doesNotThrow(() => checkShown(approve, shown({ blockers: ['Not approved yet'] })))
  assert.throws(() => checkShown(merge, shown({ blockers: ['Not approved yet', 'checks: 1 of 2 passed'] })), /can't merge yet: Not approved yet; checks/)
  assert.throws(() => checkShown(merge, shown({ blockers: undefined })), /refresh the panel/)
})

test("an action finds its trail among the repository's other open changes too", () => {
  const listed = { data: { trail: trail(), trails: [trail(), trail({ number: 9, branch: 'other' }), trail({ number: 9, branch: 'third', open: false })] } }
  assert.doesNotThrow(() => checkShown({ action: 'approve', trail: 9, branch: 'other' }, listed))
  assert.doesNotThrow(() => checkShown({ action: 'merge', trail: 7, branch: 'feature' }, listed))
  assert.throws(() => checkShown({ action: 'approve', trail: 9, branch: 'third' }, listed), /isn't open/)
  assert.throws(() => checkShown({ action: 'approve', trail: 9, branch: 'feature' }, listed), /no longer shows trail #9 on feature/)
  // Data from before the list existed still works by the focused branch's trail.
  assert.doesNotThrow(() => checkShown({ action: 'approve', trail: 7, branch: 'feature' }, shown()))
})

test('Entire gets the trail number and branch, and a paired server also gets the repository', () => {
  const request = { action: 'merge', trail: 7, branch: 'feature' }
  assert.deepEqual(actionArgs(request, { kind: 'wsl' }), ['trail', 'merge', '7', '--branch', 'feature'])
  assert.deepEqual(actionArgs({ ...request, action: 'approve' }, { kind: 'server', repo: 'https://example.com/r.git' }), [
    'trail',
    'approve',
    '7',
    '--branch',
    'feature',
    '--repo',
    'https://example.com/r.git'
  ])
})

// Two workspaces that both show trail #7 on feature: only the path tells them apart.
const entryAt = (path, server = null) => ({ at: 'now', workspace: { name: 'w', branch: 'feature', terminals: [], path, server }, data: { trail: trail() } })
const data = {
  workspaces: [entryAt(WSL_B), entryAt(WSL_A), entryAt('/srv/a', { environment: 'vps', branch: 'feature', repoUrl: 'https://example.com/a.git' })]
}

test('the confirmed workspace is found by its path and paired server, never by what has focus', () => {
  assert.equal(confirmedEntry(data, { path: WSL_A, environment: null }), data.workspaces[1])
  assert.equal(confirmedEntry(data, { path: '/srv/a', environment: 'vps' }), data.workspaces[2])
  assert.equal(confirmedEntry(data, { path: '/srv/a', environment: null }), null)
  assert.equal(confirmedEntry(data, { path: 'C:\\elsewhere', environment: null }), null)
})

test('Entire runs in the confirmed workspace even when another shows the same trail', async () => {
  const calls = []
  const run = async (host, args) => (calls.push({ host, args }), { code: 0, stdout: '', stderr: '' })
  const message = await runAction({ action: 'merge', trail: 7, branch: 'feature', path: WSL_A, environment: null }, { data, run })
  assert.equal(message, 'Merged trail #7 on feature.')
  assert.deepEqual(calls, [{ host: { kind: 'wsl', distro: 'Ubuntu', path: '/home/me/a' }, args: ['trail', 'merge', '7', '--branch', 'feature'] }])

  calls.length = 0
  await runAction({ action: 'approve', trail: 7, branch: 'feature', path: '/srv/a', environment: 'vps' }, { data, run })
  assert.equal(calls[0].host.kind, 'server')
  assert.deepEqual(calls[0].args, ['trail', 'approve', '7', '--branch', 'feature', '--repo', 'https://example.com/a.git'])

  // A workspace the worker has no entry for runs nothing.
  calls.length = 0
  await assert.rejects(runAction({ action: 'approve', trail: 7, branch: 'feature', path: 'C:\\gone', environment: null }, { data, run }), /no longer shows trail #7/)
  assert.equal(calls.length, 0)
})

test("a paired server's entry without its repository can't be acted on", () => {
  assert.throws(() => entryHost(entryAt('/srv/a', { environment: 'vps', branch: 'feature' })), /doesn't know \/srv\/a on vps's repository/)
  assert.deepEqual(entryHost(entryAt('C:\\web')), { kind: 'local', path: 'C:\\web' })
})

test("Entire's refusal comes back as the action's error", async () => {
  const run = async () => ({ code: 1, stdout: '', stderr: 'blocking gate failed: approvals\nmore' })
  await assert.rejects(runAction({ action: 'merge', trail: 7, branch: 'feature', path: WSL_A, environment: null }, { data, run }), /Entire refused to merge trail #7: blocking gate failed: approvals$/)
})
