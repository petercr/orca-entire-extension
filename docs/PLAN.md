# Entire for Orca: plan

Bring Entire (trails, findings, approvals, checkpoints) into Orca's UI as an Orca plugin, the way
Orca already surfaces GitHub pull requests and checks.

Status: phases 0 and 0.5 done, and a stopgap Entire panel works from a development folder. Next:
phase 1 spikes.

## Environment

- Orca desktop runs on Windows (1.4.245). Plugins are in alpha: manifest format 2, host API 1.0.
- Most Orca and Entire projects live in WSL (`\\wsl.localhost\Ubuntu\...`). Orca also has an SSH host.
- Entire CLI `0.12.3-nightly` on both sides: WSL (keyring login) and Windows in `%USERPROFILE%\.local\bin`
  (Credential Manager login).
- This repo: `C:\Users\pcruc\Web Projects\orca-entire-extension`, origin
  `entire://aws-us-east-2.entire.io/et/entire-repos/orca-entire-extension`, Entire enabled.

## What Orca's plugin API allows today (1.4.245)

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
- Panels are sealed: Orca injects CSP `connect-src 'none'` (scripts and styles inline only, images
  as data URLs), blocks links and `window.open`, and gives a panel no channel to its own worker. A
  panel can call only `workspace.readContext` and `notifications.show`, and loads one HTML file.
- Stopgap: Orca rereads a development folder's panel file whenever the folder changes and remounts
  the panel when the HTML differs. Writing a file there neither restarts the worker nor asks for
  approval again (only shortcuts and VM recipes tie approval to file bytes). So the worker writes its
  data into the panel file. Installed copies are hash-checked and refused once a byte changes, so
  this works only from a development folder.
- Stopgap for the panel's ↻: a panel's only mutation is `notifications.show`, which Orca records in
  `plugins-data\audit.log` as `titleChars=<n>`. The button shows a notification with a title length
  no worker notice uses, and a running worker watches the log. Orca's 5-minute idle timer resets on
  the worker's own host calls, so once started the worker calls `readContext` every 5 seconds and
  stays up with Orca. A keyboard shortcut is no way out: in
  a development folder, keybindings tie approval to every file, so each panel write would need a new
  review.
- Reserved but not shipped: `taskSources`, `statusBarItems`, `sidebarCards`, `connections`, `settings`,
  `hooks`, `skills`, `mcpServers`.
- The installed build has no `orca plugin ...` CLI (it is on Orca's `main`). Load the plugin through
  Settings → Plugins → Development folders.
- On 1.4.245 the manifest must keep `publisher` (leaving it out needs `>=1.4.246`). When distributing,
  it must equal the GitHub owner of the repository Orca installs from. Ids may not start with `orca-`.

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
  `entire` directly. SSH workspaces come later.
- Shell out to the Entire CLI rather than calling its REST API. The CLI owns login, contexts and cell
  routing, so the plugin never holds a token. `entire api` covers gaps.
- Refresh the focused workspace on `agent.status.changed`, when focus moves to it (no event says so:
  the worker polls `readContext` every 5 seconds) and every 5 minutes. The 5-minute and agent
  refreshes write the panel only when Entire's data changed, since each write remounts it; after a
  switch the panel shows "Checking…" until the worker rewrites it. Later, tail
  `trail watch --json` while the worker is alive.
- Panels only render what the worker hands them. Today that is the panel file the worker writes
  (`panel/entire.html`, up to 10 workspaces, matched to the focused one by terminal id, then name
  and branch). Swap to the panel → worker channel when Orca ships it. Feature-detect with
  `orca.host.has(...)` so one build runs on shipped and newer Orca.
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
      Drift and Security scores, which no CLI command or API type exposes. A live, installable panel
      needs a panel → worker channel (Orca #25256).
- [ ] 4. Trails tab on the Tasks page and a settings form (Orca #26282).
- [ ] 5. Deeper: status bar item, forge provider for `entire://` remotes, Entire agent hooks and skills,
      checkpoints, `entire why`, `entire review`.
- [ ] 6. Distribution: a GitHub mirror (Orca installs over https Git and derives the publisher from the
      owner), then a catalog listing.

## Asks for the Orca team

1. A channel from a panel to its own worker (#25256, or a push channel). It blocks any live panel.
2. `workspace.readContext`: add the worktree id, path and host (local, WSL, SSH).
3. Task sources and plugin settings (#26282), with a start recipe that can check out an existing branch.
4. Status bar items and sidebar cards (#23143, #26951).
5. Opening external URLs from panels and workers (#27568).
6. Long-lived worker subscriptions: the 5-minute idle reaper stops `trail watch`.
7. A way to run a command on the workspace's host (WSL, SSH) from a worker.

## Risks and open questions

- Phases 3–5 depend on unmerged Orca PRs: #25256 quiet since Oct 7, #26282 active, #15315 (forge
  providers) stale since August.
- The WSL bridge does not cover SSH workspaces.
- Both sides run Entire 0.12.3-nightly. On Windows, `entire status` reports this repo's 7 Codex hooks
  as needing trust approval in Codex (`/hooks`); that only matters when using Codex here.
  `entire agent add codex` and `entire doctor` rewrite committed hook files, so run them on a branch.
- A worker's PATH comes from Orca's environment at launch. Restart Orca after installing Entire on
  Windows.
- Can #26282's start recipe check out an existing branch, or only branch off a base?
