# Entire for Orca

![An orca in an Entire T-shirt splashes beside the words Entire for Orca ADE: bring the power of Entire into Orca ADE, with trails, findings and checkpoints. Marked unofficial.](images/banner.jpg)

An [Orca](https://onorca.dev) plugin that shows [Entire](https://entire.com) trails, findings and checkpoints
for the workspace you're working in, in a panel beside your terminals. It gives Entire the place in Orca
that GitHub pull requests and checks already have.

It's a community plugin. It only reads, except for the panel's **Approve** and **Merge** buttons,
which write to Entire only when you click and then confirm. It never creates or changes anything else.

## What you get

**The Entire panel** (the layers icon in the right sidebar) follows the focused workspace and shows:

- the repo's Entire status and any active agent sessions
- the branch's trail: its change, the code review, the merge gates (approvals, checks, findings, up to
  date) and the findings, each of which you can copy, one at a time or all together
- the repo's other open changes, when it has several trails or pull requests in flight: a list above
  the trail, one row per open change with its branch and merge state. Pick one to see it in full and
  act on it, whichever branch is checked out. The panel checks the newest 10 open trails, and when
  that runs long it shows the ones read in time and says how many it skipped.
- **Approve** and **Merge** buttons for the shown change. Each asks you to click again to confirm.
  Merge stays greyed out until the change is approved (when the repo needs approvals), no blocking
  gate is failing or pending, and there are no conflicts; the line under it says what it's waiting on.
  Entire checks the gates again before it merges, and the plugin never forces a merge.
- the branch's recent checkpoints
- a connection check that says what worked and what didn't

It reads Entire when you switch workspaces or branches, when an agent finishes, and every 5 minutes.
↻ reads it now. **Report a problem on GitHub**, at the bottom of the panel, opens a new issue here with
the versions filled in.

**Commands** in the command palette:

- **Entire: Check connection** runs the same check and reports it as a notification.
- **Entire: Refresh panel** reads Entire for the focused workspace now.

## Requirements

- **Orca 1.4.246 or later.**
- **The Entire CLI, installed and logged in where your repos live:**
  - Repos on this computer: Entire on the PATH Orca starts with.
  - Repos in WSL: Entire inside that WSL distro, logged in there. The plugin runs it through `wsl.exe`
    in a login shell, so `~/.local/bin` counts.
  - Repos on a paired Orca server: Entire on this computer, logged in to an account that can see the
    repository, for the trail and findings. For status and checkpoints, the plugin also needs SSH to the
    server (see [Paired servers](#paired-servers)).
- **Entire enabled in the repo** (`entire enable`) for its status and checkpoints. A repo without it
  still shows its trail.
- **Restart Orca after installing Entire**, so the plugin sees it on PATH.

## Install

Turn on plugins in **Settings → Plugins** if they're off. Then open the plugin in Orca's community
catalog, <https://onorca.dev/plugins/petercr.entire?catalog=community>, and install it. Orca shows
what the plugin asks for before you approve it:

- **Workspace (read):** which workspace is focused, its branch and its terminals, to know which repo to
  read.
- **Notifications:** for **Entire: Check connection** and for problems found by **Entire: Refresh
  panel**.
- **Agents (read):** to read Entire again when an agent finishes.

Then open the **Entire** panel.

## Platforms

| Where the workspace is | Status                                                                       |
| ---------------------- | ---------------------------------------------------------------------------- |
| Windows                | Tested                                                                       |
| WSL, from Windows      | Tested                                                                       |
| A paired Orca server   | Tested from Windows. Status and checkpoints over SSH work on Windows only.   |
| macOS, Linux           | Not tested. Finding the workspace expects Orca's CLI where Windows has it, so it may fail; reports welcome. |

## Paired servers

Orca tells plugins only the repo name of a workspace on a paired server, with no branch or path. The
plugin finds it in the server's worktree list, then:

- reads the trail and findings with this computer's Entire, by the repo's origin URL and branch;
- reads status, checkpoints and the diff size over SSH to the server, using the address Orca saved
  for it. SSH runs with `BatchMode`, so it can't ask for a passphrase: add the key to the ssh-agent
  (`ssh-add`) first.

If the plugin can't reach the server, the panel shows the trail and findings and says why the rest is
missing. Two worktrees of one repo on the same server look alike to plugins, and the panel says so.

## What it runs and reads

The plugin runs everything from Orca's plugin worker on this computer, as you:

- `entire`: `--version`, `status`, `trail show`, `trail finding list` and `checkpoint list`, all
  read-only, with `--json`. From the panel's confirmed buttons only: `trail approve <number> --branch
  <branch>` and `trail merge <number> --branch <branch>`, never with `--force`. It sets
  `ENTIRE_TELEMETRY_OPTOUT=1`, so its calls send Entire no usage analytics.
- `git diff --shortstat` against the trail's base branch, for the line counts.
- Orca's own CLI (`terminal show`, `worktree list`, `repo list`, `environment show`), to find the
  focused workspace's path.
- `wsl.exe` for WSL workspaces, and `ssh` for paired servers.
- On Windows, for paired servers only: the saved SSH targets in Orca's profile database
  (`%APPDATA%\orca\profiles\<profile>\profile-state.db`), opened read-only.

It keeps what it reads in memory for the last 10 workspaces and stores nothing on disk. The panel
itself has no network access. Text from Entire, such as finding bodies, is shown as text and never
run.

**Report a problem on GitHub** opens your browser on a new issue in this repo, through Orca, which
asks you first. The link carries the plugin's version, Orca's plugin API version, your OS, the Entire
CLI's version and whether the workspace is local, in WSL or on a paired server. It carries no paths,
repo names or branches, and nothing is sent until you submit the issue.

## Troubleshooting

- **"Open a terminal in it and try again":** without a terminal, the plugin knows a workspace only by
  its name and branch, and many repos share `main`. A terminal in the workspace tells it which one.
- **Entire not found, or an old version:** restart Orca after installing or updating Entire.
- **"SSH to … failed" on a paired server:** add the server's key to the ssh-agent with `ssh-add`.
- **"repository not on Entire for this computer's login":** log this computer's Entire in to an
  account that can see the repository.
- **More detail:** run **Entire: Check connection**, or open the plugin's **Logs** in **Settings →
  Plugins**. Each read writes its report there.
- **Still stuck:** use **Report a problem on GitHub** in the panel, or
  [open an issue](https://github.com/petercr/orca-entire-extension/issues/new/choose).

## Develop

No build step: the worker is plain ES modules under `src/worker`, and the panel is `panel/index.html`.

```sh
node --test
```

To run a working copy in Orca, open **Settings → Plugins**, choose **Development folders…** from the
**⋯** menu, add this folder, then review and enable **Entire**. Orca runs the folder in place and
reloads it when its files change. After editing the worker, turn the plugin off and on so the panel's
next request starts a fresh worker.

To run the worker inside Orca's own runtime without the GUI (Windows, Orca installed):

```sh
node scripts/orca-harness/launch.mjs no-terminal
```

From WSL, run it with Windows Node (`node.exe`, or its full path under `/mnt/c` when Windows is not on
WSL's PATH) from the repo's `/mnt/c/...` path.

The plan, the limits of Orca's plugin API it works within, and the spike results are in
[docs/PLAN.md](docs/PLAN.md).

## License

[MIT](LICENSE)
