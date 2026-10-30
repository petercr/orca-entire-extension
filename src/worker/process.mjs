import { spawn } from 'node:child_process'
import { win32 } from 'node:path'

// Orca stops waiting for a plugin command after 30 s, so each child process gets a shorter budget.
const CHILD_TIMEOUT_MS = 15_000

export function run(command, args, { cwd, env = process.env, signal, timeoutMs = CHILD_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const child = spawn(command, args, { cwd, env, signal, windowsHide: true })
    const stdout = []
    const stderr = []
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, timeoutMs)
    child.stdout.on('data', (chunk) => stdout.push(chunk))
    child.stderr.on('data', (chunk) => stderr.push(chunk))
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({
        code,
        timedOut,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        ms: Date.now() - started
      })
    })
  })
}

// The worker env is an allowlist without APPDATA or LOCALAPPDATA, which Windows CLIs (Orca's included)
// use to find their data. Derive them from USERPROFILE when they are missing.
export function desktopEnv(env = process.env, platform = process.platform) {
  if (platform !== 'win32' || !env.USERPROFILE) return env
  return {
    APPDATA: win32.join(env.USERPROFILE, 'AppData', 'Roaming'),
    LOCALAPPDATA: win32.join(env.USERPROFILE, 'AppData', 'Local'),
    ...env
  }
}
