import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { orcaCli } from './orca-cli.mjs'
import { desktopEnv } from './process.mjs'

// Orca reaches a paired server's orcad through an SSH tunnel to one of its saved SSH targets. The CLI
// names the target's id only; the address lives in Orca's profile database, which this reads read-only.
// With the target's key in ssh-agent, the worker runs Entire and git in the server's checkout over SSH.
const known = new Map()

export async function serverSshTarget(environment, { signal } = {}) {
  if (known.has(environment)) return known.get(environment)
  const { environment: saved } = await orcaCli(['environment', 'show', '--environment', environment], { signal })
  const id = saved?.orcadDeployment?.sshTargetId
  if (!id) throw new Error(`Orca has no SSH target for ${environment}`)
  const target = sshTarget(await orcaSshTargets(), id)
  if (!target) throw new Error(`Orca's SSH target for ${environment} has no usable address`)
  known.set(environment, target)
  return target
}

// The address goes to ssh as arguments, so it must not read as an option.
export function sshTarget(targets, id) {
  const saved = (Array.isArray(targets) ? targets : []).find((target) => target?.id === id)
  if (!saved) return null
  // configHost is the ~/.ssh/config alias when the target came from there, so ssh applies that config.
  const host = saved.configHost || saved.host
  const port = saved.port ?? 22
  const user = saved.username || null
  if (typeof host !== 'string' || !/^[A-Za-z0-9_][\w.:-]{0,252}$/.test(host)) return null
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null
  if (user !== null && (typeof user !== 'string' || !/^[A-Za-z0-9_][\w.-]{0,63}$/.test(user))) return null
  return { host, port, user }
}

async function orcaSshTargets(env = desktopEnv()) {
  if (process.platform !== 'win32' || !env.APPDATA) throw new Error("reading Orca's SSH targets works on Windows only so far")
  const root = join(env.APPDATA, 'orca')
  const { activeProfileId } = JSON.parse(await readFile(join(root, 'orca-profile-index.json'), 'utf8'))
  if (!/^[\w-]+$/.test(activeProfileId ?? '')) throw new Error("Orca's active profile is unknown")
  // Orca's own Node ships node:sqlite; load it only here so the rest of the worker runs on any Node.
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(join(root, 'profiles', activeProfileId, 'profile-state.db'), { readOnly: true })
  try {
    const row = db.prepare("select payload from profile_state_documents where domain = 'sshTargets'").get()
    return row ? JSON.parse(row.payload) : []
  } finally {
    db.close()
  }
}
