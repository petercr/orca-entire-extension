// Orca forks this module in a Node worker on the desktop host and calls activate once.
import { checkConnection } from './doctor.mjs'

export default function activate(orca) {
  // Orca shows a string result as-is.
  orca.commands.register('doctor', (_args, { signal }) => checkConnection(orca, { signal }))
}
