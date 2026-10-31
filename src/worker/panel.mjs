// Host API 1.0 gives a panel no channel to its worker, but Orca rereads a development folder's panel
// file when the folder changes and remounts the panel when the HTML differs. So the worker writes
// each snapshot into the panel file, and the panel picks the entry for the focused workspace.
import { existsSync } from 'node:fs'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { reportLines } from './doctor.mjs'

export const PLUGIN_ROOT = fileURLToPath(new URL('../../', import.meta.url))
export const TEMPLATE = 'panel/template.html'
// Generated and gitignored; orca-plugin.json names it as the panel's entry.
export const PANEL = 'panel/entire.html'

const DATA = /(<script id="entire-data" type="application\/json">)([\s\S]*?)(<\/script>)/
const MAX_WORKSPACES = 10

// Orca hashes an installed copy (plugins\<publisher.id>\<content hash>) and refuses it once a byte
// changes, so the worker writes the panel only in a development folder.
export function isInstalledCopy(root) {
  const dir = root.replace(/[\\/]+$/, '')
  return /^[0-9a-f]{32,64}$/i.test(basename(dir)) && basename(dirname(dirname(dir))).toLowerCase() === 'plugins'
}

export function panelEntry(snapshot) {
  return { ...snapshot, report: reportLines(snapshot) }
}

// Entire's text is untrusted: escaping < > & keeps it from closing the script element it sits in.
export function embedData(data) {
  return JSON.stringify(data).replace(/[<>&]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)
}

export function readData(html) {
  const match = DATA.exec(html)
  try {
    return match ? JSON.parse(match[2]) : null
  } catch {
    return null
  }
}

export function renderPanel(template, data) {
  if (!DATA.test(template)) throw new Error(`${TEMPLATE} has no entire-data script`)
  return template.replace(DATA, (_, open, _old, close) => `${open}${embedData(data)}${close}`)
}

// Same path, or a terminal they share.
function sameWorkspace(entry, other) {
  return (
    (entry.workspace.path && other.workspace.path === entry.workspace.path) ||
    other.workspace.terminals.some((id) => entry.workspace.terminals.includes(id)) ||
    (!other.workspace.path && other.workspace.name === entry.workspace.name && other.workspace.branch === entry.workspace.branch)
  )
}

// A newer entry replaces any for the same workspace.
export function mergeEntry(data, entry) {
  const others = (data?.workspaces ?? []).filter((other) => !sameWorkspace(entry, other))
  return { version: 1, workspaces: [entry, ...others].slice(0, MAX_WORKSPACES) }
}

// Whether the panel already shows this entry's data: only when it was read and how long Entire took differ.
export function shownAlready(data, entry) {
  const shown = (data?.workspaces ?? []).find((other) => sameWorkspace(entry, other))
  const comparable = (e) => JSON.stringify({ ...e, at: undefined, report: undefined, steps: e.steps?.map(({ ms, ...step }) => step) })
  return Boolean(shown) && comparable(shown) === comparable(entry)
}

// Commands, agent events and ↻ each refresh on their own, so updates take turns: two overlapping
// read-merge-writes would each start from the same old panel and one workspace would be lost.
let writes = Promise.resolve()

// Each write remounts the panel, which closes what the user opened and loses their scroll, so timed
// refreshes pass onlyIfChanged. ↻ never does: its spinner stops only when the panel remounts.
export function updatePanel(entry, { root = PLUGIN_ROOT, onlyIfChanged = false } = {}) {
  if (isInstalledCopy(root)) return Promise.resolve('installed copy')
  const update = writes.then(async () => {
    const target = join(root, PANEL)
    const [template, current] = await Promise.all([
      readFile(join(root, TEMPLATE), 'utf8'),
      readFile(target, 'utf8').catch(() => '')
    ])
    const data = readData(current)
    if (onlyIfChanged && shownAlready(data, entry)) return 'unchanged'
    await writeAtomically(target, renderPanel(template, mergeEntry(data, entry)))
    return 'updated'
  })
  writes = update.catch(() => {})
  return update
}

// Orca refuses a plugin whose panel entry is missing, so a fresh clone needs an empty panel first.
export async function ensurePanel(root = PLUGIN_ROOT) {
  const target = join(root, PANEL)
  if (existsSync(target)) return false
  await writeAtomically(target, renderPanel(await readFile(join(root, TEMPLATE), 'utf8'), null))
  return true
}

// Orca may read the panel at any moment; a rename never shows it half written. The temporary name
// carries the process id, so the harness and Orca's worker never share one.
async function writeAtomically(target, text) {
  const temporary = `${target}.${process.pid}.tmp`
  await writeFile(temporary, text)
  await rename(temporary, target)
}
