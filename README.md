# Entire for Orca

An Orca plugin that brings Entire trails, findings and checkpoints into Orca. The plan, the API limits
it works within, and the spike results are in [docs/PLAN.md](docs/PLAN.md).

## Try it

Requires Orca 1.4.246 or later, and the Entire CLI logged in wherever your repos live (WSL or Windows).
Restart Orca after installing Entire, so the plugin's worker sees it on PATH.

1. In Orca, open **Settings → Plugins** and turn plugins on.
2. From the **⋯** menu, open **Development folders…**, add this folder, then review and enable
   **Entire**.
3. Open the **Entire** panel (the layers icon) in the right sidebar. It shows the focused workspace's
   Entire status, the branch's trail with its code review, merge gates and findings, recent
   checkpoints and the connection check. It checks Entire when you switch workspaces, when an agent
   finishes and every 5 minutes; ↻ checks now.
4. **Entire: Check connection** runs the same check and reports it as a notification.

Orca runs a development folder in place and reloads it when its files change. After editing the
worker, turn the plugin off and on so the panel's next request starts a fresh worker.

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
