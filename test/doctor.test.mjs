import test from 'node:test'
import assert from 'node:assert/strict'
import { connectionNotice } from '../src/worker/doctor.mjs'

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
