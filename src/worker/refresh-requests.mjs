// Host API 1.0 gives a panel no way to ask its worker for anything. A panel may show a notification, and
// Orca appends each one to its plugin audit log as `titleChars=<length>`. So the panel's refresh button
// shows a notification whose title length no worker notification uses, and the worker watches the log.
import { unwatchFile, watchFile } from 'node:fs'
import { open, stat } from 'node:fs/promises'
import { win32 } from 'node:path'
import { desktopEnv } from './process.mjs'

// panel/template.html shows this exact title; test/refresh-requests.test.mjs keeps the two in step.
export const REFRESH_REQUEST_TITLE = 'Entire: refreshing the panel'

// Orca's userData on Windows. Verified there only.
export function auditLogPath(env = desktopEnv(), platform = process.platform) {
  return platform === 'win32' && env.APPDATA ? win32.join(env.APPDATA, 'orca', 'plugins-data', 'audit.log') : null
}

export function hasRefreshRequest(lines, actor) {
  return lines.some((line) => {
    try {
      const entry = JSON.parse(line)
      return (
        entry.actor === actor &&
        entry.method === 'notifications.show' &&
        entry.outcome === 'ok' &&
        entry.summary === `titleChars=${REFRESH_REQUEST_TITLE.length}`
      )
    } catch {
      return false
    }
  })
}

// Reads only what Orca appends after the worker starts, and starts over when Orca rotates the log.
export function watchRefreshRequests(path, actor, onRequest, { intervalMs = 1000 } = {}) {
  let offset = null
  let reading = false
  const check = async () => {
    if (reading) return
    reading = true
    try {
      const { size } = await stat(path)
      if (offset === null) offset = size
      if (size < offset) offset = 0
      if (size > offset) {
        const file = await open(path, 'r')
        try {
          const { buffer, bytesRead } = await file.read({ buffer: Buffer.alloc(size - offset), position: offset })
          // Leave a line Orca is still writing for the next check.
          const end = buffer.subarray(0, bytesRead).lastIndexOf(0x0a) + 1
          offset += end
          if (hasRefreshRequest(buffer.toString('utf8', 0, end).split('\n'), actor)) onRequest()
        } finally {
          await file.close()
        }
      }
    } catch {
      // No log yet, or Orca is mid-rotation: the next check tries again.
    } finally {
      reading = false
    }
  }
  check()
  // Orca decides how long a worker lives; the watcher never keeps one running.
  watchFile(path, { interval: intervalMs }, check).unref()
  return { dispose: () => unwatchFile(path, check) }
}
