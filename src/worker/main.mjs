// Orca forks this module in a Node worker on the desktop host and calls activate once.
import { connectionNotice, connectionReport } from './doctor.mjs'
import { panelEntry, updatePanel } from './panel.mjs'
import { collectSnapshot } from './snapshot.mjs'

// Entire writes its checkpoint data as an agent stops, so let it settle before reading.
const AGENT_SETTLE_MS = 3000

export default function activate(orca) {
  const notify = (notice, signal) =>
    orca.host.call('notifications.show', notice, { signal }).catch((error) => {
      console.error(`Notification failed: ${error.message}`)
    })

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

  // An agent finishing is when Entire has new checkpoints and sessions to show. These refreshes queue
  // behind each other instead of overlapping.
  let timer = null
  let queue = Promise.resolve()
  orca.events.on('agent.status.changed', (event) => {
    if ((event.mainAgent?.state ?? event.state) !== 'done') return
    clearTimeout(timer)
    timer = setTimeout(() => {
      queue = queue.then(() => refresh()).catch((error) => console.error(`Refresh failed: ${error.message}`))
    }, AGENT_SETTLE_MS)
  })
}
