#!/usr/bin/env node
// Two `cargo test` processes must not be able to corrupt each other.
//
// Issue #502: `setup.rs`, `bridge_token.rs` and three cases in `lich.rs` built
// a scratch directory from a *constant* name under `%TEMP%` and called
// `remove_dir_all` on the way in, so two lanes gating at once wiped each
// other's fixtures mid-test. Measured on the parent commit, running the built
// lib test binary from `src-tauri/`:
//
//     1 process   x  5 runs of vendor_tests     0 of   5 failed
//     6 processes x 25 runs of vendor_tests    54 of 150 failed
//     6 processes x 25 runs of bridge_token    54 of 150 failed
//     4 processes x  4 full-suite runs          2 of  16 failed
//
// The shared *name* is the whole defect: given a path no other process can
// land on, there is nothing to collide over and nothing to wipe on entry. So
// this checks the class rather than those five tests, and it checks it as one
// property rather than a list of banned spellings:
//
//   1. every `std::env::temp_dir()` path outside `test_support.rs` carries
//      `std::process::id()`, so it is unique to the process that made it.
//      `crate::test_support::scratch_dir(label)` is the helper that does this
//      and also adds a per-call counter, because the test binary runs its
//      cases on several threads at once.
//   2. no listener is bound to a fixed port (the free-port rule, #C9): use
//      `TcpListener::bind("127.0.0.1:0")` and read the port back.
//
// One class of site cannot obey rule 1 and must not be made to: production
// code reading a path *another program* chose. `lich.rs`'s `session_dir()`
// reads `<tmp>/simutronics/sessions`, where Lich's `front-end.rb:435-443`
// writes its session descriptors. A `process::id()` there would turn this
// check green and point the reader at a directory nothing writes - a fix that
// reports success while removing the feature (CLAUDE.md 1). So there is one
// escape hatch, and it is deliberately noisy:
//
//     // drc-shared-temp-path: <why this path is not ours to choose>
//
// on a line shortly before the call. The reason is mandatory - a bare marker
// is still a failure - every exempt site is printed on every run rather than
// vanishing, and MAX_EXEMPT caps how many may exist, so the hatch cannot
// quietly become the habit. Widening it is a conversation, not an edit.
//
// It asserts what it examined before concluding anything (CLAUDE.md 1): a run
// that scanned no files, or found no `temp_dir()` call at all, is a broken
// instrument and must not read as a pass.
//
// Sabotage: put `std::env::temp_dir().join("drc-vendor-good")` back into
// `setup.rs` and this goes red naming the file and line.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(ROOT, "src-tauri", "src");

// Floors set well below the real counts, so a truncated or misdirected scan
// fails instead of quietly passing. They never need touching as the crate grows.
const MIN_FILES = 20;
const MIN_TEMP_DIR_SITES = 8;
const MIN_BIND_SITES = 5;

// `scratch_dir` is where the uniqueness rule is implemented, so it is the one
// place allowed to name the shared root.
const RULE_HOME = "test_support.rs";

// How much of the expression after `temp_dir()` to look in for the process id.
// Generous: these paths are often built across four or five wrapped lines.
const WINDOW = 400;

// How far *back* from a `temp_dir()` call the exemption marker may sit, so a
// marker can carry a short explanation above the line it excuses without
// reaching down the file and excusing something further on. About eight lines.
const BACK_WINDOW = 500;

// A marker plus a reason. The reason is what makes this greppable and
// arguable later; `// drc-shared-temp-path:` on its own excuses nothing.
const EXEMPT = /drc-shared-temp-path:[ \t]*(\S.*)/;

// The ceiling on the escape hatch, the mirror of the floors above. Today one
// site uses it (`lich.rs` `session_dir`). If a second and third arrive, that
// is worth an argument rather than an edit here.
const MAX_EXEMPT = 3;

// The exemption granted to the call at `index`, or null. Returns the reason
// text so the caller can print it.
function exemptionFor(text, index) {
  const before = text.slice(Math.max(0, index - BACK_WINDOW), index);
  const m = before.match(EXEMPT);
  return m ? m[1].trim() : null;
}

function rustFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...rustFiles(p));
    else if (name.endsWith(".rs")) out.push(p);
  }
  return out;
}

const files = rustFiles(SRC);
const failures = [];
const exempt = [];
let tempDirSites = 0;
let bindSites = 0;

