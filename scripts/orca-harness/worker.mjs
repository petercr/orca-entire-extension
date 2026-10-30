// Runs inside Orca.exe with ELECTRON_RUN_AS_NODE=1, like Orca's plugin worker, with a fake host API.
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'

const [pluginRoot, scenario, terminal] = process.argv.slice(2)
const load = (file) => import(pathToFileURL(join(pluginRoot, 'src', 'worker', file)).href)

// What workspace.readContext returns in each scenario.
const contexts = {
  terminal: { branch: 'main', displayName: 'main', terminals: [{ id: terminal }] },
  'no-terminal': { branch: 'main', displayName: 'main', terminals: [] },
  none: null
}

if (scenario === 'local-entire') {
  // Resolution needs a terminal in a Windows workspace; check the local runner directly instead.
  const { runEntire, failureLine } = await load('entire-cli.mjs')
  const result = await runEntire({ kind: 'local', path: pluginRoot }, ['status', '--json']).catch((error) => ({ error }))
  console.log(result.error ? `✗ spawn: ${result.error.message}` : result.code === 0 ? `✓ local entire status (${result.ms} ms): ${result.stdout.slice(0, 160)}` : `✗ ${failureLine(result)}`)
} else if (!Object.hasOwn(contexts, scenario) || (scenario === 'terminal' && !terminal)) {
  console.log('Scenarios: terminal <handle>, no-terminal, none, local-entire')
  process.exitCode = 1
} else {
  const { default: activate } = await load('main.mjs')
  const commands = new Map()
  activate({
    api: { major: 1, minor: 0 },
    host: {
      has: () => true,
      call: async (method, params) => {
        if (method === 'workspace.readContext') return contexts[scenario]
        if (method === 'notifications.show') {
          console.log(`[notification] ${params.title}`)
          return { delivered: true }
        }
        throw new Error(`unexpected host call ${method}`)
      }
    },
    commands: { register: (id, handler) => (commands.set(id, handler), { dispose() {} }) },
    events: { on: () => ({ dispose() {} }) },
    log: console.log
  })
  // The command logs its own report, which is what Orca shows under the plugin's Logs.
  await commands.get('doctor')(undefined, { signal: new AbortController().signal })
}
