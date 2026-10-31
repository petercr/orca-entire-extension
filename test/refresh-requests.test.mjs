import test from 'node:test'
import assert from 'node:assert/strict'
import { appendFile, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { REFRESH_REQUEST_TITLE, auditLogPath, hasRefreshRequest, watchRefreshRequests } from '../src/worker/refresh-requests.mjs'

const ACTOR = 'plugin:petercr.entire'
const line = (fields) =>
  `${JSON.stringify({ ts: Date.now(), actor: ACTOR, method: 'notifications.show', summary: `titleChars=${REFRESH_REQUEST_TITLE.length}`, outcome: 'ok', ...fields })}\n`

test('the panel shows the request title the worker listens for', async () => {
  const template = await readFile(new URL('../panel/template.html', import.meta.url), 'utf8')
  assert.ok(template.includes(`'${REFRESH_REQUEST_TITLE}'`))
})

test("no worker notification has the request title's length", async () => {
  const dir = new URL('../src/worker/', import.meta.url)
  const titles = []
  for (const name of await readdir(dir)) {
    const source = await readFile(new URL(name, dir), 'utf8')
    for (const [, title] of source.matchAll(/title: (?:ok \? )?'(Entire: [^']+)'/g)) titles.push(title)
    for (const [, title] of source.matchAll(/: '(Entire: [^']+)'\s*[,}]/g)) titles.push(title)
  }
  assert.ok(titles.length >= 3, `found ${titles.join(', ')}`)
  for (const title of titles) assert.notEqual(title.length, REFRESH_REQUEST_TITLE.length, title)
})

test('only an ok request from this plugin counts', () => {
  assert.ok(hasRefreshRequest([line({})], ACTOR))
  assert.ok(!hasRefreshRequest([line({ outcome: 'attempt' })], ACTOR))
  assert.ok(!hasRefreshRequest([line({ actor: 'plugin:someone.else' })], ACTOR))
  assert.ok(!hasRefreshRequest([line({ summary: 'titleChars=17' })], ACTOR))
  assert.ok(!hasRefreshRequest(['{not json', ''], ACTOR))
})

test('the audit log is under APPDATA on Windows only', () => {
  assert.equal(auditLogPath({ APPDATA: 'C:\\Users\\me\\AppData\\Roaming' }, 'win32'), 'C:\\Users\\me\\AppData\\Roaming\\orca\\plugins-data\\audit.log')
  assert.equal(auditLogPath({ APPDATA: '/x' }, 'darwin'), null)
})

test('the watcher fires for requests appended after it starts, including after a rotation', async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'entire-audit-')), 'audit.log')
  await writeFile(path, line({}))
  let requests = 0
  const watcher = watchRefreshRequests(path, ACTOR, () => requests++, { intervalMs: 20 })
  try {
    await sleep(120)
    assert.equal(requests, 0, 'a request from before the worker started is ignored')

    await appendFile(path, line({ summary: 'titleChars=17' }))
    await sleep(120)
    assert.equal(requests, 0)

    // A half-written line waits for its newline.
    const request = line({})
    await appendFile(path, request.slice(0, 20))
    await sleep(120)
    assert.equal(requests, 0)
    await appendFile(path, request.slice(20))
    await sleep(120)
    assert.equal(requests, 1)

    await writeFile(path, line({}))
    await sleep(120)
    assert.equal(requests, 2, 'a rotated log is read from the start')
  } finally {
    watcher.dispose()
  }
})
