// Host API 1.0 has no event for focus moving to another workspace, so the worker asks which workspace
// is focused every few seconds and decides when to read Entire for it again.
export const FOCUS_POLL_MS = 5000
// The focused workspace is read again this often, even when nothing else asks.
export const AUTO_REFRESH_MS = 5 * 60_000
// Switching to a workspace read more recently than this shows what the panel already has.
export const SWITCH_FRESH_MS = 60_000
const MAX_KEPT = 50

// readContext and snapshots name a workspace the same way: display name, branch and terminal ids.
export function focusKey({ name, branch, terminals = [] }) {
  return JSON.stringify([name, branch, [...terminals].sort()])
}

export function contextKey(context) {
  return context ? focusKey({ name: context.displayName, branch: context.branch, terminals: context.terminals.map((terminal) => terminal.id) }) : null
}

export function createFocusTracker({ now = Date.now } = {}) {
  const readAt = new Map()
  let focused = null

  function markRead(key) {
    if (!key) return
    readAt.delete(key)
    readAt.set(key, now())
    if (readAt.size > MAX_KEPT) readAt.delete(readAt.keys().next().value)
  }

  return {
    markRead,
    // Why the focused workspace is due a read, 'switch' or 'timer', or null when it isn't. A due read
    // counts as a read, so a lookup that keeps failing is retried on the same schedule, not every poll.
    dueRead(key) {
      const switched = key !== focused
      focused = key
      if (!key) return null
      const age = readAt.has(key) ? now() - readAt.get(key) : Infinity
      if (age < (switched ? SWITCH_FRESH_MS : AUTO_REFRESH_MS)) return null
      markRead(key)
      return switched ? 'switch' : 'timer'
    }
  }
}
