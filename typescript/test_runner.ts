/**
 * runner.ts against its own CLI, out-of-process - there is nothing about
 * catalog discovery or task dispatch worth testing except "what does
 * `--list`/`run` actually print", so this drives the real command line
 * `node.rs` drives, the same way `src-tauri/src/node.rs`'s own test
 * ("the shipped catalog survives its own validator") reads runner.py's
 * source rather than importing it.
 *
 * Run with:
 *
 *     node --experimental-strip-types typescript/test_runner.ts
 */

import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const RUNNER = join(__dirname, 'runner.ts')

let failed = 0
function ok(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${label.padEnd(58)}${detail}`)
  if (!cond) failed++
}

/**
 * `script` defaults to the real runner.ts, but is a real parameter rather
 * than derived from `cwd` — a copy of runner.ts placed somewhere else (as
 * `testUserDiscovery` does) resolves `USER_DIR` from its own
 * `import.meta.url`, not from the process's working directory, so running
 * the *original* file against a *different* `cwd` would silently keep
 * reading the real repo's tasks/user/ regardless of what the test set up.
 */
function run(args: string[], script: string = RUNNER, cwd: string = __dirname) {
  return spawnSync(process.execPath, ['--experimental-strip-types', script, ...args], {
    cwd,
    encoding: 'utf8',
  })
}

function testList(): void {
  const res = run(['--list'])
  ok('--list exits 0', res.status === 0, `status ${res.status}, stderr: ${res.stderr}`)

  let catalog: unknown
  try {
    catalog = JSON.parse(res.stdout)
  } catch (e) {
    ok('--list prints parseable JSON', false, String(e))
    return
  }
  ok('--list prints parseable JSON', true)
  ok('the catalog is an array', Array.isArray(catalog))

  const list = catalog as Array<Record<string, unknown>>
  const watch = list.find((t) => t.id === 'task.watch')
  ok('task.watch is in the shipped catalog', watch !== undefined)
  if (watch) {
    ok('task.watch has a title', typeof watch.title === 'string' && watch.title.length > 0)
    ok('task.watch has a summary', typeof watch.summary === 'string' && watch.summary.length > 0)
    ok('task.watch is read-only, not "sends commands"', watch.kind === 'read-only')
  }

  // Every entry has the four fields the Rust side (`NodeTaskInfo`) and the
  // frontend (`nodeTasks.ts`'s `NodeTaskInfo`) both expect - a task missing
  // one would deserialize into `undefined` there rather than fail loudly.
  for (const t of list) {
    for (const field of ['id', 'title', 'summary', 'kind']) {
      ok(`${String(t.id)} has a ${field}`, typeof t[field] === 'string' && (t[field] as string).length > 0)
    }
  }
}

function testRunUnknown(): void {
  const res = run(['run', 'nope.nope'])
  ok('running an unknown id exits 2', res.status === 2, `status ${res.status}`)
  ok('the error names the id', res.stderr.includes('nope.nope'))
  ok('the error lists what does exist', res.stderr.includes('task.watch'))
}

function testUserDiscovery(): void {
  // A fresh tasks/user/ next to a copy of runner.ts and drtask.ts, so this
  // never touches the real one - discovery re-reads the folder on every
  // call, which is the whole point of it, and that means a test fixture
  // dropped into it is picked up exactly like a player's own file would be.
  const dir = mkdtempSync(join(tmpdir(), 'dr-companion-runner-test-'))
  try {
    writeFileSync(join(dir, 'runner.ts'), readFileSync(RUNNER, 'utf8'))
    const tasksDir = join(dir, 'tasks')
    const userDir = join(tasksDir, 'user')
    mkdirSync(userDir, { recursive: true })
    // A watch.ts is required by REGISTRY's task.watch entry (join(__dirname,
    // 'tasks', 'watch.ts')) even though this test never runs it - importing
    // the copied runner.ts fails at the top of catalog() otherwise. A stub
    // that never executes is enough.
    writeFileSync(join(tasksDir, 'watch.ts'), 'export {}\n')
    writeFileSync(
      join(userDir, 'smoke.ts'),
      '/**\n * A fixture, not a real task.\n */\nexport function main() { console.log("smoke ran") }\n'
    )
    writeFileSync(join(userDir, '_skipped.ts'), 'export function main() {}\n')

    const copy = join(dir, 'runner.ts')
    const list = run(['--list'], copy, dir)
    ok('a copied runner.ts still lists on --list', list.status === 0, list.stderr)
    const catalog = JSON.parse(list.stdout) as Array<Record<string, unknown>>
    ok('a fresh user/*.ts file is discovered as user.<stem>', catalog.some((t) => t.id === 'user.smoke'))
    ok(
      'its docstring becomes the summary',
      catalog.some((t) => t.id === 'user.smoke' && t.summary === 'A fixture, not a real task.')
    )
    ok(
      'a leading-underscore file is skipped, same as runner.py',
      !catalog.some((t) => t.id === 'user._skipped')
    )

    const ran = run(['run', 'user.smoke'], copy, dir)
    ok('running the discovered task exits 0', ran.status === 0, ran.stderr)
    ok('the task actually ran', ran.stdout.includes('smoke ran'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

testList()
testRunUnknown()
testUserDiscovery()

console.log('')
console.log(failed === 0 ? 'all checks OK' : `${failed} FAILED`)
process.exit(failed === 0 ? 0 : 1)
