# Entire for Orca

An Orca plugin that brings Entire trails, findings and checkpoints into Orca. The plan, the API limits
it works within, and the spike results are in [docs/PLAN.md](docs/PLAN.md).

## Try it

Requires Orca 1.4.245 or later, and the Entire CLI logged in wherever your repos live (WSL or Windows).

1. In Orca, open **Settings → Plugins** and turn plugins on.
2. Click **Development folders…**, add this folder, then review and enable **Entire**.
3. Focus a workspace and run **Entire: Check connection** from the command palette.

Orca runs a development folder in place and reloads it when its manifest changes. After editing the
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
