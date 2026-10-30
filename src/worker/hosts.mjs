// Orca reports WSL workspaces as UNC paths, while the plugin worker always runs on the desktop host.
// Entire has to run where the repo and its login live, so each workspace path maps to a host.

const WSL_UNC = /^\\\\wsl(?:\.localhost|\$)\\([^\\]+)(\\.*)?$/i

export function workspaceHost(workspacePath) {
  const match = WSL_UNC.exec(workspacePath.replaceAll('/', '\\'))
  if (!match) return { kind: 'local', path: workspacePath }
  return { kind: 'wsl', distro: match[1], path: (match[2] ?? '\\').replaceAll('\\', '/') }
}

export function entireCommand(host, args) {
  if (host.kind === 'wsl') {
    // A login shell puts ~/.local/bin on PATH; "$@" passes each argument through without re-parsing.
    return {
      command: 'wsl.exe',
      args: ['-d', host.distro, '--cd', host.path, '-e', 'bash', '-lc', 'exec entire "$@"', 'entire', ...args]
    }
  }
  return { command: 'entire', args, cwd: host.path }
}
