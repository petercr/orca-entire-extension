import test from 'node:test'
import assert from 'node:assert/strict'
import { desktopEnv } from '../src/worker/process.mjs'

test('Windows CLIs get APPDATA and LOCALAPPDATA derived from USERPROFILE', () => {
  const env = desktopEnv({ USERPROFILE: 'C:\\Users\\me' }, 'win32')
  assert.equal(env.APPDATA, 'C:\\Users\\me\\AppData\\Roaming')
  assert.equal(env.LOCALAPPDATA, 'C:\\Users\\me\\AppData\\Local')
})

test('values already in the env win', () => {
  assert.equal(desktopEnv({ USERPROFILE: 'C:\\Users\\me', APPDATA: 'D:\\data' }, 'win32').APPDATA, 'D:\\data')
})

test('other platforms keep the env untouched', () => {
  const env = { HOME: '/home/me' }
  assert.equal(desktopEnv(env, 'linux'), env)
})
