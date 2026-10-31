# Entire for Orca

An Orca plugin that brings Entire trails, findings and checkpoints into Orca. The plan, the API limits
it works within, and the spike results are in [docs/PLAN.md](docs/PLAN.md).

## Try it

Requires Orca 1.4.245 or later, and the Entire CLI logged in wherever your repos live (WSL or Windows).

1. In a fresh clone, run `node scripts/create-panel.mjs`. Orca refuses the plugin until its panel file
   exists, and the worker writes that file.
2. In Orca, open **Settings → Plugins** and turn plugins on.
3. From the **⋯** menu, open **Development folders…**, add this folder, then review and enable
   **Entire**.
4. Focus a workspace and run **Entire: Refresh panel** from the command palette. Open the **Entire**
   panel (the layers icon) in the right sidebar: it shows the repo's Entire status, the branch's trail
   with its merge gates, recent checkpoints and the connection check. Once the plugin's worker is
   running, which it stays from the first command or finished agent until Orca quits, the panel
   checks Entire when you switch workspaces, when an agent finishes and every 5 minutes, and its ↻
   button checks now. Before that, the panel says to run the command.
5. **Entire: Check connection** runs the same check and reports it as a notification.

Orca runs a development folder in place and reloads it when its files change. The panel updates only
from a development folder: Orca refuses an installed copy whose files change. After editing the
worker, turn the plugin off and on so the next command starts a fresh worker.

## Develop

No build step yet: the worker is plain ES modules under `src/worker`.

```sh
node --test
```

To run the worker inside Orca's own runtime without the GUI (Windows, Orca installed):

```sh
node scripts/orca-harness/launch.mjs no-terminal
```

From WSL, run it with Windows Node (`node.exe`, or its full path under `/mnt/c` when Windows is not on
WSL's PATH) from the repo's `/mnt/c/...` path.
