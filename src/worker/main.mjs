// Orca forks this module in a Node worker on the desktop host and calls activate once.
import manifest from '../../orca-plugin.json' with { type: 'json' }
import { connectionNotice, connectionReport } from './doctor.mjs'
import { panelEntry, updatePanel } from './panel.mjs'
import { auditLogPath, watchRefreshRequests } from './refresh-requests.mjs'
import { collectSnapshot } from './snapshot.mjs'

// Entire writes its checkpoint data as an agent stops, so let it settle before reading.
const AGENT_SETTLE_MS = 3000
// Orca stops a worker after 5 minutes without host calls, and the panel's ↻ reaches only a running
// worker. So once started, the worker makes a cheap host call every 2 minutes and stays up with Orca.
const HEARTBEAT_MS = 2 * 60_000

export default function activate(orca) {
  const notify = (notice, signal) =>
    orca.host.call('notifications.show', notice, { signal }).catch((error) => {
      console.error(`Notification failed: ${error.message}`)
    })

  setInterval(() => orca.host.call('workspace.readContext', {}).catch(() => {}), HEARTBEAT_MS).unref()

  // One snapshot feeds both the report and the panel.
  async function refresh(signal) {
    const snapshot = await collectSnapshot(orca, { signal })
    const report = connectionReport(orca, snapshot)
    // Orca 1.4.245's command palette drops a command's result, so the report also goes to the plugin's Logs.
    console.log(report)
    let panel = 'no workspace'
    if (snapshot.workspace) {
      panel = await updatePanel(panelEntry(snapshot)).then(
        (written) => (written ? 'updated' : 'installed copy'),
        (error) => `failed: ${error.message}`
      )
    }
    if (panel !== 'updated') console.log(`Panel not updated: ${panel}`)
    return { report, panel }
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

  // Background refreshes run one at a time, and a request that arrives while one waits joins it.
  let timer = null
  let queue = Promise.resolve()
  let waiting = false
  function queueRefresh(delayMs) {
    clearTimeout(timer)
    timer = setTimeout(() => {
      if (waiting) return
      waiting = true
      queue = queue
        .then(() => {
          waiting = false
          return refresh()
        })
        .catch((error) => console.error(`Refresh failed: ${error.message}`))
    }, delayMs)
  }

  // An agent finishing is when Entire has new checkpoints and sessions to show.
  orca.events.on('agent.status.changed', (event) => {
    if ((event.mainAgent?.state ?? event.state) === 'done') queueRefresh(AGENT_SETTLE_MS)
  })

  // The panel's refresh button reaches the worker through Orca's audit log, while the worker runs.
  const auditLog = auditLogPath()
  if (auditLog) watchRefreshRequests(auditLog, `plugin:${manifest.publisher}.${manifest.id}`, () => queueRefresh(0))
}
