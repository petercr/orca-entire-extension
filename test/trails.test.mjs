import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { collectTrails, openChanges, repoRef, TRAIL_LIMIT } from '../src/worker/trails.mjs'

const fixture = async (name) => JSON.parse(await readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'))

test('a clone URL names its Entire project and repository', () => {
  const gh = { forge: 'gh', project: 'gh/petercr', name: 'orca-entire-extension' }
  for (const url of [
    'https://github.com/petercr/orca-entire-extension.git',
    'https://github.com/petercr/orca-entire-extension',
    'git@github.com:petercr/orca-entire-extension.git',
    'ssh://git@github.com/petercr/orca-entire-extension.git',
    ' https://www.github.com/petercr/orca-entire-extension/ '
  ]) {
    assert.deepEqual(repoRef(url), gh, url)
  }
  assert.deepEqual(repoRef('entire://aws-us-east-2.entire.io/et/entire-repos/orca-entire-extension'), { forge: 'et', project: 'et/entire-repos', name: 'orca-entire-extension' })
  for (const bad of ['https://gitlab.com/a/b.git', 'https://github.com/petercr', 'entire://cell/gh/a/b', '', null, undefined, '-oProxyCommand=x']) assert.equal(repoRef(bad), null, String(bad))
})

// A trail with changes in two repositories, two of them open here, one on the focused branch.
const trail = {
  number: 500,
  title: 'Two branches',
  status: 'open',
  changes: [
    { repository: 'app', branch: 'feature-a', number: 1, status: 'open', mergeability: { mergeable: true, gates: [] } },
    { repository: 'app', branch: 'feature-b', number: 2, status: 'open', mergeability: { mergeable: false, gates: [] } },
    { repository: 'app', branch: 'old', number: 3, status: 'merged' },
    { repository: 'other', branch: 'feature-a', number: 9, status: 'open' }
  ]
}

test("a trail's open changes in this repository, except the focused branch's", () => {
  assert.deepEqual(
    openChanges(trail, 'app', 'feature-a').map((change) => change.number),
    [2]
  )
  assert.deepEqual(
    openChanges(trail, 'APP').map((change) => change.number),
    [1, 2]
  )
  // A change may name its repository as owner/name.
  assert.deepEqual(openChanges({ changes: [{ repository: 'acme/app', branch: 'x', status: 'open' }] }, 'app').length, 1)
  assert.deepEqual(openChanges({ changes: [{ repository: 'myapp', branch: 'x', status: 'open' }] }, 'app').length, 0)
  // The change Entire reached the trail through is the focused branch's, whatever Orca calls the branch.
  assert.deepEqual(openChanges({ changes: [{ repository: 'app', branch: 'x', status: 'open', current: true }] }, 'app').length, 0)
  assert.deepEqual(openChanges(null, 'app'), [])
})

// A fake Entire: `trail list` answers the items, `trail show <n>` the trail of that number, findings
// an empty list naming the base.
function fakeEntire({ items, trails, fail = [] }) {
  const calls = []
  const run = async (host, args) => {
    calls.push(args)
    const json = (value) => ({ code: 0, stdout: JSON.stringify(value), stderr: '' })
    if (args[1] === 'list') return json({ items })
    if (args[1] === 'show') {
      const number = Number(args[2])
      if (fail.includes(number)) return { code: 1, stdout: '', stderr: 'repository not found' }
      return json(trails.find((t) => t.number === number))
    }
    if (args[1] === 'finding') return json({ trail: { base: 'main' }, counts: { Open: 0 }, findings: [] })
    throw new Error(`unexpected ${args.join(' ')}`)
  }
  return { calls, run }
}

const origin = 'https://github.com/acme/app.git'
const local = { kind: 'local', path: 'C:\\app' }

test('the other open changes of the repository come summarized, newest trail first, each with its gates and findings', async () => {
  const older = { number: 400, title: 'Older', status: 'open', changes: [{ repository: 'app', branch: 'fix', number: 7, status: 'open', mergeability: { mergeable: false, gates: [{ gate_type: 'approvals', gate_key: 'approvals', blocking: true, status: 'failed', state: 'evaluated', value: { approved: 0, required: 1 } }] } }] }
  const { calls, run } = fakeEntire({ items: [{ number: 500 }, { number: 400 }], trails: [trail, older] })
  const diffs = []
  const diff = async (host, base, { head }) => (diffs.push([base, head]), { files: 1, additions: 2, deletions: 3 })
  const { step, trails } = await collectTrails(local, { origin, current: trail, branch: 'feature-a', checkout: local, run, diff })
  assert.equal(step.ok, true)
  assert.equal(step.text, '2 other open changes in this repository')
  assert.deepEqual(
    trails.map(({ number, branch, change, open, here }) => [number, branch, change, open, here]),
    [
      [500, 'feature-b', 2, true, undefined],
      [400, 'fix', 7, true, undefined]
    ]
  )
  assert.deepEqual(trails[1].blockers, ['Not approved yet (0 of 1)'])
  assert.deepEqual(trails[0].diff, { files: 1, additions: 2, deletions: 3 })
  assert.deepEqual(diffs, [
    ['main', 'feature-b'],
    ['main', 'fix']
  ])
  // The focused branch's trail was shown already, so only the other one is shown again.
  assert.deepEqual(calls[0].slice(0, 7), ['trail', 'list', '--project', 'gh/acme', '--repo', origin, '--status'])
  assert.deepEqual(
    calls.filter((args) => args[1] === 'show').map((args) => args[2]),
    ['400']
  )
  assert.deepEqual(
    calls.filter((args) => args[1] === 'finding').map((args) => [args[4], args[6]]),
    [
      ['500', 'feature-b'],
      ['400', 'fix']
    ]
  )
})

test("a paired server's workspace names its repository to show and finding list, and gets no line counts", async () => {
  const { calls, run } = fakeEntire({ items: [{ number: 500 }], trails: [trail] })
  const server = { kind: 'server', repo: origin, branch: 'feature-a' }
  const { trails } = await collectTrails(server, { origin, branch: 'feature-a', checkout: null, run })
  assert.deepEqual(
    trails.map((t) => t.branch),
    ['feature-b']
  )
  assert.deepEqual(calls[1].slice(0, 5), ['trail', 'show', '500', '--repo', origin])
  assert.ok(calls[2].includes('--repo'))
  assert.equal(trails[0].diff, null)
})

test('without an origin the step says so, and a failed listing or show is reported without hiding the rest', async () => {
  const none = await collectTrails(local, { origin: null, run: async () => assert.fail('no call') })
  assert.equal(none.step.ok, false)
  assert.match(none.step.text, /no origin remote/)
  const strange = await collectTrails(local, { origin: 'https://gitlab.com/a/b.git', run: async () => assert.fail('no call') })
  assert.match(strange.step.text, /can't tell the Entire project/)

  const refused = await collectTrails(local, { origin, run: async () => ({ code: 1, stdout: '', stderr: 'not logged in' }) })
  assert.deepEqual([refused.step.ok, refused.step.text, refused.trails], [false, 'not logged in', []])

  const { run } = fakeEntire({ items: [{ number: 500 }, { number: 401 }], trails: [trail], fail: [401] })
  const partly = await collectTrails(local, { origin, run })
  assert.equal(partly.step.text, "2 other open changes in this repository (1 couldn't be read)")
  assert.equal(partly.trails.length, 2)
})

test('only the newest trails are shown when the repository has many open', async () => {
  const items = Array.from({ length: TRAIL_LIMIT + 5 }, (_, i) => ({ number: 900 - i }))
  const trails = items.map(({ number }) => ({ number, changes: [{ repository: 'app', branch: `b${number}`, status: number % 2 ? 'open' : 'merged' }] }))
  const { calls, run } = fakeEntire({ items, trails })
  const { step, trails: shown } = await collectTrails(local, { origin, run })
  assert.equal(calls.filter((args) => args[1] === 'show').length, TRAIL_LIMIT)
  assert.equal(shown.length, TRAIL_LIMIT / 2)
  assert.equal(step.text, `${TRAIL_LIMIT / 2} other open changes in this repository (the newest ${TRAIL_LIMIT} of ${TRAIL_LIMIT + 5} open trails checked)`)
})

test('past its deadline the read stops starting calls and says what it left, and each call gets only the time left', async () => {
  // A clock that each call advances by a second: the list ends at 1 s, the second show starts at 2 s,
  // and the deadline has passed before any other can.
  let clock = 0
  const items = Array.from({ length: 6 }, (_, i) => ({ number: 600 - i }))
  const { calls, run } = fakeEntire({ items, trails: items.map(({ number }) => ({ number, changes: [] })) })
  const timeouts = []
  const timed = async (host, args, options) => {
    timeouts.push(options.timeoutMs)
    clock += 1000
    return run(host, args, options)
  }
  const { step, trails } = await collectTrails(local, { origin, deadline: 2500, run: timed, now: () => clock })
  assert.equal(calls.filter((args) => args[1] === 'show').length, 2)
  assert.equal(step.ok, true)
  assert.equal(step.text, 'no other open changes in this repository (4 trails not checked in time)')
  assert.deepEqual(trails, [])
  // Each call got the time left plus the grace.
  assert.deepEqual(timeouts, [5500, 4500, 3500])

  // Out of time before it starts, it says so and calls nothing.
  const none = await collectTrails(local, { origin, deadline: 0, run: async () => assert.fail('no call'), now: () => 1 })
  assert.deepEqual([none.step.ok, none.step.text], [false, 'not checked: the read was out of time'])

  // A change whose findings there was no time for still shows, without them.
  clock = 0
  const one = fakeEntire({ items: [{ number: 500 }], trails: [trail] })
  const slow = async (host, args, options) => ((clock += 1000), one.run(host, args, options))
  const late = await collectTrails(local, { origin, branch: 'feature-a', deadline: 1500, run: slow, now: () => clock })
  assert.equal(late.step.text, '1 other open change in this repository (the findings of 1 change not read in time)')
  assert.deepEqual([late.trails[0].branch, late.trails[0].findings], ['feature-b', null])

  // Without a deadline nothing is cut short and the calls keep Entire's usual timeout.
  const open = fakeEntire({ items: [{ number: 500 }], trails: [trail] })
  const seen = []
  await collectTrails(local, { origin, run: async (host, args, options) => (seen.push(options.timeoutMs), open.run(host, args, options)) })
  assert.deepEqual(seen, [undefined, undefined, undefined, undefined])
})

test("the focused branch's trail is reused as Entire gave it, even as a promise of it", async () => {
  const current = await fixture('trail-367-show.json')
  const { calls, run } = fakeEntire({ items: [{ number: 367 }], trails: [] })
  const { step, trails } = await collectTrails(local, { origin: 'https://github.com/petercr/endo.chat_backend.git', current: Promise.resolve(current), branch: current.changes[0].branch, run })
  assert.equal(step.text, 'no other open changes in this repository')
  assert.deepEqual(trails, [])
  assert.equal(calls.length, 1)
})

test("the focused branch's trail is reused as Entire gave it", async () => {
  const current = await fixture('trail-367-show.json')
  const { calls, run } = fakeEntire({ items: [{ number: 367 }], trails: [] })
  const { step, trails } = await collectTrails(local, { origin: 'https://github.com/petercr/endo.chat_backend.git', current, branch: current.changes[0].branch, run })
  assert.equal(step.text, 'no other open changes in this repository')
  assert.deepEqual(trails, [])
  assert.equal(calls.length, 1)
})
