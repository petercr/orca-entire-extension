// Runs the worker inside Orca.exe the way Orca forks plugin workers: ELECTRON_RUN_AS_NODE and the env allowlist.
// Usage (Windows Node): node scripts/orca-harness/launch.mjs <terminal <handle> | repo <display name> | no-terminal | none | local-entire>
import { execFileSync, spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.platform !== 'win32') {
  console.error('Run this with Windows Node: it starts Orca.exe.')
  // WSL may keep Windows off its PATH (appendWindowsPath=false), so name node.exe by its path.
  if (process.env.WSL_DISTRO_NAME) {
    console.error('From WSL, in the repo under /mnt/c: "/mnt/c/Program Files/nodejs/node.exe" scripts/orca-harness/launch.mjs <scenario>')
  }
  process.exit(1)
}

const [scenario = 'no-terminal', terminal] = process.argv.slice(2)
const pluginRoot = fileURLToPath(new URL('../..', import.meta.url))
const worker = fileURLToPath(new URL('worker.mjs', import.meta.url))
const orcaExe = process.env.ORCA_EXE ?? join(process.env.LOCALAPPDATA ?? '', 'Programs', 'orca', 'Orca.exe')

// PATH as a freshly started Orca would see it (machine + user, from the registry).
const registryPath = execFileSync('powershell.exe', ['-NoProfile', '-Command',
  "[Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')"],
  { encoding: 'utf8', windowsHide: true }).trim()

// Mirrors src/main/plugins/workers/plugin-worker-env.ts in stablyai/orca.
const ALLOW = ['HOME', 'USERPROFILE', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ', 'TMPDIR', 'TEMP', 'TMP',
  'SYSTEMROOT', 'SYSTEMDRIVE', 'WINDIR', 'COMSPEC', 'PATHEXT', 'PROCESSOR_ARCHITECTURE', 'NUMBER_OF_PROCESSORS']
const byUpper = new Map(Object.entries(process.env).map(([k, v]) => [k.toUpperCase(), v]))
const env = { PATH: registryPath, ELECTRON_RUN_AS_NODE: '1' }
for (const key of ALLOW) {
  const value = byUpper.get(key)
  if (value !== undefined) env[key === 'SYSTEMROOT' ? 'SystemRoot' : key] = value
}

const args = [worker, pluginRoot, scenario, ...(terminal ? [terminal] : [])]
const result = spawnSync(orcaExe, args, { env, encoding: 'utf8', windowsHide: true, timeout: 60_000 })
process.stdout.write(result.stdout || '')
process.stdout.write(result.stderr || '')
if (result.error) console.log(`launch error: ${result.error.message}`)
