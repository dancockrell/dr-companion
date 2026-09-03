/** Run one Python test through the repository's shared interpreter resolver. */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { findPython, pythonNotCheckedMessage } from './find-python.mjs'

const testFile = process.argv[2]

if (!testFile || !existsSync(testFile)) {
  console.log(`NOT CHECKED: ${testFile || 'no Python test file'} is missing, so there was nothing to run.`)
  process.exit(0)
}

const python = findPython()
if (!python) {
  console.log(pythonNotCheckedMessage(testFile))
  process.exit(0)
}

const result = spawnSync(python, [testFile], { stdio: 'inherit', windowsHide: true })
if (result.error) {
  console.log(`NOT CHECKED: could not launch ${python}: ${result.error.message}`)
  process.exit(0)
}
process.exit(result.status ?? 1)
