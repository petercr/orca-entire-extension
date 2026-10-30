// Orca forks this module in a Node worker on the desktop host and calls activate once.
import { checkConnection, connectionNotice } from './doctor.mjs'

export default function activate(orca) {
  orca.commands.register('doctor', async (_args, { signal }) => {
    const report = await checkConnection(orca, { signal })
    // Orca 1.4.245's command palette drops a command's result, and the Run button in Settings → Plugins
    // shows only its first 200 characters. So the report also goes to the plugin's Logs (stdout) and
    // to a notification.
    console.log(report)
    await orca.host.call('notifications.show', connectionNotice(report), { signal }).catch((error) => {
      console.error(`Notification failed: ${error.message}`)
    })
    return report
  })
}
