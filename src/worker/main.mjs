// Orca forks this module in a Node worker on the desktop host and calls activate once. Orca starts it
// for a command, an event, or the panel's first plugin.request, and stops it after 5 idle minutes;
// the panel's next request starts it again.
import { connectionNotice, connectionReport } from './doctor.mjs'
import { createPanelData } from './panel.mjs'
import { collectSnapshot } from './snapshot.mjs'

// Entire writes its checkpoint data as an agent stops, so let it settle before reading.
const AGENT_SETTLE_MS = 3000

export default function activate(orca) {
  const notify = (notice, signal) =>
    orca.host.call('notifications.show', notice, { signal }).catch((error) => {
      console.error(`Notification failed: ${error.message}`)
    })

  // Tells open panels to ask for the data again. A post carries at most 256 KiB, so the data
  // itself goes back through the panel's request.
  const announce = () => {
    try {
      orca.panels?.post('entire.changed', {})
    } catch (error) {
      console.error(`Posting to the panel failed: ${error.message}`)
    }
  }

  // Each snapshot's report also goes to the plugin's Logs, since the command palette drops a
  // command's result.
  const collect = async (signal) => {
    const snapshot = await collectSnapshot(orca, { signal })
    console.log(connectionReport(orca, snapshot))
    return snapshot
  }

  // Only a read that found the workspace changed the data; a post after one that didn't would have the
  // panel fetch the old data and take it as news.
  const announceIfAdded = (snapshot) => {
    if (snapshot.workspace) announce()
    return snapshot
  }

  const panel = createPanelData({
    collect: () => collect().then(announceIfAdded),
    readContext: () => orca.host.call('workspace.readContext', {})
  })

  orca.panels?.handle('entire.data', async () => panel.data)
  orca.panels?.handle('entire.read', async (input) => panel.read({ maxAgeMs: Math.max(0, Number(input?.maxAgeMs) || 0) }))

  // A command must answer within 30 seconds, so it reads on its own, under its own signal.
  async function refresh(signal) {
    const snapshot = announceIfAdded(panel.add(await collect(signal)))
    return connectionReport(orca, snapshot)
  }

  orca.commands.register('doctor', async (_args, { signal }) => {
    const report = await refresh(signal)
    await notify(connectionNotice(report), signal)
    return report
  })

  orca.commands.register('refresh', async (_args, { signal }) => {
    const report = await refresh(signal)
    const notice = connectionNotice(report)
    if (notice.title !== 'Entire: connected') await notify({ ...notice, title: 'Entire: panel updated with a problem' }, signal)
    return 'Panel updated'
  })

  // An agent finishing is when Entire has new checkpoints and sessions to show. Several finishing
  // together make one read.
  let timer = null
  orca.events.on('agent.status.changed', (event) => {
    if ((event.mainAgent?.state ?? event.state) !== 'done') return
    clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      panel.readAgain().catch((error) => console.error(`Refresh failed: ${error.message}`))
    }, AGENT_SETTLE_MS)
  })
}
