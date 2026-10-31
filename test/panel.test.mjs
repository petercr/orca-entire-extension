import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { embedData, ensurePanel, isInstalledCopy, mergeEntry, readData, renderPanel, shownAlready, updatePanel } from '../src/worker/panel.mjs'

const TEMPLATE = '<p>panel</p><script id="entire-data" type="application/json">null</script><script>run()</script>'

const entry = (name, path, terminals = [], at = '2026-10-30T12:00:00Z') => ({
  at,
  workspace: { name, branch: 'main', path, terminals },
  data: {}
})

test('Entire text cannot close the data script', () => {
  const html = renderPanel(TEMPLATE, { message: '</script><script>alert(1)</script> & $& \u2028' })
  assert.equal(html.match(/<\/script>/g).length, 2)
  assert.ok(html.includes('<script>run()</script>'))
  assert.equal(readData(html).message, '</script><script>alert(1)</script> & $& \u2028')
  assert.ok(!embedData({ a: '<>&' }).includes('<'))
})

test('a template without the data script is refused', () => {
  assert.throws(() => renderPanel('<p>no data</p>', null), /entire-data/)
})

test('a broken or missing data block reads as no data', () => {
  assert.equal(readData(''), null)
  assert.equal(readData('<script id="entire-data" type="application/json">{oops</script>'), null)
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

test("Orca's installed copies are recognized, development folders are not", () => {
  const hash = 'a'.repeat(64)
  assert.ok(isInstalledCopy(`C:\\Users\\me\\AppData\\Roaming\\orca\\plugins\\petercr.entire\\${hash}\\`))
  assert.ok(isInstalledCopy(`/home/me/.config/orca/plugins/petercr.entire/${hash.slice(0, 32)}`))
  assert.ok(!isInstalledCopy('C:\\Users\\me\\Web Projects\\orca-entire-extension\\'))
  assert.ok(!isInstalledCopy(`C:\\Users\\me\\plugins\\${hash}`))
})

test('overlapping refreshes both land in the panel', async () => {
  const root = await mkdtemp(join(tmpdir(), 'entire-panel-'))
  await mkdir(join(root, 'panel'))
  await writeFile(join(root, 'panel', 'template.html'), TEMPLATE)
  await Promise.all([updatePanel(entry('api', 'C:\\api', ['t1']), { root }), updatePanel(entry('web', 'C:\\web', ['t2']), { root })])
  const data = readData(await readFile(join(root, 'panel', 'entire.html'), 'utf8'))
  assert.deepEqual(data.workspaces.map((e) => e.workspace.name).sort(), ['api', 'web'])
})

test('the worker fills the panel from the template and keeps other workspaces', async () => {
  const root = await mkdtemp(join(tmpdir(), 'entire-panel-'))
  await mkdir(join(root, 'panel'))
  await writeFile(join(root, 'panel', 'template.html'), TEMPLATE)
  assert.equal(await ensurePanel(root), true)
  assert.equal(await ensurePanel(root), false)
  assert.equal(readData(await readFile(join(root, 'panel', 'entire.html'), 'utf8')), null)

  assert.equal(await updatePanel(entry('api', 'C:\\api', ['t1']), { root }), 'updated')
  await updatePanel(entry('web', 'C:\\web', ['t2']), { root })
  const data = readData(await readFile(join(root, 'panel', 'entire.html'), 'utf8'))
  assert.deepEqual(
    data.workspaces.map((e) => e.workspace.name),
    ['web', 'api']
  )
})

test('a timed refresh that finds nothing new leaves the panel alone', async () => {
  const root = await mkdtemp(join(tmpdir(), 'entire-panel-'))
  await mkdir(join(root, 'panel'))
  await writeFile(join(root, 'panel', 'template.html'), TEMPLATE)
  const read = (at, ms, data = {}) => ({ ...entry('api', 'C:\\api', ['t1'], at), steps: [{ key: 'status', ok: true, ms }], report: [`${ms} ms`], data })
  await updatePanel(read('first', 700), { root })

  assert.equal(await updatePanel(read('second', 900), { root, onlyIfChanged: true }), 'unchanged')
  const html = () => readFile(join(root, 'panel', 'entire.html'), 'utf8')
  assert.equal(readData(await html()).workspaces[0].at, 'first')

  assert.equal(await updatePanel(read('third', 800, { trail: { number: 2 } }), { root, onlyIfChanged: true }), 'updated')
  // ↻ always writes: the panel's spinner stops only when the panel remounts.
  assert.equal(await updatePanel(read('fourth', 800, { trail: { number: 2 } }), { root }), 'updated')
  assert.equal(readData(await html()).workspaces[0].at, 'fourth')
})

test('a workspace the panel has never shown counts as changed', () => {
  assert.equal(shownAlready(null, entry('api', 'C:\\api')), false)
  assert.equal(shownAlready({ workspaces: [entry('web', 'C:\\web')] }, entry('api', 'C:\\api')), false)
})
