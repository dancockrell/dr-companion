/**
 * A Tauri command that builds a window must be `async fn`.
 *
 * # The defect this exists for
 *
 * Issue #419. `open_panel_window` was a synchronous `#[tauri::command]`, and a
 * synchronous command runs on the main thread — which is the event loop's
 * thread. `WebviewWindowBuilder::build()` dispatches the creation onto that
 * loop and then blocks waiting for the answer, so the loop can never deliver
 * it. Measured on the packaged build: the window and its WebView2 were
 * created, `build()` never returned, the navigation to
 * `index.html?view=panel&id=…` was therefore never issued, and the pop-out sat
 * on `about:blank` — a white window, forever, with the invoke promise still
 * pending 67 seconds later and nothing anywhere for the frontend to show.
 *
 * Nothing in the type system or the compiler says this. It is a runtime
 * property of the runtime, it is invisible in `cargo test` (no event loop),
 * and it is invisible in `tauri dev` only in the sense that it is equally
 * broken there — the whole failure is silent by construction, because a
 * command that never returns and a command that is merely slow look identical.
 *
 * # What is asserted
 *
 * Every `#[tauri::command]` whose body constructs a window builder is `async`.
 * Both lists are derived from the source rather than written down here, so a
 * command added tomorrow is covered without anyone remembering this file.
 *
 * The denominator is the fragile thing: a parser that stops recognising
 * commands, or a rename of `WebviewWindowBuilder`, would leave "0 of 0
 * window-building commands are async", which is what a broken check says. So
 * this refuses to pass unless it parsed a plausible number of commands *and*
 * found at least one that builds a window.
 *
 * Sabotage: drop the `async` from `open_panel_window` in
 * `src-tauri/src/lib.rs`. This must go red naming that command.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.env.DRC_TAURI_SRC || 'src-tauri/src'

/** Every command in the crate must be seen; well below the real count. */
const MIN_COMMANDS = 40

/** The builders that create a window, and therefore need the event loop. */
const WINDOW_BUILDERS = ['WebviewWindowBuilder', 'WindowBuilder']

let pass = 0
let fail = 0
function ok(label, condition) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`)
  if (condition) pass++
  else fail++
}

function rustFiles(dir) {
  const out = []
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const name of entries) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...rustFiles(full))
    else if (name.endsWith('.rs')) out.push(full)
  }
  return out
}

/**
 * The body between the first `{` at or after `from` and its matching `}`.
 *
 * Deliberately not a regex: a command body contains braces, and a
 * fixed-size window over the source is not structural parsing — it fails by
 * reporting the wrong body rather than by failing to find one.
 */
function bodyAfter(source, from) {
  const open = source.indexOf('{', from)
  if (open < 0) return null
  let depth = 0
  for (let i = open; i < source.length; i++) {
    const c = source[i]
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return source.slice(open, i + 1)
    }
  }
  return null
}

/**
 * Every `#[tauri::command]` function in one file: name, async, body.
 *
 * The attribute is matched at the start of a line, which is what keeps a doc
 * comment *about* the attribute — this file's own explanation of the defect is
 * one, and it counted `open_panel_window` twice before this line said
 * `^[ \t]*` — from being read as a second command.
 */
function commandsIn(source, file) {
  const found = []
  const marker = /^[ \t]*#\[tauri::command/gm
  for (const hit of source.matchAll(marker)) {
    const at = hit.index
    // Skip past the attribute (which may carry arguments) to the signature.
    const signature = /(?:pub\s+)?(async\s+)?fn\s+([A-Za-z0-9_]+)/.exec(source.slice(at, at + 2000))
    if (!signature) continue
    const start = at + signature.index
    found.push({
      file,
      name: signature[2],
      isAsync: Boolean(signature[1]),
      body: bodyAfter(source, start) ?? '',
    })
  }
  return found
}

const files = rustFiles(ROOT)
const commands = files.flatMap((f) => commandsIn(readFileSync(f, 'utf8'), f))

console.log(`parsed ${commands.length} #[tauri::command] functions in ${files.length} files under ${ROOT}`)
ok(
  `at least ${MIN_COMMANDS} commands were parsed (a parser that found nothing must not report a clean run)`,
  commands.length >= MIN_COMMANDS
)

const builders = commands.filter((c) => WINDOW_BUILDERS.some((b) => c.body.includes(`${b}::new`)))
console.log(`of those, ${builders.length} build a window: ${builders.map((b) => b.name).join(', ') || '(none)'}`)
ok(
  'at least one command builds a window (otherwise this check is measuring an empty population)',
  builders.length >= 1
)

for (const command of builders) {
  ok(
    `${command.name} (${command.file}) is async, so building its window cannot block the event loop it is waiting on`,
    command.isAsync
  )
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
