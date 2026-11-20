import test from 'node:test'
import assert from 'node:assert/strict'
import { actionArgs, actionRequest, checkShown, runAction } from '../src/worker/actions.mjs'

test('the panel asks only to approve or merge a numbered trail on a valid branch', () => {
  assert.deepEqual(actionRequest({ action: 'approve', trail: 7, branch: 'feature/x' }), { action: 'approve', trail: 7, branch: 'feature/x' })
  assert.throws(() => actionRequest({ action: 'close', trail: 7, branch: 'x' }), /Unknown/)
  assert.throws(() => actionRequest({ action: 'toString', trail: 7, branch: 'x' }), /Unknown/)
  assert.throws(() => actionRequest({ action: 'merge', trail: 0, branch: 'x' }), /trail number/)
  assert.throws(() => actionRequest({ action: 'merge', trail: '7; rm', branch: 'x' }), /trail number/)
  assert.throws(() => actionRequest({ action: 'merge', trail: 7, branch: '--force' }), /branch/)
  assert.throws(() => actionRequest(null), /Unknown/)
})

const shown = (trail) => ({ data: { trail: { number: 7, branch: 'feature', open: true, blockers: [], ...trail } } })

test('an action runs only on the trail the panel shows for the focused workspace', () => {
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

test('a focus change since the click stops the action before the workspace is even looked up', async () => {
  const context = { displayName: 'api', branch: 'main', terminals: [{ id: 't1' }] }
  const data = { workspaces: [{ at: 'now', workspace: { name: 'api', branch: 'main', terminals: ['t1'] }, data: { trail: { number: 3, branch: 'main', open: true, blockers: [] } } }] }
  const orca = {
    host: {
      call: async () => {
        throw new Error('looked up the workspace')
      }
    }
  }
  await assert.rejects(runAction(orca, { action: 'approve', trail: 7, branch: 'main' }, { readContext: async () => context, data }), /no longer shows trail #7/)
  await assert.rejects(runAction(orca, { action: 'approve', trail: 3, branch: 'main' }, { readContext: async () => null, data }), /no longer shows trail #3/)
})
