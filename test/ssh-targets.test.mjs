import test from 'node:test'
import assert from 'node:assert/strict'
import { sshTarget } from '../src/worker/ssh-targets.mjs'

const saved = { id: 'ssh-1', label: 'Endo VPS Server', configHost: '203.0.113.10', host: '203.0.113.10', port: 22, username: 'ubuntu', source: 'manual' }

test("an environment's SSH target is found by id", () => {
  assert.deepEqual(sshTarget([{ id: 'other', host: 'x' }, saved], 'ssh-1'), { host: '203.0.113.10', port: 22, user: 'ubuntu' })
  assert.equal(sshTarget([saved], 'ssh-2'), null)
  assert.equal(sshTarget(null, 'ssh-1'), null)
})

test('an ~/.ssh/config alias wins over the resolved host, so ssh applies that config', () => {
  assert.deepEqual(sshTarget([{ ...saved, configHost: 'vps', host: '10.0.0.5', username: '', port: undefined }], 'ssh-1'), { host: 'vps', port: 22, user: null })
})

test('addresses that would read as ssh options, or are malformed, are refused', () => {
  for (const change of [
    { configHost: '-oProxyCommand=calc', host: '-oProxyCommand=calc' },
    { configHost: 'a b' },
    { configHost: '', host: '' },
    { port: 0 },
    { port: '22' },
    { port: 70000 },
    { username: '-l' },
    { username: 'a b' }
  ]) {
    assert.equal(sshTarget([{ ...saved, ...change }], 'ssh-1'), null, JSON.stringify(change))
  }
})
