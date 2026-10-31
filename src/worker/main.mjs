// Orca forks this module in a Node worker on the desktop host and calls activate once.
import manifest from '../../orca-plugin.json' with { type: 'json' }
import { connectionNotice, connectionReport } from './doctor.mjs'
import { contextKey, createFocusTracker, FOCUS_POLL_MS, focusKey } from './focus.mjs'
import { panelEntry, updatePanel } from './panel.mjs'
import { auditLogPath, watchRefreshRequests } from './refresh-requests.mjs'
import { collectSnapshot } from './snapshot.mjs'

// Entire writes its checkpoint data as an agent stops, so let it settle before reading.
const AGENT_SETTLE_MS = 3000

export default function activate(orca) {
  const notify = (notice, signal) =>
    orca.host.call('notifications.show', notice, { signal }).catch((error) => {
      console.error(`Notification failed: ${error.message}`)
    })

  const focus = createFocusTracker()
  let running = 0

  // One snapshot feeds both the report and the panel.
  async function refresh(signal, { onlyIfChanged = false } = {}) {
    running++
    try {
      const snapshot = await collectSnapshot(orca, { signal })
      if (snapshot.workspace) focus.markRead(focusKey(snapshot.workspace))
      const report = connectionReport(orca, snapshot)
      // Orca 1.4.245's command palette drops a command's result, so the report also goes to the plugin's Logs.
      console.log(report)
      let panel = 'no workspace'
      if (snapshot.workspace) panel = await updatePanel(panelEntry(snapshot), { onlyIfChanged }).catch((error) => `failed: ${error.message}`)
      if (panel !== 'updated') console.log(`Panel not updated: ${panel}`)
      return { report, panel }
    } finally {
      running--
    }
  }

  orca.commands.register('doctor', async (_args, { signal }) => {
    const { report } = await refresh(signal)
    await notify(connectionNotice(report), signal)
    return report
  })

  orca.commands.register('refresh', async (_args, { signal }) => {
    const { report, panel } = await refresh(signal)
    if (panel === 'installed copy') {
      await notify({ title: 'Entire: panel not updated', body: 'The panel updates only when Orca runs this plugin from a Development folder.' }, signal)
    } else if (panel !== 'updated') {
      await notify({ title: 'Entire: panel not updated', body: `${panel}\n${report.split('\n').slice(1).join('\n')}`.slice(0, 1000) }, signal)
    }
    return `Panel ${panel}`
  })

  // Background refreshes run one at a time, and a request that arrives while one waits joins it. The
  // joined refresh skips an unchanged write only if every request in it allowed that.
  let timer = null
  let queue = Promise.resolve()
  let waiting = false
  let quiet = true
  function queueRefresh(delayMs, { onlyIfChanged = false } = {}) {
    quiet &&= onlyIfChanged
    clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      if (waiting) return
      waiting = true
      queue = queue
        .then(() => {
          waiting = false
          const options = { onlyIfChanged: quiet }
          quiet = true
          return refresh(undefined, options)
        })
        .catch((error) => console.error(`Refresh failed: ${error.message}`))
    }, delayMs)
  }

  // An agent finishing is when Entire has new checkpoints and sessions to show.
  orca.events.on('agent.status.changed', (event) => {
    if ((event.mainAgent?.state ?? event.state) === 'done') queueRefresh(AGENT_SETTLE_MS, { onlyIfChanged: true })
  })

  // The panel's refresh button reaches the worker through Orca's audit log, while the worker runs.
  const auditLog = auditLogPath()
  if (auditLog) watchRefreshRequests(auditLog, `plugin:${manifest.publisher}.${manifest.id}`, () => queueRefresh(0))

  // Read the focused workspace when focus moves to it and every few minutes after. The poll is also a
  // host call, which keeps Orca from stopping the worker as idle, so ↻ keeps working until Orca quits.
  // A refresh already running or scheduled reads the focused workspace anyway. After a switch the
  // panel shows "Checking…" until it is rewritten, so only the timed read may skip an unchanged write.
  setInterval(() => {
    orca.host.call('workspace.readContext', {}).then(
      (context) => {
        if (running || waiting || timer) return
        const reason = focus.dueRead(contextKey(context))
        if (!reason) return
        console.log(`Checking Entire for ${context.displayName} on ${context.branch} (${reason})`)
        queueRefresh(0, { onlyIfChanged: reason === 'timer' })
      },
      () => {}
    )
  }, FOCUS_POLL_MS).unref()
}
