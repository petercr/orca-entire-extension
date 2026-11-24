// The panel's two writes to Entire: approve a trail, and merge its change. Each runs only on a click
// the panel confirmed, and only on the workspace that click was in: the panel names it by its path
// (and paired server), the worker finds its own entry for it, checks the trail there, and runs Entire
// for that entry. Focus is not read again, so switching workspaces after the click can't redirect it.
import { failureLine, runEntire } from './entire-cli.mjs'
import { branchName, serverHost, workspaceHost } from './hosts.mjs'

const ACTIONS = {
  approve: { verb: 'approve', done: 'Approved' },
  merge: { verb: 'merge', done: 'Merged' }
}

// Entire merges on its server, which checks the gates first; give it longer than a read.
const ACTION_TIMEOUT_MS = 60_000

// The panel's input, checked: { action, trail, branch, path, environment }. Throws on anything else.
export function actionRequest(input) {
  const action = Object.hasOwn(ACTIONS, input?.action) ? input.action : null
  if (!action) throw new Error('Unknown trail action')
  const trail = Number(input.trail)
  if (!Number.isSafeInteger(trail) || trail < 1) throw new Error('No trail number to act on')
  const branch = branchName(input.branch)
  if (!branch) throw new Error('No valid branch to act on')
  if (typeof input.path !== 'string' || !input.path) throw new Error('No workspace to act in')
  const environment = input.environment ?? null
  if (environment !== null && typeof environment !== 'string') throw new Error('No valid paired server to act on')
  return { action, trail, branch, path: input.path, environment }
}

// The worker's entry for the workspace the click was in, or null.
export function confirmedEntry(data, { path, environment }) {
  return (data?.workspaces ?? []).find((entry) => entry.workspace.path === path && (entry.workspace.server?.environment ?? null) === environment) ?? null
}

// The trails the panel lists for an entry: the focused branch's and the repository's other open changes.
export function shownTrails(entry) {
  const data = entry?.data ?? {}
  return Array.isArray(data.trails) ? data.trails : data.trail ? [data.trail] : []
}

// That workspace must still show the trail the click was for, and for a merge, nothing may block it.
export function checkShown(request, entry) {
  const { action, trail, branch } = request
  const value = shownTrails(entry).find((shown) => shown?.number === trail && shown.branch === branch)
  if (!value) {
    throw new Error(`That workspace no longer shows trail #${trail} on ${branch}, so nothing was done. Check the panel and try again.`)
  }
  if (!value.open) throw new Error(`Trail #${trail}'s change on ${branch} isn't open, so there is nothing to ${ACTIONS[action].verb}.`)
  if (action === 'merge' && (!Array.isArray(value.blockers) || value.blockers.length)) {
    throw new Error(`Trail #${trail} can't merge yet: ${(value.blockers ?? ['refresh the panel first']).join('; ')}.`)
  }
}

// Where Entire runs for an entry: its checkout, or for a paired server's workspace, this desktop by
// repository. Both act on Entire's server, so a server workspace needs no SSH here.
export function entryHost(entry) {
  const { path, server } = entry.workspace
  if (!server) return workspaceHost(path)
  const host = serverHost({ environment: server.environment, path, repoUrl: server.repoUrl, branch: server.branch })
  if (!host.repo) throw new Error(`The panel doesn't know ${path} on ${server.environment}'s repository yet. Use ↻ and try again.`)
  return host
}

// --branch picks the change within the trail; a paired server's workspace also names the repository.
export function actionArgs({ action, trail, branch }, host) {
  const args = ['trail', action, String(trail), '--branch', branch]
  return host.kind === 'server' ? [...args, '--repo', host.repo] : args
}

// Runs the action for the confirmed workspace and answers with a line to show.
export async function runAction(request, { data, signal, run = runEntire } = {}) {
  const entry = confirmedEntry(data, request)
  checkShown(request, entry)
  const host = entryHost(entry)
  const result = await run(host, actionArgs(request, host), { signal, timeoutMs: ACTION_TIMEOUT_MS })
  if (result.code !== 0) throw new Error(`Entire refused to ${ACTIONS[request.action].verb} trail #${request.trail}: ${failureLine(result)}`)
  return `${ACTIONS[request.action].done} trail #${request.trail} on ${request.branch}.`
}
