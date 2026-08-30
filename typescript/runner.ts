/**
 * The catalog of runnable TypeScript tasks, and the one way to run one.
 *
 *     node runner.ts --list          what can be run, as JSON
 *     node runner.ts run task.watch  run one
 *
 * Direct counterpart to `python/runner.py` - same two commands, same JSON
 * shape on `--list` (`{id, title, summary, kind}[]`), same id scheme
 * (`user.<filename>` for anything a player saves in `tasks/user/`), same
 * reason for existing: a file is not a unit of work, an id is, and this is
 * the one place that maps ids to what actually runs. The app's Rust side
 * (`src-tauri/src/node.rs`) shells out to this exactly as
 * `src-tauri/src/python.rs` shells out to `runner.py`, so a player's task
 * list is never something the frontend keeps in sync by hand.
 *
 * # Adding your own
 *
 * Save a `.ts` file in `tasks/user/`. That is the whole procedure - discovered
 * fresh on every `--list`/`run`, so a script you edit and save runs in its new
 * form on the next press, no restart. The id is `user.<filename>`, the first
 * line of the file's opening `/** ... *``/` comment becomes the summary the
 * app shows.
 *
 * A user file can either do its work at the top level (like `tasks/watch.ts`
 * does today - `await watch.run()` as the last line) or export a `main`
 * function, a `TASK` value, or a `task` value - the same three shapes
 * `runner.py` accepts, checked in the same order, for the same reason: all
 * three are things a player reasonably writes, and forcing one shape on
 * everyone is a worse rule than accepting all three.
 *
 * # Why dynamic `import()`, not a require table
 *
 * A module import in Node runs the module's top-level code exactly once and
 * caches the result - which is backwards for an editor. `tasks/user/x.ts`
 * edited and saved between two runs must run the *new* file the second time,
 * not a cached first import. Node has no per-call `importlib.util` escape
 * hatch the way Python does, so this appends a `?t=<timestamp>` cache-buster
 * to the specifier on every dynamic import, which is the documented way to
 * defeat the ESM module cache for a file that is expected to change on disk.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

type TaskEntry = {
  title: string
  summary: string
  kind: 'read-only' | 'sends commands'
  run: () => Promise<unknown>
}

/** Fresh import every call - see the module header for why. */
function importFresh(path: string): Promise<unknown> {
  return import(`${pathToFileURL(path).href}?t=${Date.now()}`)
}

//: id -> task. The order is the order the app shows, same convention as
//: runner.py's REGISTRY.
const REGISTRY: Record<string, TaskEntry> = {
  'task.watch': {
    title: 'Watch',
    summary: 'Read-only. Reports what it sees, sends nothing.',
    kind: 'read-only',
    run: () => importFresh(join(__dirname, 'tasks', 'watch.ts')),
  },
}

//: Where a player's own TypeScript tasks live. Anything here is discovered,
//: so writing a file is the whole of installing it - no line to add, no
//: restart. Direct counterpart to runner.py's USER_DIR.
const USER_DIR = join(__dirname, 'tasks', 'user')

/** First line of the file's opening block comment, if it has one. */
function docSummary(text: string): string {
  const head = text.trimStart()
  if (!head.startsWith('/**') && !head.startsWith('/*')) return ''
  const end = head.indexOf('*/')
  const body = end === -1 ? head.slice(2) : head.slice(2, end)
  const firstLine = body
    .split('\n')
    .map((l) => l.replace(/^\s*\*?\s?/, '').trim())
    .find((l) => l.length > 0)
  return firstLine ?? ''
}

async function runUser(path: string): Promise<unknown> {
  const mod = (await importFresh(path)) as Record<string, unknown>
  // Three shapes, same order as runner.py: a `main`, a `TASK`, a `task`. A
  // bare script that already did its work at import (like watch.ts) falls
  // through all three, which is correct - there is nothing left to call.
  for (const attr of ['main', 'TASK', 'task']) {
    const thing = mod[attr]
    if (thing === undefined) continue
    const result = typeof thing === 'function' ? await (thing as () => unknown)() : thing
    if (result && typeof (result as { run?: unknown }).run === 'function') {
      return (result as { run: () => unknown }).run()
    }
    return result
  }
  return undefined
}

function userTasks(): Record<string, TaskEntry> {
  const found: Record<string, TaskEntry> = {}
  if (!existsSync(USER_DIR)) return found
  const files = readdirSync(USER_DIR)
    .filter((f) => f.endsWith('.ts') && !f.startsWith('_'))
    .sort()
  for (const file of files) {
    const stem = file.slice(0, -3)
    const path = join(USER_DIR, file)
    let summary = ''
    try {
      summary = docSummary(readFileSync(path, 'utf8'))
    } catch {
      // Unreadable file: still listed, with a generic summary rather than
      // dropped - a task a player cannot see is a task they cannot fix.
    }
    found[`user.${stem}`] = {
      title: stem.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      summary: summary || 'Your script.',
      kind: 'sends commands',
      run: () => runUser(path),
    }
  }
  return found
}

function catalog(): { id: string; title: string; summary: string; kind: string }[] {
  const all = { ...REGISTRY, ...userTasks() }
  return Object.entries(all).map(([id, t]) => ({
    id,
    title: t.title,
    summary: t.summary,
    kind: t.kind,
  }))
}

async function main(argv: string[]): Promise<number> {
  if (argv.includes('--list')) {
    console.log(JSON.stringify(catalog(), null, 2))
    return 0
  }

  if (argv.length >= 2 && argv[0] === 'run') {
    const taskId = argv[1]
    const all = { ...REGISTRY, ...userTasks() }
    const task = all[taskId]
    if (!task) {
      console.error(`No task called ${JSON.stringify(taskId)}. Available:`)
      for (const known of Object.keys(all)) console.error(`  ${known}`)
      return 2
    }
    await task.run()
    return 0
  }

  console.log('TypeScript task catalog and runner. Use:')
  console.log('  node runner.ts --list          what can be run, as JSON')
  console.log('  node runner.ts run <id>        run one')
  console.log()
  const all = { ...REGISTRY, ...userTasks() }
  for (const [id, t] of Object.entries(all)) {
    console.log(`  ${id.padEnd(24)} ${t.title} - ${t.summary}`)
  }
  return 1
}

const code = await main(process.argv.slice(2))
if (code !== 0) process.exit(code)
