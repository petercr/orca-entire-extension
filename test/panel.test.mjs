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

test('a read after an agent finishes starts after it, not joining one already running', async () => {
  const { panel, reads, finish } = harness(() => focusOn('api'))
  const early = panel.read()
  await settle()
  const after = panel.readAgain()
  await settle()
  assert.equal(reads.length, 1, 'waits for the running read')
  finish()
  await early
  await settle()
  assert.equal(reads.length, 1, 'then reads again')
  finish()
  await after
})

test("a read that couldn't find the workspace fails, rather than answering with the old data", async () => {
  const panel = createPanelData({
    collect: async () => ({ at: '2026-11-06T12:00:00Z', workspace: null, problem: 'Workspace lookup failed: boom', steps: [], data: {} }),
    readContext: async () => focusOn('api')
  })
  await assert.rejects(panel.read({ maxAgeMs: 60_000 }), /Workspace lookup failed: boom/)
  await assert.rejects(panel.readAgain(), /Workspace lookup failed: boom/)
  assert.equal(panel.data, null)
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

test("Orca's workspaceId tells apart workspaces that share main/main", () => {
  const withId = (id, at) => ({ ...entry('main', null, [], at), workspace: { id, name: 'main', branch: 'main', path: `/${at}`, terminals: [] } })
  // A local worktree has an identity id, which panels get too; a paired server's is its worktree id,
  // which Orca gives workers only.
  const local = withId('identity:wt2:local:aaa', 'local')
  const other = withId('identity:wt2:local:bbb', 'other')
  const vps = withId('d735::/home/ubuntu/leadgen', 'vps')
  let data = mergeEntry(null, local)
  data = mergeEntry(data, other)
  data = mergeEntry(data, vps)
  assert.equal(data.workspaces.length, 3)
  data = mergeEntry(data, withId('identity:wt2:local:aaa', 'local again'))
  assert.deepEqual(data.workspaces.map((e) => e.at), ['local again', 'vps', 'other'])

  const context = (workspaceId) => ({ ...(workspaceId ? { workspaceId } : {}), displayName: 'main', branch: 'main', terminals: [] })
  const cases = [context('identity:wt2:local:aaa'), context('identity:wt2:local:bbb'), context('d735::/home/ubuntu/leadgen'), context(null)]
  assert.deepEqual(cases.map((c) => findShown(data, c)?.at ?? null), ['local again', 'other', 'vps', 'vps'])
  // The panel's context for the VPS workspace has no id; the identity entries aren't its.
  assert.deepEqual(cases.map((c) => findEntry(data, c)?.at ?? null), ['local again', 'other', 'vps', 'vps'])

  // A local main/main that has no entry yet is none of these, though the VPS entry shares its name.
  const uncached = context('identity:wt2:local:ccc')
  assert.equal(findShown(data, uncached), null)
  assert.equal(findEntry(data, uncached), null)
  // An entry read before Orca gave ids can still be found by name.
  const old = { workspaces: [entry('main', null, [], 'old')].map((e) => ({ ...e, workspace: { ...e.workspace, branch: 'main' } })) }
  assert.equal(findShown(old, uncached)?.at, 'old')
  assert.equal(findEntry(old, uncached)?.at, 'old')
})

test('a workspace keeps its id across a branch checkout, but not its entry', () => {
  const onBranch = (branch, at) => ({ ...entry('api', null, ['t1'], at), workspace: { id: 'identity:wt2:local:aaa', name: 'api', branch, path: 'C:\\api', terminals: ['t1'] } })
  const data = { workspaces: [onBranch('main', 'main read')] }
  const context = (branch) => ({ workspaceId: 'identity:wt2:local:aaa', displayName: 'api', branch, terminals: [{ id: 't1' }] })
  for (const c of [context('main'), context('feature')]) assert.equal(findShown(data, c), findEntry(data, c), JSON.stringify(c))
  assert.equal(findShown(data, context('main'))?.at, 'main read')
  assert.equal(findShown(data, context('feature')), null)
})

// The panel's own asking, run against a fake orca and clock. show(context) is what each render does.
function panelAsks() {
  let clock = Date.parse('2026-11-05T12:00:00Z')
  const requests = []
  const orca = {
    plugin: { request: (name, input) => new Promise((resolve, reject) => requests.push({ name, input, resolve, reject })) },
    host: { has: () => true }
  }
  const panel = new Function(
    'orca',
    'Date',
    'rerender',
    `var DATA = null, reads = 0, refreshing = false, readError = null, focusedKey = null, asked = { key: null, at: 0 }
    var SWITCH_FRESH_MS = 60000, AUTO_REFRESH_MS = 5 * 60000, READ_TIMEOUT_MS = 100000
    ${['ask', 'fetchData', 'noteFocus', 'findEntry'].map(panelFunction).join('\n')}
    return {
      show: function (context) { noteFocus(context, findEntry(context)) },
      fetchData: fetchData,
      readError: function () { return readError }
    }`
  )(orca, { now: () => clock, parse: Date.parse }, () => {})
  const at = () => new Date(clock).toISOString()
  return { panel, requests, at, tick: (ms) => (clock += ms) }
}

const onBranch = (branch) => ({ displayName: 'app', branch, terminals: [{ id: 't1' }] })
const entryOn = (branch, at) => ({ at, workspace: { name: 'app', branch, path: 'C:\\app', terminals: ['t1'] }, data: {} })

test("the panel asks again when a read of the checkout's other branch replaced the focused branch's entry", async () => {
  const { panel, requests, at, tick } = panelAsks()
  panel.show(onBranch('a'))
  requests.shift().resolve({ workspaces: [entryOn('a', at())] })
  await settle()
  panel.show(onBranch('b'))
  const readOfB = requests.shift()
  tick(10_000)
  panel.show(onBranch('a'))
  assert.equal(requests.length, 0, "a's entry is fresh: no request")
  // b's read lands and, sharing the path, replaces a's entry.
  readOfB.resolve({ workspaces: [entryOn('b', at())] })
  await settle()
  panel.show(onBranch('a'))
  assert.equal(requests.length, 1, 'a asks again')
  // Still nothing for a after asking: no request on every render, but again in 5 minutes.
  requests.shift().resolve({ workspaces: [entryOn('b', at())] })
  await settle()
  panel.show(onBranch('a'))
  assert.equal(requests.length, 0)
  tick(5 * 60_000)
  panel.show(onBranch('a'))
  assert.equal(requests.length, 1)
})

test('the panel retries a failed read after 5 minutes, and data the worker posts clears the failure', async () => {
  const { panel, requests, at, tick } = panelAsks()
  panel.show(onBranch('a'))
  requests.shift().resolve({ workspaces: [entryOn('a', at())] })
  await settle()
  tick(5 * 60_000)
  panel.show(onBranch('a'))
  requests.shift().reject({ code: 'timeout', message: 'slow' })
  await settle()
  panel.show(onBranch('a'))
  assert.equal(requests.length, 0, 'not straight away')
  tick(5 * 60_000)
  panel.show(onBranch('a'))
  assert.equal(requests.length, 1, 'retried')
  requests.shift().reject({ code: 'timeout', message: 'slow' })
  await settle()
  assert.equal(panel.readError().code, 'timeout')
  panel.fetchData()
  requests.shift().resolve({ workspaces: [entryOn('a', at())] })
  await settle()
  assert.equal(panel.readError(), null)
})

test('with nothing to show, the panel retries a failed first read after 5 minutes', async () => {
  const { panel, requests, tick } = panelAsks()
  panel.show(onBranch('a'))
  requests.shift().reject({ code: 'handler_error', message: 'Workspace lookup failed: boom' })
  await settle()
  panel.show(onBranch('a'))
  assert.equal(requests.length, 0, 'not straight away')
  tick(5 * 60_000)
  panel.show(onBranch('a'))
  assert.equal(requests.length, 1, 'retried')
  // An answer without the workspace, then data the worker posts, clear the error but not the retry.
  requests.shift().resolve(null)
  await settle()
  panel.fetchData()
  requests.shift().resolve(null)
  await settle()
  assert.equal(panel.readError(), null)
  panel.show(onBranch('a'))
  assert.equal(requests.length, 0)
  tick(5 * 60_000)
  panel.show(onBranch('a'))
  assert.equal(requests.length, 1, 'retried again')
})

// The panel's choice of trail, with its `picked` state.
const trailPicking = (picked) =>
  new Function(
    'picked',
    `${['workspaceOf', 'trailId', 'trailsOf', 'pickedTrail'].map(panelFunction).join('\n')}\nreturn { pickedTrail: pickedTrail, trailsOf: trailsOf }`
  )(picked)

test("the panel shows the focused branch's trail unless another listed one was picked in that workspace", () => {
  const here = { number: 7, branch: 'feature', here: true }
  const other = { number: 9, branch: 'other' }
  const withTrails = (trails, path = 'C:\\app') => ({ workspace: { path, terminals: [] }, data: { trail: trails[0] && trails[0].here ? trails[0] : null, trails } })
  const picked = {}
  const panel = trailPicking(picked)
  assert.equal(panel.pickedTrail(withTrails([here, other])), here)
  picked[JSON.stringify({ path: 'C:\\app', environment: null })] = '9:other'
  assert.equal(panel.pickedTrail(withTrails([here, other])), other)
  // Another workspace keeps its own choice; a pick the worker no longer lists falls back.
  assert.equal(panel.pickedTrail(withTrails([here, other], 'C:\\elsewhere')), here)
  assert.equal(panel.pickedTrail(withTrails([here])), here)
  // No trail on the focused branch: nothing shows until one is picked.
  delete picked[JSON.stringify({ path: 'C:\\app', environment: null })]
  assert.equal(panel.pickedTrail(withTrails([other])), null)
  picked[JSON.stringify({ path: 'C:\\app', environment: null })] = '9:other'
  assert.equal(panel.pickedTrail(withTrails([other])), other)
  // Data from a worker without the list still shows the branch's trail.
  assert.deepEqual(panel.trailsOf({ workspace: { path: 'C:\\app' }, data: { trail: here } }), [here])
  assert.deepEqual(panel.trailsOf({ workspace: { path: 'C:\\app' }, data: {} }), [])
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

test("the panel's script parses and asks only for the worker handlers that exist", async () => {
  const scripts = [...panelHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1])
  assert.equal(scripts.length, 1)
  assert.doesNotThrow(() => new Function(scripts[0]))
  const asked = [...new Set([...scripts[0].matchAll(/orca\.plugin\s*\.request\('([^']+)'/g)].map((m) => m[1]))].sort()
  assert.deepEqual(asked, ['entire.act', 'entire.data', 'entire.read'])
  const main = await readFile(new URL('../src/worker/main.mjs', import.meta.url), 'utf8')
  const handled = [...main.matchAll(/orca\.panels\?\.handle\('([^']+)'/g)].map((m) => m[1]).sort()
  assert.deepEqual(handled, asked)
})

test("the panel's plugin version is the manifest's", async () => {
  const manifest = JSON.parse(await readFile(new URL('../orca-plugin.json', import.meta.url), 'utf8'))
  assert.equal(/var PLUGIN_VERSION = '([^']*)'/.exec(panelHtml)[1], manifest.version)
})

// issueUrl and what it calls, with the panel's globals.
const issueUrl = (entry, platform = 'Win32') =>
  new Function(
    'orca',
    'navigator',
    'entry',
    `var PLUGIN_VERSION = '9.9.9'\nvar NEW_ISSUE_URL = 'https://github.com/o/r/issues/new'\n${panelFunction('step')}\n${panelFunction('platformName')}\n${panelFunction('issueUrl')}\nreturn issueUrl(entry)`
  )({ api: { major: 1, minor: 4 } }, { platform }, entry)

const environment = (url) => {
  const parsed = new URL(url)
  assert.equal(parsed.origin + parsed.pathname, 'https://github.com/o/r/issues/new')
  assert.equal(parsed.searchParams.get('template'), 'bug_report.yml')
  return parsed.searchParams.get('environment').split('\n')
}

test('a problem report names versions and the kind of workspace, never its path', () => {
  const wsl = {
    ...entry('api', '\\\\wsl.localhost\\Ubuntu\\home\\me\\secret-repo', ['t1']),
    workspace: { name: 'secret-repo', branch: 'main', path: '\\\\wsl.localhost\\Ubuntu\\home\\me\\secret-repo', where: 'WSL Ubuntu /home/me/secret-repo', terminals: ['t1'] },
    steps: [{ key: 'version', ok: true, text: 'Entire CLI 1.2.3' }]
  }
  const url = issueUrl(wsl)
  assert.deepEqual(environment(url), ['Entire for Orca: 9.9.9', 'Orca host API: 1.4', 'OS: Windows', 'Entire CLI: 1.2.3','Workspace: in WSL'])
  assert.doesNotMatch(decodeURIComponent(url), /secret-repo|home|main/)

  const server = { ...wsl, workspace: { ...wsl.workspace, where: null, server: { environment: 'vps' } }, steps: [{ key: 'version', ok: false, text: 'not found' }] }
  assert.deepEqual(environment(issueUrl(server, 'MacIntel')), ['Entire for Orca: 9.9.9', 'Orca host API: 1.4', 'OS: macOS', 'Workspace: on a paired Orca server'])
  assert.deepEqual(environment(issueUrl(null, 'Linux x86_64')), ['Entire for Orca: 9.9.9', 'Orca host API: 1.4', 'OS: Linux'])
})
