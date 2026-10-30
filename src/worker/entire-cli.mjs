import { entireCommand } from './hosts.mjs'
import { desktopEnv, run } from './process.mjs'

export function runEntire(host, args, { signal, timeoutMs } = {}) {
  const { command, args: argv, cwd } = entireCommand(host, args)
  return run(command, argv, { cwd, env: desktopEnv(), signal, timeoutMs })
}

// Entire explains a failure in one line, on stderr or stdout depending on the command.
export function failureLine(result) {
  if (result.timedOut) return `timed out after ${result.ms} ms`
  return (result.stderr.trim() || result.stdout.trim() || `exit ${result.code}`).split('\n')[0]
}
