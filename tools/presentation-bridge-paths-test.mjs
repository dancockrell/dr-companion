/**
 * The Godot viewer and the Rust bridge must agree on where the token lives.
 *
 *   node tools/presentation-bridge-paths-test.mjs
 *
 * # Why this is a test and not a shared constant
 *
 * It cannot be a shared constant. `presentation_bridge.rs` writes the token
 * and port files into `setup.rs::app_data_dir()`; `godot/scripts/live_link.gd`
 * has to find them *before* it can talk to the bridge, so it cannot ask the
 * bridge where they are. The bootstrap has to be a convention duplicated on
 * both sides, in two languages that share no build step.
 *
 * Duplicated conventions drift. This one drifts silently and expensively: if
 * Rust changes the directory name and Godot does not, the viewer finds no
 * token, reports "waiting for DR Companion to start", and retries forever —
 * which is indistinguishable from the desktop app genuinely not running. The
 * user-visible symptom of a one-word rename would be a 3D window that never
 * connects and never says why, and the retry message would be a confident lie.
 *
 * Same class as the slug rule duplicated between `art-run.mjs` and
 * `creatureArt.ts`, which `creature-art-test.mjs` pins for the same reason.
 *
 * # What is asserted
 *
 * Properties of the two sources, read as text. Nothing is executed — running
 * the Rust would need a toolchain and running the GDScript would need Godot,
 * and neither is available in the suite. Reading both and comparing the
 * literals is what is actually available, and it catches the rename, which is
 * the failure that happens.
 */
import { readFileSync, existsSync } from 'node:fs'

let checks = 0
let failures = 0

function check(label, ok, detail = '') {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? `: ${detail}` : ''}`)
  checks++
  if (!ok) failures++
}

const RUST = 'src-tauri/src/setup.rs'
const BRIDGE = 'src-tauri/src/presentation_bridge.rs'
const GD = 'godot/scripts/live_link.gd'

// The Godot half only exists once the viewer branch is merged. Skipping is
// correct here and reporting zero checks is not: `run-tests.mjs` treats a
// suite that asserts nothing as NOT RUN rather than as passing, which is the
// behaviour we want if this ever silently stops covering anything.
if (!existsSync(GD)) {
  console.log('SKIP godot/scripts/live_link.gd not present (viewer branch not merged)')
  process.exit(0)
}

const rust = readFileSync(RUST, 'utf8')
const bridge = readFileSync(BRIDGE, 'utf8')
const gd = readFileSync(GD, 'utf8')

// --- the directory name ------------------------------------------------------

const rustDir = rust.match(/\.join\("([^"]*Companion[^"]*)"\)/)?.[1]
const gdDir = gd.match(/path_join\("([^"]*Companion[^"]*)"\)/)?.[1]

check('setup.rs names an app data directory', !!rustDir, rustDir ?? 'not found')
check('live_link.gd names an app data directory', !!gdDir, gdDir ?? 'not found')
check(
  'both name the SAME directory',
  !!rustDir && rustDir === gdDir,
  `rust=${rustDir} godot=${gdDir}`
)

// --- the environment variable used to locate it ------------------------------

check('setup.rs resolves the base from LOCALAPPDATA', /LOCALAPPDATA/.test(rust))
check('live_link.gd resolves the base from LOCALAPPDATA too', /LOCALAPPDATA/.test(gd))

// --- the file names ----------------------------------------------------------

// Loose up to the opening quote on purpose: Rust declares these as
// `const TOKEN_FILE: &str = "..."` and GDScript as `const TOKEN_FILE := "..."`.
// A regex tight enough to describe one form silently fails to find the other,
// and "not found" compared against "not found" would agree — a test that
// passes because it read neither side is worse than no test.
for (const [label, re] of [
  ['token', /TOKEN_FILE[^"\n]*"([^"]+)"/],
  ['port', /PORT_FILE[^"\n]*"([^"]+)"/],
]) {
  const inRust = bridge.match(re)?.[1]
  const inGd = gd.match(re)?.[1]
  check(
    `the ${label} filename matches on both sides`,
    !!inRust && inRust === inGd,
    `rust=${inRust} godot=${inGd}`
  )
}

// --- the protocol number -----------------------------------------------------
//
// A mismatch here is the one case the viewer is designed to refuse loudly
// rather than tolerate, so the two constants agreeing is worth pinning: a
// viewer that refuses a bridge it could have understood is as broken as one
// that half-understands a bridge it could not.

const rustProto = bridge.match(/PROTOCOL[^=]*=\s*(\d+)/)?.[1]
const gdProto = gd.match(/PROTOCOL\s*:\s*int\s*=\s*(\d+)/)?.[1]
check(
  'the protocol number matches on both sides',
  !!rustProto && rustProto === gdProto,
  `rust=${rustProto} godot=${gdProto}`
)

// --- the handshake ordering --------------------------------------------------
//
// The server reads exactly one line under an auth timeout and drops anything
// that is not an auth frame. A client that writes anything before the token
// fails in a way that reads as "the bridge is not running" — the exact
// misdiagnosis realBridge.ts records paying for on the Lich side.

const helloIdx = gd.indexOf('"hello"')
const authSendIdx = gd.indexOf('"type": "auth"')
check(
  'the viewer sends auth in response to hello, before anything else',
  helloIdx > 0 && authSendIdx > helloIdx,
  `hello@${helloIdx} auth@${authSendIdx}`
)
check(
  'the viewer never sends a frame before authenticating',
  !/_send\(\{[^}]*"type":\s*"(?!auth)/.test(gd.slice(0, authSendIdx)),
  'a non-auth send appears before the auth send'
)

console.log(`\n${checks} checked, ${failures} failed`)
process.exit(failures ? 1 : 0)
