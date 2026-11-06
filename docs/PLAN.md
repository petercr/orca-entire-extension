# Entire for Orca: plan

Bring Entire (trails, findings, approvals, checkpoints) into Orca's UI as an Orca plugin, the way
Orca already surfaces GitHub pull requests and checks.

Status: phases 0 and 0.5 done. The Entire panel now talks to its worker over Orca's panel channel
(host API 1.2), so it works from an installed copy too, which unblocks publishing (phase 6). Next:
try the channel in Orca, then the phase 6 release steps.

## Environment

- Orca desktop runs on Windows (1.4.250 since 2026-11-05; the plan began on 1.4.245). Plugins are in
  alpha: manifest format 2. The plugin targets Orca 1.4.246 or later for host API 1.2.
- Most Orca and Entire projects live in WSL (`\\wsl.localhost\Ubuntu\...`). Others live
  on a VPS that Orca reaches as a paired Orca server (`orca environment list`: "Endo VPS Server", an
  orcad over an SSH tunnel to `ubuntu@15.204.88.195`).
- Entire CLI `0.12.3-nightly` on both sides: WSL (keyring login) and Windows in `%USERPROFILE%\.local\bin`
  (Credential Manager login).
- This repo: `C:\Users\pcruc\Web Projects\orca-entire-extension`, origin
  `entire://aws-us-east-2.entire.io/et/entire-repos/orca-entire-extension`, Entire enabled.

## What Orca's plugin API allows (1.4.245, updated for 1.4.250)

Sources: `docs/reference/plugin-*.md` and `src/shared/plugins/**` in github.com/stablyai/orca.

- `execution: "trusted-worker"`: `main` runs in a Node process Orca forks on the desktop host (Windows
  here). It has full Node access, but its env is an allowlist (PATH, HOME, USERPROFILE, TEMP and a few
  Windows system variables; no APPDATA). Idle workers stop after 5 minutes with nothing in flight, and a
  command must answer within 30 seconds.
- Host API 1.0: `workspace.readContext` returns `{ branch, displayName, terminals: [{ id }] }` with no
  path; `notifications.show`; `terminal.sendText` (worker only); `storage.*`, `secrets.*` and
  `settings.*` (worker only).
- Events (at most 3): `workspace.created`, `workspace.removed`, `agent.status.changed`.
- The command palette ignores a command's return value. The Run button in Settings → Plugins shows its
  first 200 characters in a toast. Worker stdout and stderr go to the plugin's Logs (last 200 lines).
- Panels are sealed: no network, no browser permissions (so no async Clipboard API;
  `execCommand('copy')` in a click works), links only through `orca.shell.openExternal` (1.1).
- Host API 1.2 (Orca 1.4.246) added the panel channel: a panel calls `orca.plugin.request(name,
  input, { timeoutMs })`, which starts the worker if needed and runs the handler it registered with
  `orca.panels.handle`; the worker posts with `orca.panels.post` (fire and forget, 256 KiB) and the
  panel listens with `orca.plugin.on`. Answers go up to 1 MiB, requests up to 120 s. A panel also
  hears `workspace.changed` and agent events with `orca.on`. 1.2 also brought `agents.list`; 1.3
  brings `workspace.list` (every workspace with its path and host, worker only), which could replace
  much of `src/worker/workspace.mjs` once the installed Orca offers it.
- Before 1.2 the panel worked only from a development folder: the worker wrote its data into the
  panel file (installed copies are hash-checked), and ↻ reached the worker through Orca's audit log.
  Both stopgaps are gone (branch `panel-channel`).
- Reserved but not shipped: `taskSources`, `statusBarItems`, `sidebarCards`, `connections`, `settings`,
  `hooks`, `skills`, `mcpServers`.
- 1.4.250 has the `orca plugin` CLI: `validate`, `inspect` (content hash), `release-entry`, `logs`,
  and `dev request` to call a panel handler. Load the plugin through Settings → Plugins →
  Development folders.
- `publisher` is deprecated: Orca names the publisher after the repository owner for catalog and Git
  installs (`petercr.entire`) and `local` for a folder (`local.entire`). Leaving it out needs
  `>=1.4.246`. Ids may not start with `orca-`.

## Spike results (2026-10-30)

Run from Windows Node with the worker's env allowlist:

- `wsl.exe -d Ubuntu -e bash -lc 'exec entire "$@"' entire trail list ... --json` works with the WSL
  login, in 0.6–0.8 s per call.
- Orca's CLI (`resources\bin\orca.exe` beside the app) works once APPDATA is derived from USERPROFILE.
  `worktree list` takes about 2.1 s.
