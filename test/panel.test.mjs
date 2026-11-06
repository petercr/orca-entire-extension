import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createPanelData, findShown, mergeEntry } from '../src/worker/panel.mjs'

const entry = (name, path, terminals = [], at = '2026-10-30T12:00:00Z') => ({
  at,
  workspace: { name, branch: 'main', path, terminals },
  data: {}
})

test('a newer entry replaces the same workspace and the newest come first', () => {
  let data = null
  data = mergeEntry(data, entry('api', '\\\\wsl.localhost\\Ubuntu\\home\\me\\api', ['t1']))
  data = mergeEntry(data, entry('web', 'C:\\web', ['t2']))
  data = mergeEntry(data, entry('api', '\\\\wsl.localhost\\Ubuntu\\home\\me\\api', ['t3'], 'later'))
  assert.deepEqual(
    data.workspaces.map((e) => [e.workspace.name, e.at]),
    [
      ['api', 'later'],
      ['web', '2026-10-30T12:00:00Z']
    ]
  )
  // Same terminal, path still unknown: the same workspace.
  data = mergeEntry(data, entry('web', null, ['t2'], 'newest'))
  assert.deepEqual(
    data.workspaces.map((e) => e.at),
    ['newest', 'later']
  )
})

test('the panel keeps at most 10 workspaces', () => {
  let data = null
  for (let i = 0; i < 12; i++) data = mergeEntry(data, entry(`w${i}`, `C:\\w${i}`))
  assert.equal(data.workspaces.length, 10)
  assert.equal(data.workspaces[0].workspace.name, 'w11')
})

test("the oldest workspaces go when the answer would pass Orca's limit, never the newest", () => {
  const big = (name) => ({ ...entry(name, `C:\\${name}`), data: { text: 'x'.repeat(400) } })
  let data = null
  for (const name of ['a', 'b', 'c']) data = mergeEntry(data, big(name), { maxChars: 1200 })
  assert.deepEqual(
    data.workspaces.map((e) => e.workspace.name),
    ['c', 'b']
  )
  assert.equal(mergeEntry(null, { ...big('huge'), data: { text: 'x'.repeat(5000) } }, { maxChars: 1000 }).workspaces.length, 1)
})

// A fake worker side: collect resolves when the test says so, readContext answers the focused workspace.
function harness(context) {
  const reads = []
  let clock = Date.parse('2026-11-05T12:00:00Z')
  const panel = createPanelData({
    collect: () =>
      new Promise((resolve) => {
        const at = new Date(clock).toISOString()
        const focused = context()
        reads.push(() => resolve({ ...entry(focused.displayName, `C:\\${focused.displayName}`, focused.terminals.map((t) => t.id), at), steps: [] }))
      }),
    readContext: async () => context(),
    now: () => clock
  })
  return { panel, reads, tick: (ms) => (clock += ms), finish: () => reads.shift()() }
}

const focusOn = (name) => ({ displayName: name, branch: 'main', terminals: [{ id: `t-${name}` }] })
const settle = () => new Promise((resolve) => setImmediate(resolve))

test("a request reads Entire only when the focused workspace's entry is older than it allows", async () => {
  const { panel, reads, tick, finish } = harness(() => focusOn('api'))
  const first = panel.read({ maxAgeMs: 60_000 })
  await settle()
  assert.equal(reads.length, 1)
  finish()
  assert.equal((await first).workspaces[0].workspace.name, 'api')

  tick(30_000)
  await panel.read({ maxAgeMs: 60_000 })
  assert.equal(reads.length, 0, 'fresh enough: no read')

  tick(40_000)
  const stale = panel.read({ maxAgeMs: 60_000 })
  await settle()
  assert.equal(reads.length, 1, 'over a minute old: a read')
  finish()
  await stale

  const always = panel.read({ maxAgeMs: 0 })
  await settle()
  assert.equal(reads.length, 1, '↻ always reads')
  finish()
  await always
})

test('requests that arrive during a read share it, unless focus moved meanwhile', async () => {
  let focused = focusOn('api')
  const { panel, reads, finish } = harness(() => focused)
  const first = panel.read()
  const second = panel.read()
  await settle()
  assert.equal(reads.length, 1)
  finish()
  await Promise.all([first, second])
  assert.equal(reads.length, 0)

  const before = panel.read()
  await settle()
  focused = focusOn('web')
  const after = panel.read()
  finish()
  await before
  await settle()
  assert.equal(reads.length, 1, 'the read was of the old workspace, so the later request reads again')
  finish()
  const data = await after
  assert.deepEqual(
    data.workspaces.map((e) => e.workspace.name),
    ['web', 'api']
  )
})

