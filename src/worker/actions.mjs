// The panel's two writes to Entire: approve the focused workspace's trail, and merge its change. Each
// runs only on a click the panel confirmed, and only for the trail the panel shows for the focused
// workspace, so a focus change between the click and the request does nothing.
import { failureLine, runEntire } from './entire-cli.mjs'
import { branchName } from './hosts.mjs'
import { findShown } from './panel.mjs'
import { focusedHost } from './snapshot.mjs'

const ACTIONS = {
  approve: { verb: 'approve', done: 'Approved' },
  merge: { verb: 'merge', done: 'Merged' }
}

// Entire merges on its server, which checks the gates first; give it longer than a read.
const ACTION_TIMEOUT_MS = 60_000

// The panel's input, checked: { action, trail, branch }. Throws on anything else.
export function actionRequest(input) {
  const action = Object.hasOwn(ACTIONS, input?.action) ? input.action : null
  if (!action) throw new Error('Unknown trail action')
  const trail = Number(input.trail)
  if (!Number.isSafeInteger(trail) || trail < 1) throw new Error('No trail number to act on')
  const branch = branchName(input.branch)
  if (!branch) throw new Error('No valid branch to act on')
  return { action, trail, branch }
}

// The trail the panel shows for the focused workspace must be the one the click was for, and for a
// merge, nothing may block it.
export function checkShown(request, shown) {
  const value = shown?.data?.trail
  const { action, trail, branch } = request
  if (!value || value.number !== trail || value.branch !== branch) {
    throw new Error(`The focused workspace no longer shows trail #${trail} on ${branch}, so nothing was done. Check the panel and try again.`)
  }
  if (!value.open) throw new Error(`Trail #${trail}'s change on ${branch} isn't open, so there is nothing to ${ACTIONS[action].verb}.`)
  if (action === 'merge' && (!Array.isArray(value.blockers) || value.blockers.length)) {
    throw new Error(`Trail #${trail} can't merge yet: ${(value.blockers ?? ['refresh the panel first']).join('; ')}.`)
  }
}

// --branch picks the change within the trail; a paired server's workspace also names the repository.
export function actionArgs({ action, trail, branch }, host) {
  const args = ['trail', action, String(trail), '--branch', branch]
  return host.kind === 'server' ? [...args, '--repo', host.repo] : args
}

// Runs the action where the workspace's Entire lives and answers with a line to show.
export async function runAction(orca, request, { readContext, data, signal } = {}) {
  const context = await readContext()
  checkShown(request, context ? findShown(data, context) : null)
  const { host, problem } = await focusedHost(orca, { signal })
  if (problem) throw new Error(problem)
  const result = await runEntire(host, actionArgs(request, host), { signal, timeoutMs: ACTION_TIMEOUT_MS })
  if (result.code !== 0) throw new Error(`Entire refused to ${ACTIONS[request.action].verb} trail #${request.trail}: ${failureLine(result)}`)
  return `${ACTIONS[request.action].done} trail #${request.trail} on ${request.branch}.`
}
