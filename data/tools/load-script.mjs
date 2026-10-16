/*
 * Load the Ceres survey script (questionnaire/v3/script.js) in node.
 * script.js sets window.CERES_SCRIPT = { chapters, steps, templates, ui, ... }. It runs here in a sandbox with its own
 * `window`, and the result is copied out as plain JSON (the script holds data only, no functions).
 */
import { existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import vm from 'node:vm'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const DATA_DIR = path.resolve(HERE, '..')
// a hand-over copy carries the script in source/; the working tree reads it from questionnaire/v3
const LOCAL_SCRIPT = path.resolve(DATA_DIR, 'source/script.js')
export const SCRIPT_PATH = existsSync(LOCAL_SCRIPT) ? LOCAL_SCRIPT : path.resolve(DATA_DIR, '../questionnaire/v3/script.js')

/** { script, sha256, file }: the parsed script and the sha256 of the file's bytes. */
export function loadScript(file = SCRIPT_PATH) {
  const bytes = readFileSync(file)
  const sandbox = { window: {} }
  vm.runInNewContext(bytes.toString('utf8'), sandbox, { filename: path.basename(file) })
  const script = JSON.parse(JSON.stringify(sandbox.window.CERES_SCRIPT))
  return { script, sha256: createHash('sha256').update(bytes).digest('hex'), file }
}