// A bind to anything that is not port 0. `("127.0.0.1", port)` with a variable
// is left alone: that is `game_link`'s retry loop, production code choosing
// its own port, not a test claiming a fixed one.
const FIXED_BIND =
  /TcpListener::bind\(\s*(?:"127\.0\.0\.1:(\d+)"|\(\s*"127\.0\.0\.1"\s*,\s*(\d+)\s*\))/g;

for (const file of files) {
  const rel = relative(ROOT, file).replace(/\\/g, "/");
  const text = readFileSync(file, "utf8");
  const lineOf = (i) => text.slice(0, i).split(/\r?\n/).length;
  const home = file.endsWith(RULE_HOME);

  for (const m of text.matchAll(/temp_dir\(\)/g)) {
    tempDirSites += 1;
    if (home) continue;
    const tail = text.slice(m.index, m.index + WINDOW);
    if (/process::id\(\)/.test(tail)) continue;
    const reason = exemptionFor(text, m.index);
    if (reason) {
      exempt.push(`${rel}:${lineOf(m.index)}  ${reason}`);
      continue;
    }
    const name = tail.match(/\.join\(\s*(?:format!\(\s*)?"([^"]*)"/);
    failures.push(
      `${rel}:${lineOf(m.index)}  temp path${name ? ` "${name[1]}"` : ""} is not unique to ` +
        `this process — two \`cargo test\` runs share it. Use crate::test_support::scratch_dir().`,
    );
  }

  for (const m of text.matchAll(FIXED_BIND)) {
    bindSites += 1;
    const port = m[1] ?? m[2];
    if (port === "0") continue;
    failures.push(
      `${rel}:${lineOf(m.index)}  listener bound to fixed port ${port} — ` +
        `two \`cargo test\` runs collide. Bind "127.0.0.1:0" and read the port back.`,
    );
  }
}

let ok = 0;
const say = (pass, what) => {
  console.log(`${pass ? "OK  " : "FAIL"} ${what}`);
  if (pass) ok += 1;
};

const scanned =
  `scanned ${files.length} .rs files under src-tauri/src: ` +
  `${tempDirSites} temp_dir() sites, ${bindSites} TcpListener::bind sites`;
console.log(scanned);

// The denominator first. A scan that found nothing must report itself broken
// rather than reporting a clean tree (CLAUDE.md 1).
let broken = null;
if (files.length < MIN_FILES) broken = `only ${files.length} .rs files found (floor ${MIN_FILES})`;
else if (tempDirSites < MIN_TEMP_DIR_SITES)
  broken = `only ${tempDirSites} temp_dir() sites found (floor ${MIN_TEMP_DIR_SITES})`;
else if (bindSites < MIN_BIND_SITES)
  broken = `only ${bindSites} bind sites found (floor ${MIN_BIND_SITES})`;

if (broken) {
  console.log(`FAIL BROKEN CHECK: ${broken} - this did not examine what it claims to.`);
  console.log("\n0 checked, 1 failed");
  process.exit(2);
}

say(true, `the scan reached ${files.length} files, above its floor of ${MIN_FILES}`);
say(true, `${tempDirSites} temp_dir() sites examined, above the floor of ${MIN_TEMP_DIR_SITES}`);
say(true, `${bindSites} bind sites examined, above the floor of ${MIN_BIND_SITES}`);

// The positive control: the rule can see a violation at all. Run against a
// synthetic file rather than the tree, so it is true whether or not the tree
// happens to be clean today.
const SABOTAGE = 'let d = std::env::temp_dir().join("drc-vendor-good");';
const seesIt = !/process::id\(\)/.test(SABOTAGE.slice(SABOTAGE.indexOf("temp_dir()")));
say(seesIt, "control: the rule flags a fixed-name temp path when shown one");
if (!seesIt) failures.push("control failed: the uniqueness rule cannot see a fixed name");

// Three controls on the escape hatch itself, because an exemption mechanism
// that over-matches would silently excuse the whole tree and this run would
// still print "all passed". Each is a synthetic string, so these hold whether
// or not the tree happens to use the hatch today.
const withReason = `// drc-shared-temp-path: Lich chooses it\n${SABOTAGE}`;
const bareMarker = `// drc-shared-temp-path:\n${SABOTAGE}`;
const outOfReach = `// drc-shared-temp-path: too far above\n${"//\n".repeat(400)}${SABOTAGE}`;
const at = (s) => s.indexOf("temp_dir()");
const hatchOk =
  exemptionFor(withReason, at(withReason)) === "Lich chooses it" &&
  exemptionFor(bareMarker, at(bareMarker)) === null &&
  exemptionFor(outOfReach, at(outOfReach)) === null;
say(
  hatchOk,
  "control: the exemption needs a reason, and does not reach past its window",
);
if (!hatchOk) failures.push("control failed: the drc-shared-temp-path exemption is unsound");

const hatchInBounds = exempt.length <= MAX_EXEMPT;
say(
  hatchInBounds,
  `${exempt.length} exempt temp path${exempt.length === 1 ? "" : "s"}, ` +
    `at or below the ceiling of ${MAX_EXEMPT}`,
);
if (!hatchInBounds) {
  failures.push(
    `${exempt.length} sites carry drc-shared-temp-path, over the ceiling of ${MAX_EXEMPT} — ` +
      `the escape hatch is becoming the habit. Argue it rather than raising the number.`,
  );
}
// Printed on every run, pass or fail: an exemption that nobody sees is an
// exemption nobody re-reads.
for (const e of exempt) console.log(`NOTE exempt ${e}`);

const tempBad = failures.filter((f) => f.includes("temp path")).length;
const portBad = failures.filter((f) => f.includes("fixed port")).length;
say(
  tempBad === 0,
  `every temp path is unique to its process (${tempDirSites} sites, ` +
    `${exempt.length} exempt with a stated reason)`,
);
say(portBad === 0, `no test binds a fixed port (${bindSites} sites)`);

if (failures.length) {
  console.log("");
  for (const f of failures) console.log(`FAIL ${f}`);
  console.log(
    "\nTwo lanes may run `cargo test` at the same time (docs/MERGING.md). " +
      "Every test fixture must be unique to the process that made it.",
  );
  console.log(`\n${ok + failures.length} checked, ${failures.length} failed`);
  process.exit(1);
}

console.log(`\n${ok} checked, 0 failed`);
console.log("all passed");
