import { gitCommand } from './hosts.mjs'
import { desktopEnv, run } from './process.mjs'

export function runGit(host, args, { signal, timeoutMs } = {}) {
  const { command, args: argv, cwd } = gitCommand(host, args)
  return run(command, argv, { cwd, env: desktopEnv(), signal, timeoutMs })
}

// A git call started just before a deadline may finish this much later.
const GRACE_MS = 3000

// Branch names come from Entire, so only a plain ref name ever reaches git.
export function safeRef(name) {
  return typeof name === 'string' && /^[\w][\w./-]{0,200}$/.test(name) && !name.includes('..') ? name : null
}

// `git diff --shortstat` prints " 3 files changed, 458 insertions(+), 20 deletions(-)", leaving out zero counts.
export function parseShortstat(out) {
  const count = (pattern) => Number(pattern.exec(out)?.[1] ?? 0)
  return { files: count(/(\d+) files? changed/), additions: count(/(\d+) insertions?/), deletions: count(/(\d+) deletions?/) }
}

// The branch's changes against its base, as Entire's web view shows them. `head` is the checked-out
// branch, or another branch's name: its remote-tracking ref, then a local branch, when the checkout has
// one. Both names come from Entire, so only plain ref names reach git. Null when git can't tell, or
// when `deadline` (a Date.now() time) passes before an attempt starts; one started gets the time left.
export async function diffStat(host, base, { head = 'HEAD', signal, deadline = Infinity, now = Date.now, run = runGit } = {}) {
  if (!safeRef(base)) return null
  const heads = head === 'HEAD' ? ['HEAD'] : safeRef(head) ? [`origin/${head}`, head] : []
  for (const to of heads) {
    for (const from of [`origin/${base}`, base]) {
      if (now() >= deadline) return null
      const timeoutMs = Number.isFinite(deadline) ? Math.max(GRACE_MS, deadline - now() + GRACE_MS) : undefined
      const result = await run(host, ['diff', '--shortstat', `${from}...${to}`], { signal, timeoutMs }).catch(() => null)
      if (result?.code === 0) return parseShortstat(result.stdout)
    }
  }
  return null
}
