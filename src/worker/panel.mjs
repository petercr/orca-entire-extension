// What the panel shows: the newest snapshot of each workspace the worker read, kept in the worker's
// memory. The panel asks for it with plugin.request (the handlers are in main.mjs) and gets all of
// it, then picks the focused workspace's entry itself (findEntry in panel/index.html).
import { reportLines } from './doctor.mjs'

const MAX_WORKSPACES = 10
// Orca refuses a plugin.request answer over 1 MiB; leave room for its envelope.
const MAX_ANSWER_CHARS = 900_000

export function panelEntry(snapshot) {
  return { ...snapshot, report: reportLines(snapshot) }
}

// Same path on the same host, or a terminal they share.
function sameWorkspace(entry, other) {
  const environment = (e) => e.workspace.server?.environment ?? null
  return (
    (entry.workspace.path && other.workspace.path === entry.workspace.path && environment(other) === environment(entry)) ||
    other.workspace.terminals.some((id) => entry.workspace.terminals.includes(id)) ||
    (!other.workspace.path && other.workspace.name === entry.workspace.name && other.workspace.branch === entry.workspace.branch)
  )
}

// A newer entry replaces any for the same workspace, and the oldest go once the answer gets too big.
export function mergeEntry(data, entry, { maxChars = MAX_ANSWER_CHARS } = {}) {
  const others = (data?.workspaces ?? []).filter((other) => !sameWorkspace(entry, other))
  const workspaces = [entry, ...others].slice(0, MAX_WORKSPACES)
  while (workspaces.length > 1 && JSON.stringify(workspaces).length > maxChars) workspaces.pop()
  return { version: 1, workspaces }
}

// The entry the panel shows for a readContext result. Keep this the same as findEntry in
// panel/index.html: the worker uses it to tell whether the panel's entry is fresh enough.
export function findShown(data, context) {
  const list = data?.workspaces ?? []
  const ids = context.terminals.map((terminal) => terminal.id)
  // A workspace keeps its terminals when it switches branch, so the branch has to match as well.
  const byTerminal = list.find((entry) => entry.workspace.branch === context.branch && entry.workspace.terminals.some((id) => ids.includes(id)))
  if (byTerminal) return byTerminal
  // Many repos share a name and branch such as main/main: only when terminals can't tell them apart
  // and exactly one entry matches.
  const byName = list.filter(
    (entry) =>
      !(ids.length > 0 && entry.workspace.terminals.length > 0) && entry.workspace.name === context.displayName && entry.workspace.branch === context.branch
  )
  return byName.length === 1 ? byName[0] : null
}

// The panel's data and the reads that fill it. `collect` reads Entire for the focused workspace (a
// snapshot), `readContext` asks Orca which workspace that is. One read runs at a time: a request
// that finds one running waits for it, and reads again only if focus moved meanwhile.
export function createPanelData({ collect, readContext, now = Date.now }) {
  let data = null
  let reading = null

  function add(snapshot) {
    if (snapshot.workspace) data = mergeEntry(data, panelEntry(snapshot))
    return snapshot
  }

  // A read outlives the request that started it, since others may be waiting on it, so it takes no
  // signal; Entire's own timeouts bound it.
  function readNow() {
    reading ??= collect().then(add).finally(() => {
      reading = null
    })
    return reading
  }

  async function shown() {
    const context = await readContext()
    return context ? findShown(data, context) : null
  }

  return {
    get data() {
      return data
    },
    add,
    // Reads Entire unless the panel's entry for the focused workspace is younger than maxAgeMs (0
    // always reads), and answers with all the data.
    async read({ maxAgeMs = 0 } = {}) {
      if (maxAgeMs > 0) {
        const at = Date.parse((await shown())?.at)
        if (Number.isFinite(at) && now() - at < maxAgeMs) return data
      }
      if (reading) {
        const joined = await reading.catch(() => null)
        if (joined && (await shown())?.at === joined.at) return data
      }
      await readNow()
      return data
    },
    // Reads Entire with a read that starts now: one already running may have begun before what the
    // caller wants to see, such as an agent's last checkpoint, so it waits for that one and reads again.
    async readAgain() {
      if (reading) await reading.catch(() => null)
      await readNow()
      return data
    }
  }
}
