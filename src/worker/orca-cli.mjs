import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { desktopEnv, run } from './process.mjs'

// The worker runs inside Orca's own binary (ELECTRON_RUN_AS_NODE), so Orca's CLI ships beside it.
// Verified on Windows; check the layout before relying on it on macOS.
export function orcaCliPath(execPath = process.execPath, platform = process.platform) {
  const cli = join(dirname(execPath), 'resources', 'bin', platform === 'win32' ? 'orca.exe' : 'orca')
  return existsSync(cli) ? cli : null
}

export async function orcaCli(args, { signal } = {}) {
  const cli = orcaCliPath()
  if (!cli) throw new Error(`Orca CLI not found beside ${process.execPath}`)
  const name = `orca ${args.slice(0, 2).join(' ')}`
  const { code, stdout } = await run(cli, [...args, '--json'], { env: desktopEnv(), signal })
  let reply
  try {
    reply = JSON.parse(stdout)
  } catch {
    throw new Error(`${name} printed no JSON (exit ${code})`)
  }
  if (!reply.ok) throw new Error(`${name}: ${reply.error?.message ?? 'failed'}`)
  return reply.result
}
