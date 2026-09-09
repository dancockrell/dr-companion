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
//   3. inside `#[cfg(test)] mod`, `temp_dir()` is not used at all: a test asks
//      `scratch_dir` for a directory. Added by V5 (#515) — see HANDROLLED_BACKLOG
//      for why rule 1 was not enough and which sites have yet to move.
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
// `setup.rs` and this goes red naming the file and line. For rule 3, put a
// `temp_dir().join(format!("drc-backstop-{}", std::process::id()))` back into
// `lich.rs`'s test module: rule 1 is satisfied and rule 3 names it anyway,
// which is the whole reason rule 3 exists.

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

// -------------------------------------------------------------------- rule 3
// A *test* must not build a temp path by hand at all, even a process-unique
// one. Added by Lane V's V5 (issue #515).
//
// Rule 1 above asks only for `process::id()`, and the five sites in `lich.rs`
// that V5 migrated all had it: they passed this check and were never the #502
// defect. What they were is five hand-written copies of a rule that has a
// helper — two of them still calling `remove_dir_all` on the way *in*, which is
// the pattern #502 was, kept safe only by the pid in the name — and every one
// of them leaving its directory in `%TEMP%` when a case panicked. The next copy
// is the one that gets it wrong. CLAUDE.md 12: prefer the construct with no
// trap over a promise to use the trap carefully.
//
// So inside `#[cfg(test)]` there is one way to get a directory, and it is
// `crate::test_support::scratch_dir(label)`, which is unique per process *and*
// per call and cleans up on `Drop`.
//
// The rule arrives with a backlog rather than a flag day: six sites in five
// other modules still hand-roll, they are listed by name below, and every one
// is printed on every run. That is deliberate — a rule with a silent exception
// list is how the exception becomes the habit. Each is keyed by file and by the
// literal it names, not by line number, so the list cannot drift green as the
// files move.
const HANDROLLED_BACKLOG = new Set([
  'src-tauri/src/game_link.rs "drc-dial-"',
  'src-tauri/src/lich_health.rs "drc-lich-health-test-"',
  'src-tauri/src/music.rs "drc-music-"',
  'src-tauri/src/music.rs "drc-music-test-"',
  'src-tauri/src/player_files.rs "drc-player-file-test-"',
  'src-tauri/src/sal.rs "drc-sal-test-"',
]);
/** The ceiling on the backlog, the mirror of the floors below: it may shrink,
 * never grow. A seventh hand-rolled path is a conversation, not an edit. */
const MAX_HANDROLLED = HANDROLLED_BACKLOG.size;

/**
 * Where a file's test *module* starts, or null if it has none.
 *
 * Anchored on `#[cfg(test)] mod`, not on `#[cfg(test)]` alone. The test module
 * is where test code lives; a bare `#[cfg(test)]` marks a test-only helper that
 * may sit anywhere. `lich.rs` has three of those at lines 1102-1119, well above
 * its `mod tests` at 1636, and the first version of this took the earliest
 * `#[cfg(test)]` as the boundary — which swept in production code below it and
 * reported `session_dir()`, the one deliberately exempt path in the crate, as a
 * hand-rolled test fixture. A boundary detector one attribute too eager turns a
 * rule about tests into a rule about everything.
 */
const testRegionStart = (text) => {
  const m = /#\[cfg\(test\)\]\s*(?:pub\s+)?mod\s/.exec(text);
  return m ? m.index : null;
};

/** The backlog key for a site: the file, and the literal the path is named
 * after. Deliberately the *prefix* before any `{}`, so a `format!` argument
 * changing does not silently drop an entry off the list. */
