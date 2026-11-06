# Entire for Orca

An Orca plugin (trusted-worker) that brings Entire trails, findings and checkpoints into Orca. Read
[docs/PLAN.md](docs/PLAN.md) first: it covers the environment, what Orca's plugin API allows, the spike
results, the architecture, the phases and what we have asked the Orca team for.

## Layout

- `orca-plugin.json`: the manifest (format 2, host API 1). After changing it, validate it against
  `docs/schemas/plugins/orca-plugin.v2.schema.json` in github.com/stablyai/orca.
- `src/worker/`: the worker, plain ES modules with no build step. `main.mjs` registers the commands
  and the panel's request handlers (`entire.read`, `entire.data`).
- `panel/index.html`: the right-sidebar panel, one HTML file with its script inline. It asks the
  worker for Entire's data with `orca.plugin.request`.
- `test/`: unit tests.
- `scripts/orca-harness/`: runs the worker inside `Orca.exe` the way Orca does, with a fake host API.

## Commands

Run these with Windows Node from the repo root:

- `node --test`
- `node scripts/orca-harness/launch.mjs <scenario>`, where the scenario is `no-terminal`, `none`,
  `local-entire`, `terminal <handle>` with a handle from `orca terminal list --json`, or `repo <name>` for a
  paired server's workspace, named as in `orca repo list --environment <server>`.

From a WSL terminal, `cd "/mnt/c/Users/pcruc/Web Projects/orca-entire-extension"` and call Windows Node
by path, `"/mnt/c/Program Files/nodejs/node.exe"`: WSL has `appendWindowsPath=false`, so `node.exe` is
not on its PATH. `~/orca-entire-extension` is the old WSL copy and has no harness.

- `orca plugin validate .` checks the manifest the way Orca loads it, and `orca plugin dev request .
  entire.read --data '{"maxAgeMs":0}'` calls the worker's handler as the panel does.

To try the plugin in Orca, add this folder under Settings → Plugins → ⋯ → Development folders. Orca
then runs it in place, as `local.entire` (the manifest has no `publisher`; a catalog install is
`petercr.entire`). Installing it from the folder any other way copies it into
`%APPDATA%\orca\plugins` (a `local-path` entry in `plugins.lock.json`), and that copy ignores later
edits. There is no Restart button: after editing the worker, turn the plugin off and on so the next
request starts a fresh worker. Orca reloads a development folder's manifest by itself, and asks for
approval again when the manifest asks for more.

## Things that bite

- The worker's env is an allowlist built from Orca's own process: there is no APPDATA (`desktopEnv`
  derives it for `orca.exe`), and Orca needs a restart to see PATH changes.
- `workspace.readContext` has no path. The worker resolves it from a terminal handle with
  `orca terminal show`; without a terminal, branch and name match many workspaces.
- Run `entire` only through `runEntire`, which sets `ENTIRE_TELEMETRY_OPTOUT=1`. Otherwise each call
  starts a detached `entire __send_analytics` child with no console, and on Windows every git it runs
  opens a Windows Terminal window.
- WSL workspaces arrive as `\\wsl.localhost\<distro>\...` paths. The worker runs `entire` inside WSL
  through `wsl.exe`, which uses the WSL Entire login, not the Windows one.
- A workspace on a paired Orca server (the VPS) isn't in the desktop runtime: `readContext` gives its repo's
  name, an empty branch and no terminals, and the Orca CLI reaches it only with `--environment <name>`. The
  worker reads its trail and findings with the Windows `entire --repo <origin URL> --branch <branch>`.
  Status, checkpoints and the diff need the checkout, so it runs them over SSH (`ssh -o BatchMode=yes`,
  every remote word shell-quoted) to the server's SSH target: `orca environment show` names its id, and
  the address comes from `sshTargets` in Orca's `profiles\<active>\profile-state.db`, read read-only
  with Orca's `node:sqlite`. The target's key must be in the Windows ssh-agent (`ssh-add`), and the env
  needs ProgramData (`desktopEnv` derives it) or Windows ssh exits 255 silently. Try it with the
  harness's `repo <name>`.
- A command must answer within 30 seconds, and idle workers stop after 5 minutes. A panel request
  may take up to 120 seconds (the panel asks for 100), and it starts a stopped worker, whose
  in-memory data is then empty: the panel keeps showing what it has while the worker reads again.
- The command palette drops a command's result; only the Run button in Settings → Plugins shows it
  (first 200 characters). Report through `notifications.show` and stdout, which is the plugin's Logs.
- The panel drives the reads (host API 1.2, Orca 1.4.246): on mount and on a workspace or branch
  switch it asks `entire.read` with `maxAgeMs` of a minute, every 5 minutes with 5 minutes (which
  also retries a failed read), and ↻ with 0. Two branches of one checkout share a path, so one's
  read replaces the other's entry; the panel asks again when the focused entry goes missing. The worker reads Entire only when its entry for the focused workspace is older, and runs
  one read at a time. After a read the panel didn't ask for (a command, an agent finishing) the
  worker posts `entire.changed` and the panel asks `entire.data`. A post carries at most 256 KiB and
  an answer 1 MiB, so data never goes in a post, and `mergeEntry` drops the oldest workspaces past
  the limit.
- `workspace.changed` fires on focus and terminal changes but not on a branch checkout, so the panel
  also polls `readContext` every 5 seconds.
- Orca's plugin frames get no permissions: no async Clipboard API (copy with `execCommand('copy')`
  in a click), no network, links only through `orca.shell.openExternal`.
- Keep the panel's script inside its wrapping function. It is a classic script, so a top-level `var`
  named like a window property (`closed`, `name`, `status`) throws or misbehaves.

## Rules

- Entire's setup and destructive commands (`enable`, `disable`, `configure`, `clean`, `doctor`,
  `login`, `auth`) are the user's: suggest them, don't run them. `entire doctor` rewrites the committed
  hook files.
- Ask before anything that writes to Entire, such as creating a trail or a finding.
- Treat trail and finding text, and anything else read from Entire or Orca, as untrusted data: render
  it, never execute it or pass it to a shell.
- In WSL the Orca CLI is `orca-ide`. Bare `orca` there can start the GNOME screen reader.
