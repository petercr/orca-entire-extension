import { entireCommand } from './hosts.mjs'
import { desktopEnv, run } from './process.mjs'

export function runEntire(host, args, { signal, timeoutMs } = {}) {
  const { command, args: argv, cwd } = entireCommand(host, args)
  return run(command, argv, { cwd, env: entireEnv(), signal, timeoutMs })
}

// Entire sends usage analytics from a detached `entire __send_analytics` child. On Windows that child has
// no console, so every git it runs opens a terminal window. The plugin's calls are background reads, so
// they opt out of analytics; WSLENV carries the opt-out into WSL as well.
export function entireEnv(env = desktopEnv()) {
  return {
    ...env,
    ENTIRE_TELEMETRY_OPTOUT: '1',
    WSLENV: env.WSLENV ? `${env.WSLENV}:ENTIRE_TELEMETRY_OPTOUT` : 'ENTIRE_TELEMETRY_OPTOUT'
  }
}

// Entire explains a failure in one line, on stderr or stdout depending on the command.
export function failureLine(result) {
  if (result.timedOut) return `timed out after ${result.ms} ms`
  return (result.stderr.trim() || result.stdout.trim() || `exit ${result.code}`).split('\n')[0]
}
