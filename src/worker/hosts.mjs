import { tmpdir } from 'node:os'

// Orca reports WSL workspaces as UNC paths, while the plugin worker always runs on the desktop host.
// Entire has to run where the repo and its login live, so each workspace path maps to a host.

const WSL_UNC = /^\\\\wsl(?:\.localhost|\$)\\([^\\]+)(\\.*)?$/i

export function workspaceHost(workspacePath) {
  const match = WSL_UNC.exec(workspacePath.replaceAll('/', '\\'))
  if (!match) return { kind: 'local', path: workspacePath }
  return { kind: 'wsl', distro: match[1], path: (match[2] ?? '\\').replaceAll('\\', '/') }
}

// A workspace on a paired Orca server (a VPS). Trails and findings live on Entire's server, so this
// desktop's Entire reads them by repository and branch. Status, checkpoints and the diff need the
// checkout: `remote` reaches it over SSH when Orca's SSH target for the server is known (its key must be
// in ssh-agent, since nothing can type a passphrase), and `remoteProblem` says why not otherwise.
export function serverHost({ environment, path, repoUrl, branch, target = null, remoteProblem = null }) {
  return {
    kind: 'server',
    environment,
    path,
    repo: safeRepoUrl(repoUrl),
    branch: branchName(branch),
    remote: target ? { kind: 'ssh', environment, target, path } : null,
    remoteProblem: target ? null : remoteProblem
  }
}

// One POSIX shell word: the remote shell parses the command line ssh sends, so every part is quoted.
export function shellQuote(word) {
  return `'${String(word).replaceAll("'", `'\\''`)}'`
}

// A login shell puts ~/.local/bin, where Entire installs, on PATH. BatchMode fails instead of prompting.
function sshCommand(host, argv) {
  const { host: address, port, user } = host.target
  const remote = ['bash', '-lc', 'cd -- "$1" && shift && exec "$@"', 'bash', host.path, ...argv].map(shellQuote).join(' ')
  return {
    command: 'ssh',
    args: ['-n', '-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', '-p', String(port), '--', user ? `${user}@${address}` : address, remote]
  }
}

// A branch as Git allows it (`git check-ref-format --branch`), or null. Orca reports it and it goes to
// Entire as one argument, never through a shell, so Git's rules are the only limit, plus no leading "-",
// which would read as a flag.
export function branchName(name) {
  if (typeof name !== 'string' || name.length === 0 || name.length > 255) return null
  if (/[\x00-\x20\x7f~^:?*[\\]/.test(name) || name.includes('..') || name.includes('@{') || name === '@') return null
  if (name.startsWith('-') || name.startsWith('/') || name.endsWith('/') || name.endsWith('.')) return null
  return name.split('/').every((part) => part && !part.startsWith('.') && !part.endsWith('.lock')) ? name : null
}

// The remote URL comes from Orca and goes to Entire as one argument; it must not read as a flag.
export function safeRepoUrl(url) {
  return typeof url === 'string' && /^[\w.+-]+(?::\/\/|@)[^\s]{1,400}$/.test(url) && !url.startsWith('-') ? url : null
}

export function entireCommand(host, args) {
  if (host.kind === 'wsl') {
    // A login shell puts ~/.local/bin on PATH; "$@" passes each argument through without re-parsing.
    return {
      command: 'wsl.exe',
      args: ['-d', host.distro, '--cd', host.path, '-e', 'bash', '-lc', 'exec entire "$@"', 'entire', ...args]
    }
  }
  // Outside any checkout, so only --repo and --branch say which repository Entire reads.
  if (host.kind === 'server') return { command: 'entire', args, cwd: tmpdir() }
  // The opt-out has to travel with the command: the desktop env stays on this side of SSH.
  if (host.kind === 'ssh') return sshCommand(host, ['env', 'ENTIRE_TELEMETRY_OPTOUT=1', 'entire', ...args])
  return { command: 'entire', args, cwd: host.path }
}

export function gitCommand(host, args) {
  if (host.kind === 'server') throw new Error(`git runs only on ${host.environment}`)
  if (host.kind === 'ssh') return sshCommand(host, ['git', ...args])
  if (host.kind === 'wsl') return { command: 'wsl.exe', args: ['-d', host.distro, '--cd', host.path, '-e', 'git', ...args] }
  return { command: 'git', args, cwd: host.path }
}
