// Orca refuses a plugin whose panel entry is missing, and the worker generates panel/entire.html.
// Run this once in a fresh clone, before adding the folder to Orca: node scripts/create-panel.mjs
import { PANEL, ensurePanel } from '../src/worker/panel.mjs'

console.log((await ensurePanel()) ? `Created ${PANEL}` : `${PANEL} already exists`)
