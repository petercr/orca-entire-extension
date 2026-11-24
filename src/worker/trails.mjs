// Every open change of the focused workspace's repository on Entire, not only the checked-out branch's:
// a repo with several trails or pull requests in flight shows each, and the panel lets the user pick
// one. Entire lists trails by project only (`trail list --project`), without their changes, so the
// worker shows each listed trail and keeps the changes that are open in this repository.
import { failureLine, runEntire } from './entire-cli.mjs'
import { diffStat } from './git.mjs'
import { trailSummary } from './trail.mjs'

// The newest open trails of the repository the worker shows; the step says when there were more.
export const TRAIL_LIMIT = 10
const LIST_LIMIT = 50
// Entire calls in flight at once: each is a process and a request to Entire's server.
const CONCURRENCY = 4
// A call started just before the deadline may finish this much later.
const GRACE_MS = 3000

// Entire's project reference (gh/<owner> or et/<project>) and the repository's name, from a clone URL.
// GitHub remotes come as https, ssh or scp-like URLs; an Entire-hosted repo as entire://<cell>/et/<project>/<name>.
export function repoRef(url) {
  if (typeof url !== 'string') return null
  const text = url.trim()
  const github = /^(?:(?:https?|ssh|git):\/\/)?(?:[\w.-]+@)?(?:www\.)?github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(text)
  if (github) return { forge: 'gh', project: `gh/${github[1]}`, name: github[2] }
  const entire = /^entire:\/\/[^/]+\/et\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(text)
  if (entire) return { forge: 'et', project: `et/${entire[1]}`, name: entire[2] }
  return null
}

// A clone URL may carry a token before its host (https://x-access-token:ghp_…@github.com/o/r.git, or
// user:token@host:path), which must reach no message, log or notification.
export function withoutCredentials(url) {
  return String(url).replace(/^((?:[a-z][\w+.-]*:\/\/)?)[^/@]*@/i, '$1')
}

// A change's repository is its name, or owner/name; compare by the name.
function sameRepository(repository, name) {
  const value = String(repository ?? '').toLowerCase()
  return value === name.toLowerCase() || value.endsWith(`/${name.toLowerCase()}`)
}

// The trail's changes that are open in this repository, except the focused branch's, which the snapshot
// already shows in full: the one Entire marked current (reached through the checkout) or on `exceptBranch`.
export function openChanges(trail, name, exceptBranch = null) {
  const changes = Array.isArray(trail?.changes) ? trail.changes : []
  return changes.filter((change) => change.status === 'open' && sameRepository(change.repository, name) && !change.current && change.branch !== exceptBranch)
}

