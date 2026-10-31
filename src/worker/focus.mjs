// Host API 1.0 has no event for focus moving to another workspace, so the worker asks which workspace
// is focused every few seconds and decides when to read Entire for it again.
export const FOCUS_POLL_MS = 5000
// The focused workspace is read again this often, even when nothing else asks.
export const AUTO_REFRESH_MS = 5 * 60_000
// Switching to a workspace the panel shows data for younger than this shows what the panel has.
// panel/template.html uses the same age to decide whether to show "Checking…".
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

  function markRead(key, at = now()) {
    if (!key) return
    readAt.delete(key)
    readAt.set(key, at)
    if (readAt.size > MAX_KEPT) readAt.delete(readAt.keys().next().value)
  }

  return {
    markRead,
    // Why the focused workspace is due a read, 'switch' or 'timer', or null when it isn't. A due read
    // counts as a read, so a lookup that keeps failing is retried on the same schedule, not every poll.
    // On a switch, what counts is the panel's own entry, read by shownAt (its time in ms, or null):
    // the worker's last read may have been for another branch, or skipped its unchanged write.
    dueRead(key, { shownAt = () => null } = {}) {
      const switched = key !== focused
      focused = key
      if (!key) return null
      if (switched) {
        const at = shownAt()
        if (at !== null && now() - at < SWITCH_FRESH_MS) {
          // The timer counts from the shown data's read.
          markRead(key, at)
          return null
        }
      } else if (readAt.has(key) && now() - readAt.get(key) < AUTO_REFRESH_MS) {
        return null
      }
      markRead(key)
      return switched ? 'switch' : 'timer'
    }
  }
}
