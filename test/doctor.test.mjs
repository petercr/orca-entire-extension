import test from 'node:test'
import assert from 'node:assert/strict'
import { connectionNotice, reportLines } from '../src/worker/doctor.mjs'

test('a report without failures is a connected notice, without the host API line', () => {
  const notice = connectionNotice(
    ['Orca host API 1.0 · Node v24 on win32', '✓ main on main → C:\\repo (via terminal)', '· Trail: no trail'].join('\n')
  )
  assert.equal(notice.title, 'Entire: connected')
  assert.equal(notice.body, '✓ main on main → C:\\repo (via terminal)\n· Trail: no trail')
})

test('any failed step makes it a problem, and the body fits a notification', () => {
  const notice = connectionNotice(`Orca host API 1.0\n✗ Repo: ${'x'.repeat(2000)}`)
  assert.equal(notice.title, 'Entire: connection problem')
  assert.equal(notice.body.length, 1000)
})

test('each step reports one line: passed with its time, optional misses as notes', () => {
  const lines = reportLines({
    workspace: { name: 'api', branch: 'main', where: 'WSL Ubuntu /home/me/api', via: 'terminal' },
    problem: null,
    steps: [
      { key: 'version', label: 'Entire CLI', ok: true, optional: false, text: '0.12.3', ms: 300 },
      { key: 'trail', label: 'Trail', ok: false, optional: true, text: 'no trail', ms: 400 },
      { key: 'checkpoints', label: 'Checkpoints', ok: false, optional: false, text: 'not logged in', ms: 500 }
    ]
  })
  assert.deepEqual(lines, [
    '✓ api on main → WSL Ubuntu /home/me/api (via terminal)',
    '✓ Entire CLI: 0.12.3 (300 ms)',
    '· Trail: no trail',
    '✗ Checkpoints: not logged in'
  ])
})

test('a workspace that could not be resolved reports only the problem', () => {
  const lines = reportLines({
    workspace: { name: 'main', branch: 'main', path: null },
    problem: 'main on main: 3 workspaces match it. Open a terminal in it and try again.',
    steps: []
  })
  assert.deepEqual(lines, ['✗ main on main: 3 workspaces match it. Open a terminal in it and try again.'])
})
