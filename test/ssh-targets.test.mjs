import test from 'node:test'
import assert from 'node:assert/strict'
import { serverSshTarget, sshTarget } from '../src/worker/ssh-targets.mjs'

const saved = { id: 'ssh-1', label: 'Endo VPS Server', configHost: '203.0.113.10', host: '203.0.113.10', port: 22, username: 'ubuntu', source: 'manual' }

test("an environment's SSH target is found by id", () => {
  assert.deepEqual(sshTarget([{ id: 'other', host: 'x' }, saved], 'ssh-1'), { host: '203.0.113.10', port: 22, user: 'ubuntu' })
  assert.equal(sshTarget([saved], 'ssh-2'), null)
  assert.equal(sshTarget(null, 'ssh-1'), null)
})

test('an ~/.ssh/config alias wins over the resolved host, so ssh applies that config', () => {
  // No saved port stays null, so the alias's own Port applies.
  assert.deepEqual(sshTarget([{ ...saved, configHost: 'vps', host: '10.0.0.5', username: '', port: undefined }], 'ssh-1'), { host: 'vps', port: null, user: null })
  assert.deepEqual(sshTarget([{ ...saved, configHost: 'vps', port: null }], 'ssh-1'), { host: 'vps', port: null, user: 'ubuntu' })
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

test('every lookup rereads Orca, so an edited target or a re-paired server takes effect', async () => {
  let targetId = 'ssh-1'
  let targets = [saved]
  const showEnvironment = async () => ({ environment: { orcadDeployment: { sshTargetId: targetId } } })
  const savedTargets = async () => targets
  const lookup = () => serverSshTarget('VPS', { showEnvironment, savedTargets })
  assert.equal((await lookup()).host, '203.0.113.10')
  targets = [{ ...saved, configHost: '', host: '203.0.113.20' }]
  assert.equal((await lookup()).host, '203.0.113.20')
  targetId = 'ssh-2'
  targets = [...targets, { ...saved, id: 'ssh-2', configHost: '198.51.100.7' }]
  assert.equal((await lookup()).host, '198.51.100.7')
  targetId = undefined
  await assert.rejects(lookup(), /Orca has no SSH target for VPS/)
})