- `readContext` terminal ids are Orca CLI terminal handles. `orca terminal show --terminal <id> --json`
  returns the workspace's `worktreePath` (e.g. `\\wsl.localhost\Ubuntu\home\peterc\ccw`), which gives the
  distro and Linux path.
- Entire has `--json` on `status`, `trail list/show/approvals/finding`, and `trail watch --json`
  (the trail's SSE stream as JSON lines). `trail show` exits 1 when the branch has no trail.

## Architecture

- One `trusted-worker` plugin. The worker is the only part that talks to Entire.
- Find the focused workspace's path: first terminal handle from `readContext` → `orca terminal show`.
  Fallback: match branch and name against `orca worktree list`. This is a stopgap until `readContext`
  carries a path (see the asks below).
- Run Entire where the repo and its login live. For a WSL path, use
  `wsl.exe -d <distro> --cd <path> -e bash -lc 'exec entire "$@"' entire ...`. For a local path, run
  `entire` directly. For a paired server's workspace (a VPS), run this desktop's `entire` outside any
  checkout with `--repo <origin URL> --branch <branch>`: trails and findings live on Entire's server, so
  they read fine. Status, checkpoints and the diff need the checkout: the worker runs them over SSH to
  the server's Orca SSH target, with the key in the Windows ssh-agent. Without that, the panel says why.
- Shell out to the Entire CLI rather than calling its REST API. The CLI owns login, contexts and cell
  routing, so the plugin never holds a token. `entire api` covers gaps.
- Refresh the focused workspace on `agent.status.changed`, when focus moves to it or its branch
  changes (`workspace.changed`, plus a 5-second `readContext` poll for branch checkouts) and every
  5 minutes. The panel asks, the worker reads Entire only when its data for the workspace is older
  than the request allows, and the panel shows "Checking…" while a read runs. Later, tail
  `trail watch --json` while the worker is alive.
- Panels only render what the worker hands them: its in-memory snapshots (up to 10 workspaces,
  matched to the focused one by terminal id, then name and branch), through `entire.read` and
  `entire.data`. Feature-detect with `orca.host.has(...)` so a too-old Orca gets a clear message.
- Entire text (intent, findings, comments) is untrusted: render it as text and never execute it.

## GitHub feature → Entire equivalent

| Orca + GitHub today             | Entire equivalent                                  | Unblocked by                     |
| ------------------------------- | -------------------------------------------------- | -------------------------------- |
| PR and CI notifications         | trail events → notifications                       | shipped API                      |
| Create, approve, merge a PR     | `trail create`, `approve`, `merge` as commands     | shipped API                      |
| Checks sidebar, review comments | trail panel: gates, CI runs, findings, approvals   | Orca #25256                      |
| Issues on Tasks → new workspace | trails tab → start a workspace on the change       | Orca #26282                      |
| PR badge on the workspace card  | trail badge on the card                            | #26282, then a forge provider    |

For `et/` repos (`entire://` remotes, like this one) Orca has no forge integration at all, so this
plugin is the only one. For GitHub repos it sits beside Orca's GitHub support.

## Phases

- [x] 0. Repo on Windows, Entire enabled in WSL and on Windows, project added to Orca.
- [x] 0.5 Smoke test: load the dev plugin and run **Entire: Check connection** in a WSL workspace and in
      this one. Both reported connected in a Windows notification.
- [ ] 1. Spikes: real trail JSON fixtures (create a test trail), `trail watch` through `wsl.exe` versus
      the 5-minute reaper, the plugin consent flow, latency budget.
- [ ] 2. v0.1 on shipped Orca: commands (show trail, findings, approve, merge, create, refresh) and
      notifications when an agent finishes and on trail events.
- [ ] 3. Trail panel. A stopgap panel (repo status, the trail and its merge gates, recent
      checkpoints, connection check, a ↻ that works while the worker runs) works from a development
      folder. Trail #1 links `plugin-scaffold`; its JSON is `test/fixtures/trail-show.json`, and a
      reviewed, merged change is `test/fixtures/trail-367-*.json`. The Trail section follows Entire's
      web view (change, code review, merge gates, findings) from `trail show` and `trail finding list`,
      plus `git diff --shortstat` for the line counts. Not shown: the web view's Confidence, Risk,
      Drift and Security scores, which no CLI command or API type exposes. Since host API 1.2 the
      panel asks its worker for the data, so it works installed too.
- [ ] 4. Trails tab on the Tasks page and a settings form (Orca #26282).
- [ ] 5. Deeper: status bar item, forge provider for `entire://` remotes, Entire agent hooks and skills,
      checkpoints, `entire why`, `entire review`.
- [ ] 6. Distribution through Orca's community catalog (researched 2026-11-05). Community plugins
      are listed by machine, not reviewed: a public GitHub repo with `orca-plugin.json` at its root,
      the `orca-plugin` topic and a `vX.Y.Z` tag. Within about an hour the plugin shows at
      `onorca.dev/plugins/petercr/orca-entire-extension` and in `stablyai/orca-community-plugins`,
      pinned to the tag's commit and content hash. A listed version never changes, and a moved tag
      is refused. The official catalog (`stablyai/orca-plugins`) takes only Stably's own plugins.
      Exclusions: the validator fails, no license GitHub detects, binaries or symlinks, a publisher
      other than the repo owner, a fork, an archived repo, the listing policy (no paywall, no
      impersonation, no tracking, no obfuscated code). The Entire team has approved the name.
      Users get updates on their own unless one asks for more access (a capability, command, panel
      or event), which Orca makes them approve again.
  - [x] The panel asks its worker for data over host API 1.2 instead of reading a file the worker
        rewrites (branch `panel-channel`).
  - [x] Manifest: `engines.orca` `>=1.4.246`, no `publisher`, `license` MIT, `repository`; a
        `LICENSE` file.
  - [ ] Try the channel in Orca: approve `local.entire`, switch workspaces, ↻, let an agent finish,
        and leave Orca idle past 5 minutes so the worker stops and the panel's next request restarts it.
  - [ ] A README for users: what they need (Entire CLI installed and logged in where the repos live,
        Orca restarted after installing it), what the plugin runs (`entire`, `git`, `ssh`, `wsl.exe`),
        that it opts out of Entire's telemetry, what it reads of Orca's own files (the SSH targets in
        `profile-state.db`), and an install link,
        `https://onorca.dev/plugins/petercr.entire?catalog=community`.
  - [ ] Say which platforms work. Only Windows with WSL and a paired server is tried; reading SSH
        targets is Windows-only. Try macOS or Linux, or say so in the README.
  - [ ] Optional listing images: a cover (16:10, at least 800×500) and up to six screenshots (at
        least 1280×800) that show the real panel.
  - [ ] Release: bump `version` (0.1.0), `orca plugin validate .`, commit, `git tag -a v0.1.0 -m
        v0.1.0 && git push origin v0.1.0`, `gh repo edit petercr/orca-entire-extension --add-topic
        orca-plugin`, then check the listing page.

## Asks for the Orca team

1. ~~A channel from a panel to its own worker~~: shipped in host API 1.2 (Orca 1.4.246).
2. `workspace.readContext`: add the worktree id, path and host (local, WSL, SSH, paired server). For a
   paired server's workspace it now gives only the repo's name, with no branch or terminals.
3. Task sources and plugin settings (#26282), with a start recipe that can check out an existing branch.
4. Status bar items and sidebar cards (#23143, #26951).
5. Opening external URLs from panels and workers (#27568).
6. Long-lived worker subscriptions: the 5-minute idle reaper stops `trail watch`.
7. A way to run a command on the workspace's host (WSL, SSH, paired server) from a worker, without a
   terminal tab.

## Risks and open questions

- Phases 4–5 depend on Orca work: #26282 active (task sources; plugin settings shipped in 1.4.246),
  #15315 (forge providers) stale since August. Phase 3's channel shipped in host API 1.2.
- A paired server's workspace reaches `readContext` as its repo's display name, an empty branch and
  no terminals (seen 2026-11-01): the desktop runtime doesn't hold it. The worker matches the repo name
  against each paired server's `orca repo list` and `worktree list --environment`. Two worktrees of one
  repo on a server can't be told apart, and the panel says so. The Orca CLI runs commands there only in
  visible terminal tabs, so the worker uses its own SSH (2026-11-01): it needs the key in the Windows
  ssh-agent, and it finds the address in Orca's private profile database (`sshTargets`), whose shape
  Orca can change without notice. Ask #7 would remove both.
- Both sides run Entire 0.12.3-nightly. On Windows, `entire status` reports this repo's 7 Codex hooks
  as needing trust approval in Codex (`/hooks`); that only matters when using Codex here.
  `entire agent add codex` and `entire doctor` rewrite committed hook files, so run them on a branch.
- A worker's PATH comes from Orca's environment at launch. Restart Orca after installing Entire on
  Windows.
- Can #26282's start recipe check out an existing branch, or only branch off a base?