const handrolledKey = (rel, tail) => {
  const name = tail.match(/\.join\(\s*(?:format!\(\s*)?"([^"]*)"/);
  const literal = name ? name[1].split("{")[0] : "";
  return `${rel} "${literal}"`;
};

const files = rustFiles(SRC);
const failures = [];
const exempt = [];
const handrolled = [];
let tempDirSites = 0;
let testTempDirSites = 0;
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
  const testsAt = testRegionStart(text);

  for (const m of text.matchAll(/temp_dir\(\)/g)) {
    tempDirSites += 1;
    if (home) continue;
    const tail = text.slice(m.index, m.index + WINDOW);
    // The escape hatch is read first, before either rule. A site that carries a
    // stated reason has already been argued; making rule 3 outrank it would
    // mean the one path in the crate that is deliberately not ours to choose
    // could never be exempted.
    const statedReason = exemptionFor(text, m.index);
    if (statedReason) {
      exempt.push(`${rel}:${lineOf(m.index)}  ${statedReason}`);
      continue;
    }
    // Rule 3, checked before rule 1, because it is the stricter one: inside
    // test code `process::id()` is no longer enough.
    if (testsAt !== null && m.index > testsAt) {
      testTempDirSites += 1;
      const key = handrolledKey(rel, tail);
      if (HANDROLLED_BACKLOG.has(key)) {
        handrolled.push(`${rel}:${lineOf(m.index)}  ${key}`);
      } else {
        failures.push(
          `${rel}:${lineOf(m.index)}  a test builds a temp path by hand (${key}). ` +
            `Use crate::test_support::scratch_dir(label): unique per process AND per call, ` +
            `and removed on Drop rather than wiped on entry.`,
        );
      }
      continue;
    }
    if (/process::id\(\)/.test(tail)) continue;
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
  `${tempDirSites} temp_dir() sites (${testTempDirSites} of them inside #[cfg(test)]), ` +
  `${bindSites} TcpListener::bind sites`;
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

// -------------------------------------------------------------------- rule 3
// Two controls, both synthetic, so they hold whether or not the tree is clean.
// The first is the rule seeing a violation; the second is the region detector,
// which is the part that would quietly switch the rule off for a whole file if
// it stopped finding `#[cfg(test)]`.
const IN_TEST = '#[cfg(test)]\nmod tests {\n  let d = std::env::temp_dir().join(format!("drc-x-{}", std::process::id()));\n}';
const IN_PROD = 'fn f() { std::env::temp_dir().join("simutronics") }';
const testRuleSeesIt =
  testRegionStart(IN_TEST) !== null && IN_TEST.indexOf("temp_dir()") > testRegionStart(IN_TEST);
const prodIsLeftAlone = testRegionStart(IN_PROD) === null;
say(
  testRuleSeesIt && prodIsLeftAlone,
  "control: the #[cfg(test)] region is found, and a file without one is not treated as all-test",
);
if (!(testRuleSeesIt && prodIsLeftAlone)) {
  failures.push("control failed: the test-region detector is unsound, so rule 3 checked nothing");
}
const keyControl = handrolledKey("a.rs", 'temp_dir().join(format!("drc-music-{name}-{}", x))');
say(
  keyControl === 'a.rs "drc-music-"',
  `control: the backlog key is the literal before any {} placeholder (${keyControl})`,
);
if (keyControl !== 'a.rs "drc-music-"') {
  failures.push("control failed: the backlog key would not match its own entries");
}
const backlogInBounds = handrolled.length <= MAX_HANDROLLED;
say(
  backlogInBounds,
  `${handrolled.length} hand-rolled test temp path${handrolled.length === 1 ? "" : "s"} on the ` +
    `backlog, at or below the ceiling of ${MAX_HANDROLLED}`,
);
if (!backlogInBounds) {
  failures.push(
    `${handrolled.length} hand-rolled test temp paths, over the ceiling of ${MAX_HANDROLLED} — ` +
      `the backlog is meant to shrink. Use crate::test_support::scratch_dir().`,
  );
}
// Same reasoning as the exemptions above: a backlog nobody sees is a backlog
// nobody works off.
for (const h of handrolled) console.log(`NOTE still hand-rolled ${h}`);
// The other direction, which is the one nobody writes (CLAUDE.md 19): an entry
// that matches nothing is either a site somebody fixed and forgot to delist, or
// a key that has drifted — and either way the list has started excusing
// something that is not there.
const staleBacklog = [...HANDROLLED_BACKLOG].filter((k) => !handrolled.some((h) => h.includes(k)));
say(
  staleBacklog.length === 0,
  staleBacklog.length === 0
    ? `every backlog entry still names a real site (${HANDROLLED_BACKLOG.size} of ${HANDROLLED_BACKLOG.size})`
    : `${staleBacklog.length} backlog entr(y/ies) match nothing in the tree`,
);
if (staleBacklog.length > 0) {
  failures.push(
    `the hand-rolled backlog names ${staleBacklog.join(", ")}, which is not in the tree — ` +
      `a fixed site must come off the list, or the list starts excusing something that no longer exists.`,
  );
}

// Counted separately, because a rule-3 failure under a rule-1 headline reads
// like the wrong defect: "not unique to its process" is precisely what a
// hand-rolled `process::id()` path is not guilty of.
const handBad = failures.filter((f) => f.includes("builds a temp path by hand")).length;
const tempBad = failures.filter((f) => f.includes("temp path") && !f.includes("by hand")).length;
const portBad = failures.filter((f) => f.includes("fixed port")).length;
say(
  handBad === 0,
  `no test builds its own temp path (${testTempDirSites} temp_dir() site(s) inside a test module, ` +
    `${handrolled.length} on the stated backlog)`,
);
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