test('a snapshot a command read joins the data', () => {
  const { panel } = harness(() => focusOn('api'))
  assert.equal(panel.data, null)
  panel.add({ ...entry('api', 'C:\\api', ['t1']), steps: [] })
  panel.add({ workspace: null, steps: [] })
  assert.equal(panel.data.workspaces.length, 1)
  assert.deepEqual(panel.data.workspaces[0].report, [])
})

// The panel's own functions, pulled out of its script, so the tests run what it runs.
const panelHtml = await readFile(new URL('../panel/index.html', import.meta.url), 'utf8')
const panelFunction = (name) => new RegExp(`^ {8}function ${name}\\([^)]*\\) \\{[\\s\\S]*?^ {8}\\}$`, 'm').exec(panelHtml)[0]

// findEntry reads the panel's DATA, so give it one.
const findEntry = (data, context) => new Function('DATA', 'context', `${panelFunction('findEntry')}\nreturn findEntry(context)`)(data, context)

test('the worker finds the entry the panel shows', () => {
  const branch = (e, b) => ({ ...e, workspace: { ...e.workspace, branch: b } })
  const data = {
    workspaces: [
      branch(entry('api', 'C:\api', ['t1'], 'b'), 'feature'),
      entry('web', 'C:\web', ['t2']),
      entry('cli', null, []),
      entry('docs', null, []),
      entry('docs', null, [])
    ]
  }
  const context = (displayName, branchName, terminals) => ({ displayName, branch: branchName, terminals: terminals.map((id) => ({ id })) })
  const cases = [
    context('api', 'feature', ['t1']),
    // The same terminal on the branch it left: not that entry.
    context('api', 'main', ['t1']),
    context('web', 'main', ['t9', 't2']),
    context('cli', 'main', []),
    context('cli', 'main', ['t5']),
    // Two entries share docs/main, so neither is shown.
    context('docs', 'main', [])
  ]
  for (const c of cases) assert.equal(findShown(data, c), findEntry(data, c), JSON.stringify(c))
  assert.deepEqual(
    cases.map((c) => findShown(data, c)?.workspace.name ?? null),
    ['api', null, 'web', 'cli', 'cli', null]
  )
})

test("a paired server's workspace is told apart by its server, not by its path alone", () => {
  const onServer = (environment, at) => ({ ...entry('leadgen', '/home/ubuntu/leadgen', [], at), workspace: { name: 'leadgen', branch: '', path: '/home/ubuntu/leadgen', terminals: [], server: { environment, branch: 'main' } } })
  let data = mergeEntry(null, onServer('VPS one', 'first'))
  data = mergeEntry(data, onServer('VPS two', 'second'))
  assert.deepEqual(data.workspaces.map((e) => e.at), ['second', 'first'])
  data = mergeEntry(data, onServer('VPS one', 'third'))
  assert.deepEqual(data.workspaces.map((e) => e.at), ['third', 'second'])
  // readContext names it by its repo with no branch, which is how the panel finds it.
  assert.equal(findShown({ workspaces: [data.workspaces[0]] }, { displayName: 'leadgen', branch: '', terminals: [] }).at, 'third')
})

// The panel's own text for the copy buttons, built from the functions it uses.
const findingsText = new Function(`${['words', 'sentence', 'findingWhere', 'findingText', 'findingsText'].map(panelFunction).join('\n')}\nreturn findingsText`)()

test('a copied finding carries its severity, place, status, text and reason', () => {
  const open = { severity: 'high', title: 'Null deref', file: 'src/a.mjs', line: 4, endLine: 9, body: 'x can be null here.' }
  const dismissed = { severity: 'low', title: 'Naming', status: 'dismissed', stale: true, body: 'Naming', reason: 'Matches the API.' }
  assert.equal(findingsText([open]), '[HIGH] Null deref\nsrc/a.mjs:4–9\n\nx can be null here.')
  assert.equal(
    findingsText([open, dismissed]),
    '[HIGH] Null deref\nsrc/a.mjs:4–9\n\nx can be null here.\n\n---\n\n[LOW] Naming\nStatus: Dismissed, found on an earlier version of the code\n\nDismissed: Matches the API.'
  )
  assert.equal(findingsText([{}]), 'Finding')
})

test("the panel's script parses and asks only for the worker handlers that exist", () => {
  const scripts = [...panelHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1])
  assert.equal(scripts.length, 1)
  assert.doesNotThrow(() => new Function(scripts[0]))
  const asked = [...scripts[0].matchAll(/orca\.plugin\s*\.request\('([^']+)'/g)].map((m) => m[1]).sort()
  assert.deepEqual(asked, ['entire.data', 'entire.read'])
})
