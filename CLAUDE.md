# Entire for Orca

An Orca plugin (trusted-worker) that brings Entire trails, findings and checkpoints into Orca. Read
[docs/PLAN.md](docs/PLAN.md) first: it covers the environment, what Orca's plugin API allows, the spike
results, the architecture, the phases and what we have asked the Orca team for.

## Layout

- `orca-plugin.json`: the manifest (format 2, host API 1). After changing it, validate it against
  `docs/schemas/plugins/orca-plugin.v2.schema.json` in github.com/stablyai/orca.
- `src/worker/`: the worker, plain ES modules with no build step. `main.mjs` registers the commands.
- `panel/template.html`: the right-sidebar panel. The worker writes it, with Entire's data, to
  `panel/entire.html` (gitignored). In a fresh clone, run `node scripts/create-panel.mjs` first: Orca
  refuses a plugin whose panel file is missing.
- `test/`: unit tests.
- `scripts/orca-harness/`: runs the worker inside `Orca.exe` the way Orca does, with a fake host API.

## Commands

Run these with Windows Node from the repo root:

- `node --test`
- `node scripts/orca-harness/launch.mjs <scenario>`, where the scenario is `no-terminal`, `none`,
  `local-entire`, or `terminal <handle>` with a handle from `orca terminal list --json`.

From a WSL terminal, `cd "/mnt/c/Users/pcruc/Web Projects/orca-entire-extension"` and call Windows Node
by path, `"/mnt/c/Program Files/nodejs/node.exe"`: WSL has `appendWindowsPath=false`, so `node.exe` is
not on its PATH. `~/orca-entire-extension` is the old WSL copy and has no harness.

To try the plugin in Orca, add this folder under Settings → Plugins → ⋯ → Development folders. Orca
then runs it in place. Installing it from the folder any other way copies it into
`%APPDATA%\orca\plugins` (a `local-path` entry in `plugins.lock.json`), and that copy ignores later
edits. There is no Restart button: after editing the worker, turn the plugin off and on so the next
command starts a fresh worker. Orca reloads a development folder's manifest by itself.

## Things that bite

- The worker's env is an allowlist built from Orca's own process: there is no APPDATA (`desktopEnv`
  derives it for `orca.exe`), and Orca needs a restart to see PATH changes.
- `workspace.readContext` has no path. The worker resolves it from a terminal handle with
  `orca terminal show`; without a terminal, branch and name match many workspaces.
- WSL workspaces arrive as `\\wsl.localhost\<distro>\...` paths. The worker runs `entire` inside WSL
  through `wsl.exe`, which uses the WSL Entire login, not the Windows one.
- A command must answer within 30 seconds, and idle workers stop after 5 minutes.
- The command palette drops a command's result; only the Run button in Settings → Plugins shows it
  (first 200 characters). Report through `notifications.show` and stdout, which is the plugin's Logs.
- A panel has no channel to its worker. Orca rereads a development folder's panel file when the folder
  changes, so the worker writes its data into `panel/entire.html`. Orca hashes installed copies and
  refuses changed ones, so `updatePanel` never writes there, and the panel fills in only from a
  development folder.
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
