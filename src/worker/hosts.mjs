import { tmpdir } from 'node:os'

// Orca reports WSL workspaces as UNC paths, while the plugin worker always runs on the desktop host.
// Entire has to run where the repo and its login live, so each workspace path maps to a host.

const WSL_UNC = /^\\\\wsl(?:\.localhost|\$)\\([^\\]+)(\\.*)?$/i

export function workspaceHost(workspacePath) {
  const match = WSL_UNC.exec(workspacePath.replaceAll('/', '\\'))
  if (!match) return { kind: 'local', path: workspacePath }
  return { kind: 'wsl', distro: match[1], path: (match[2] ?? '\\').replaceAll('\\', '/') }
}

// A workspace on a paired Orca server (a VPS). The worker can't run anything there: Orca's SSH key
// needs a passphrase and the CLI has no way to run a command without opening a terminal tab. Trails and
// findings live on Entire's server, though, so this desktop's Entire reads them by repository and
// branch. Status, checkpoints and the diff need the checkout and stay out of reach.
export function serverHost({ environment, path, repoUrl, branch }) {
  return { kind: 'server', environment, path, repo: safeRepoUrl(repoUrl), branch: branchName(branch) }
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
  return { command: 'entire', args, cwd: host.path }
}

export function gitCommand(host, args) {
  if (host.kind === 'server') throw new Error(`git runs only on ${host.environment}`)
  if (host.kind === 'wsl') return { command: 'wsl.exe', args: ['-d', host.distro, '--cd', host.path, '-e', 'git', ...args] }
  return { command: 'git', args, cwd: host.path }
}
