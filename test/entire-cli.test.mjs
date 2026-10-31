import test from 'node:test'
import assert from 'node:assert/strict'
import { entireEnv } from '../src/worker/entire-cli.mjs'

test("the plugin's Entire calls opt out of analytics, in WSL too", () => {
  const env = entireEnv({ PATH: 'C:\\bin' })
  assert.equal(env.PATH, 'C:\\bin')
  assert.equal(env.ENTIRE_TELEMETRY_OPTOUT, '1')
  assert.equal(env.WSLENV, 'ENTIRE_TELEMETRY_OPTOUT')
})

test('an existing WSLENV keeps its entries', () => {
  assert.equal(entireEnv({ WSLENV: 'USERPROFILE/p' }).WSLENV, 'USERPROFILE/p:ENTIRE_TELEMETRY_OPTOUT')
})