// Runs `task` over `items`, at most CONCURRENCY at a time, keeping the order, and stops starting new
// ones once `late()` says the time is up: { results, skipped }, with null for each item not run.
async function pooled(items, task, late) {
  const results = new Array(items.length).fill(null)
  let next = 0
  let skipped = 0
  const worker = async () => {
    while (next < items.length) {
      const index = next++
      if (late()) {
        skipped++
        continue
      }
      results[index] = await task(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker))
  return { results, skipped }
}

// A paired server's workspace names its repository; a checkout's Entire finds it from origin.
function repoArgs(host) {
  return host.kind === 'server' ? ['--repo', host.repo] : []
}

// Reads the other open changes of the repository: { step, trails }, where each trail is a trailSummary
// of one open change, newest first. `origin` is the workspace's origin URL, `current` the raw
// `trail show` of the focused branch's trail (or a promise of it; reused rather than shown again),
// `branch` the focused branch, and `checkout` where git runs for the line counts (null when it can't).
// Past `deadline` (a Date.now() time) no new call starts, so a command answers within Orca's limit
// with the trails read so far, and the step says how many were left.
export async function collectTrails(host, { origin, current = null, branch = null, checkout = null, deadline = Infinity, signal, run = runEntire, diff = diffStat, now = Date.now } = {}) {
  const step = { key: 'trails', label: 'Other trails', optional: true, ok: false }
  const started = now()
  const ref = repoRef(origin)
  if (!ref) return { step: { ...step, text: origin ? `can't tell the Entire project from the origin URL ${withoutCredentials(origin).slice(0, 80)}` : 'no origin remote to list trails for' }, trails: [] }
  const late = () => now() >= deadline
  if (late()) return { step: { ...step, text: 'not checked: the read was out of time' }, trails: [] }
  // A call that starts gets the time left plus a little, so a slow one can't hold the answer past it.
  const call = (args) => callEntire(host, args, run, { signal, timeoutMs: Number.isFinite(deadline) ? Math.max(GRACE_MS, deadline - now() + GRACE_MS) : undefined })

  const listArgs = ['trail', 'list', '--project', ref.project, '--repo', origin, '--status', 'open', '--limit', String(LIST_LIMIT), '--json']
  const listed = await call(listArgs)
  if (!listed.ok) return { step: { ...step, text: listed.text, ms: now() - started }, trails: [] }
  const items = (Array.isArray(listed.value?.items) ? listed.value.items : []).filter((item) => Number.isSafeInteger(item?.number))
  const shown = items.slice(0, TRAIL_LIMIT)

  // The focused branch's trail may hold other open changes of this repository too.
  const focused = await current
  let failed = 0
  const shows = await pooled(
    shown,
    async (item) => {
      if (focused && focused.number === item.number) return focused
      const result = await call(['trail', 'show', String(item.number), ...repoArgs(host), '--json'])
      if (!result.ok) {
        failed++
        console.error(`Trail #${item.number}: ${result.text}`)
        return null
      }
      return result.value
    },
    late
  )
  const changes = shows.results.flatMap((trail) => openChanges(trail, ref.name, branch).map((change) => ({ trail, change })))

  // A change whose findings there was no time for still shows, without them and its line counts.
  const detailed = await pooled(
    changes,
    async ({ trail, change }) => {
      const findingArgs = ['trail', 'finding', 'list', '--trail', String(trail.number), '--branch', change.branch, ...repoArgs(host), '--status', 'any', '--freshness', 'any', '--json']
      const findings = await call(findingArgs)
      if (!findings.ok) console.error(`Findings of trail #${trail.number} on ${change.branch}: ${findings.text}`)
      const base = findings.ok ? findings.value?.trail?.base : null
      const stat = checkout && base && !late() ? await diff(checkout, base, { head: change.branch, deadline, signal }) : null
      return { findings: findings.ok ? findings.value : null, diff: stat }
    },
    late
  )
  const summaries = changes.map(({ trail, change }, index) => trailSummary(trail, { ...(detailed.results[index] ?? { findings: null, diff: null }), branch: change.branch, repository: change.repository }))

  const count = summaries.length
  const notes = []
  if (items.length > shown.length) notes.push(`the newest ${shown.length} of ${items.length}${listed.value.nextPageToken ? '+' : ''} open trails checked`)
  if (failed) notes.push(`${failed} couldn't be read`)
  if (shows.skipped) notes.push(`${shows.skipped} ${shows.skipped === 1 ? 'trail' : 'trails'} not checked in time`)
  if (detailed.skipped) notes.push(`the findings of ${detailed.skipped} ${detailed.skipped === 1 ? 'change' : 'changes'} not read in time`)
  const text = `${count ? `${count} other open ${count === 1 ? 'change' : 'changes'}` : 'no other open changes'} in this repository${notes.length ? ` (${notes.join('; ')})` : ''}`
  return { step: { ...step, ok: true, text, ms: now() - started }, trails: summaries }
}

async function callEntire(host, args, run, options) {
  let result
  try {
    result = await run(host, args, options)
  } catch (error) {
    return { ok: false, text: error.message }
  }
  if (result.code !== 0) return { ok: false, text: failureLine(result) }
  try {
    return { ok: true, value: JSON.parse(result.stdout) }
  } catch {
    return { ok: false, text: `unexpected output: ${result.stdout.slice(0, 120)}` }
  }
}
