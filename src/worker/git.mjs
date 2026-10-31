import { gitCommand } from './hosts.mjs'
import { desktopEnv, run } from './process.mjs'

export function runGit(host, args, { signal } = {}) {
  const { command, args: argv, cwd } = gitCommand(host, args)
  return run(command, argv, { cwd, env: desktopEnv(), signal })
}

// Branch names come from Entire, so only a plain ref name ever reaches git.
export function safeRef(name) {
  return typeof name === 'string' && /^[\w][\w./-]{0,200}$/.test(name) && !name.includes('..') ? name : null
}

// `git diff --shortstat` prints " 3 files changed, 458 insertions(+), 20 deletions(-)", leaving out zero counts.
export function parseShortstat(out) {
  const count = (pattern) => Number(pattern.exec(out)?.[1] ?? 0)
  return { files: count(/(\d+) files? changed/), additions: count(/(\d+) insertions?/), deletions: count(/(\d+) deletions?/) }
}

// The branch's changes against its base, as Entire's web view shows them. Null when git can't tell.
export async function diffStat(host, base, { signal } = {}) {
  for (const ref of [`origin/${base}`, base]) {
    const result = await runGit(host, ['diff', '--shortstat', `${ref}...HEAD`], { signal }).catch(() => null)
    if (result?.code === 0) return parseShortstat(result.stdout)
  }
  return null
}
