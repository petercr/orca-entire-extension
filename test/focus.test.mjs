import test from 'node:test'
import assert from 'node:assert/strict'
import { AUTO_REFRESH_MS, contextKey, createFocusTracker, focusKey, SWITCH_FRESH_MS } from '../src/worker/focus.mjs'

const api = contextKey({ displayName: 'api', branch: 'main', terminals: [{ id: 't2' }, { id: 't1' }] })
const web = contextKey({ displayName: 'web', branch: 'main', terminals: [{ id: 't3' }] })

function tracker() {
  const clock = { now: 0 }
  return { clock, focus: createFocusTracker({ now: () => clock.now }) }
}

test('readContext and a snapshot name the same workspace the same way', () => {
  assert.equal(api, focusKey({ name: 'api', branch: 'main', terminals: ['t1', 't2'] }))
  assert.notEqual(api, contextKey({ displayName: 'api', branch: 'feature', terminals: [{ id: 't1' }, { id: 't2' }] }))
  assert.equal(contextKey(null), null)
})

test('a workspace never read is read as soon as it is focused', () => {
  const { focus } = tracker()
  assert.equal(focus.dueRead(api), 'switch')
  assert.equal(focus.dueRead(api), null)
  assert.equal(focus.dueRead(null), null)
})

test('the focused workspace is read again every few minutes', () => {
  const { clock, focus } = tracker()
  assert.equal(focus.dueRead(api), 'switch')
  assert.equal(focus.dueRead(api), null)
  clock.now = AUTO_REFRESH_MS - 1
  assert.equal(focus.dueRead(api), null)
  clock.now = AUTO_REFRESH_MS
  assert.equal(focus.dueRead(api), 'timer')
  // A due read counts as a read, so a failing lookup isn't retried on every poll.
  assert.equal(focus.dueRead(api), null)
})

test('switching reads a workspace unless the panel shows data for it younger than a minute', () => {
  const { clock, focus } = tracker()
  const shown = { [api]: 0, [web]: 0 }
  const due = (key) => focus.dueRead(key, { shownAt: () => shown[key] ?? null })
  assert.equal(due(web), null)
  clock.now = SWITCH_FRESH_MS - 1
  assert.equal(due(api), null)
  clock.now = SWITCH_FRESH_MS
  assert.equal(due(web), 'switch')
  assert.equal(due(api), 'switch')
})

test("a switch goes by the panel's entry, not the worker's last read", () => {
  const { clock, focus } = tracker()
  // The worker just read this workspace on another branch, whose entry replaced this branch's, or
  // its read found nothing new and kept the panel's older entry.
  focus.markRead(api)
  clock.now = 1000
  assert.equal(focus.dueRead(api, { shownAt: () => null }), 'switch')
  assert.equal(focus.dueRead(web, { shownAt: () => -SWITCH_FRESH_MS }), 'switch')
})

test('the timer counts from the shown entry when a switch skips the read', () => {
  const { clock, focus } = tracker()
  clock.now = 10_000
  assert.equal(focus.dueRead(api, { shownAt: () => 0 }), null)
  clock.now = AUTO_REFRESH_MS - 1
  assert.equal(focus.dueRead(api), null)
  clock.now = AUTO_REFRESH_MS
  assert.equal(focus.dueRead(api), 'timer')
})
