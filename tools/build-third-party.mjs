/**
 * Generate THIRD_PARTY.md - everything this app ships that somebody else
 * wrote, and the licence each one carries.
 *
 *     node tools/build-third-party.mjs           write the file
 *     node tools/build-third-party.mjs --check   fail if it has drifted
 *
 * Generated for the same reason docs/PLAYER_DATA.md is: the answer changes
 * every time a dependency moves, and a hand-maintained licence file that has
 * drifted looks exactly like one that has not. A licence notice is also the
 * one document where being out of date is not merely untidy.
 *
 * # Where each fact comes from, and why that source
 *
 * **npm** from `package-lock.json`, which carries both the resolved version
 * and the licence for every package, is committed, and is identical on every
 * machine. `node_modules/<dep>/package.json` says the same thing and is
 * absent in a fresh worktree, so the lockfile is the one that cannot make
 * this file's contents depend on who ran it.
 *
 * **Rust** from `cargo metadata --filter-platform x86_64-pc-windows-msvc`.
 * The platform filter is not tidiness: `Cargo.lock` lists every platform's
 * crates (469 of them), and only the 320 that survive the Windows cfg are in
 * the binary anybody installs. Listing all 469 would name GTK and Android
 * crates this app has never shipped.
 *
 * **Lich** is BSD-3-Clause. `docs/ENGINE.md` says verify rather than trust,
 * so the run reads the licence out of a local Lich install when there is one
 * and says NOT CHECKED when there is not - as a check printed at run time,
 * never as document content. A document whose text depended on whether the
 * machine had Lich would drift between machines by design.
 *
 * **Godot** is MIT, for the optional world viewer.
 *
 * **Shared 3D assets** from every `sourceLicense` in
 * `godot/assets/shared_asset_selections.json`.
 */
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
// E9 put Lich's licence text into the app's Settings sheet. That screen and
// this document now read one module, so a correction to either reaches both.
import { LICH_LICENSE as LICH } from '../src/data/lichLicense.ts'

const OUT = 'THIRD_PARTY.md'
const LOCK = 'package-lock.json'
const CARGO_LOCK = 'src-tauri/Cargo.lock'
const SELECTIONS = 'godot/assets/shared_asset_selections.json'

/** The only target this app is built for; see the header. */
const RUST_TARGET = 'x86_64-pc-windows-msvc'

/**
 * Lich installs somewhere of the machine's choosing. These are where it lands
 * on a default Ruby4Lich5 install; the value of the check is that a run which
 * finds none says so instead of asserting BSD-3 on nothing.
 */
// `DRC_LICH_LICENSE` overrides the search so both unhappy paths can be run
// deliberately: point it at nothing to reach the NOT CHECKED branch, or at a
// wrong file to watch the comparison go red.
const LICH_LICENCE_PATHS = process.env.DRC_LICH_LICENSE
  ? [process.env.DRC_LICH_LICENSE]
  : ['C:/Ruby4Lich5/Lich5/LICENSE', 'C:/Ruby4Lich5/LICENSE']

const check = process.argv.includes('--check')
let failures = 0
let notChecked = 0
const ok = (what, cond, detail = '') => {
  if (cond) console.log(`OK   ${what}${detail ? `   ${detail}` : ''}`)
  else {
    failures++
    console.log(`FAIL ${what}${detail ? `   ${detail}` : ''}`)
  }
}
const skip = (what, why) => {
  notChecked++
  console.log(`NOT CHECKED: ${what} - ${why}`)
}

/* ------------------------------------------------------------------ npm --- */

const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const lock = JSON.parse(readFileSync(LOCK, 'utf8'))

function npmEntry(name) {
  const entry = lock.packages?.[`node_modules/${name}`]
  if (!entry) throw new Error(`${LOCK} has no entry for ${name}. Run npm install and commit the lockfile.`)
  return {
    name,
    version: entry.version ?? '(no version)',
    license: entry.license ?? '(no licence declared)',
  }
}

const runtime = Object.keys(pkg.dependencies ?? {}).sort().map(npmEntry)
const build = Object.keys(pkg.devDependencies ?? {}).sort().map(npmEntry)

// A floor. An empty dependency list and a broken reader produce the same
// document, and only one of them is a repository.
if (runtime.length < 3) throw new Error(`Only ${runtime.length} runtime dependencies found; refusing to publish.`)

const undeclared = [...runtime, ...build].filter((d) => d.license === '(no licence declared)')
if (undeclared.length) {
  throw new Error(
    `No licence declared for: ${undeclared.map((d) => d.name).join(', ')}. ` +
      'Establish it by hand before publishing a licence notice that omits it.'
  )
}

/* ----------------------------------------------------------------- Rust --- */

/**
 * `DRC_CARGO` exists so the no-cargo branch can be executed on purpose.
 *
 * That branch is the one that matters on a machine without Rust, and it was
 * wrong the first time it ran: a branch nobody can trigger deliberately is a
 * branch nobody can prove works. Point it at a name that does not resolve and
 * the run takes the degraded path.
 */
const CARGO = process.env.DRC_CARGO || 'cargo'

function cargoCrates() {
  const result = spawnSync(CARGO, ['metadata', '--format-version', '1', '--filter-platform', RUST_TARGET], {
    cwd: 'src-tauri',
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  })
  if (result.error || result.status !== 0) return null
  let meta
  try {
    meta = JSON.parse(result.stdout)
  } catch {
    return null
  }
  return meta.packages
    .filter((p) => p.name !== pkg.name && p.name !== 'dr-companion')
    .map((p) => ({ name: p.name, version: p.version, license: p.license ?? '(no licence declared)' }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))
}

/** Every `name@version` in Cargo.lock - committed, and the same everywhere. */
function lockedCrates() {
  const text = readFileSync(CARGO_LOCK, 'utf8')
  const out = new Set()
  for (const m of text.matchAll(/\[\[package\]\]\r?\nname = "([^"]+)"\r?\nversion = "([^"]+)"/g)) {
    out.add(`${m[1]}@${m[2]}`)
  }
  if (out.size < 50) throw new Error(`Parsed only ${out.size} packages from ${CARGO_LOCK}; refusing to trust that.`)
  return out
}

/* --------------------------------------------------------- other parties --- */

const selections = JSON.parse(readFileSync(SELECTIONS, 'utf8'))
const assetLicences = [...new Set(selections.selections.map((s) => s.sourceLicense))].sort()
if (!assetLicences.length) throw new Error(`${SELECTIONS} declared no sourceLicense; refusing to publish.`)

/* Lich's licence, and its copyright holders, are imported at the top of this
 * file from `src/data/lichLicense.ts` rather than kept here - see that
 * module's header, and the checks below, which are what keep it honest. */

/* -------------------------------------------------------------- document --- */

const licenceTable = (rows) =>
  ['| Package | Version | Licence |', '|---|---|---|', ...rows.map((d) => `| \`${d.name}\` | ${d.version} | ${d.license} |`)].join('\n')

function rustSection(crates) {
  const byLicence = new Map()
  for (const c of crates) byLicence.set(c.license, (byLicence.get(c.license) ?? 0) + 1)
  const summary = [...byLicence.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([licence, n]) => `| ${licence} | ${n} |`)
    .join('\n')
  return `${crates.length} crates reach the shipped Windows binary, resolved for
\`${RUST_TARGET}\`. \`src-tauri/Cargo.lock\` lists more than this: it carries
every platform's crates, including the GTK and Android ones this app has never
built, and naming those here would claim to ship software it does not.

| Licence | Crates |
|---|---:|
${summary}

<details>
<summary>Every crate, by name</summary>

${licenceTable(crates)}

</details>`
}

function document(crates) {
  return `# Third-party software in DR Companion

> Generated by \`tools/build-third-party.mjs\`. Do not edit by hand - re-run
> the script. \`--check\` fails the build when it has drifted from the
> lockfiles it is derived from.

DR Companion is MIT (see \`LICENSE\`). It ships, bundles or depends on the
following, each under its own terms.

## Lich

The app talks to [Lich](https://github.com/elanthia-online/lich-5) and its
installer fetches Ruby4Lich5. Lich is **${LICH.spdx}**:

${LICH.holders.map((h) => `> ${h}`).join('\n>\n')}

> ${LICH.grant}

The full text is in the app, under Settings, and in
\`src/data/lichLicense.ts\`, which is where this section's copyright lines and
the app's licence screen both come from. It also ships with Lich itself, at
\`Lich5/LICENSE\` in a Ruby4Lich5 install.

## Godot

The optional world viewer is exported from the
[Godot Engine](https://godotengine.org), which is **MIT**:

> Copyright (c) 2014-present Godot Engine contributors.
> Copyright (c) 2007-2014 Juan Linietsky, Ariel Manzur.

The viewer is not installed by default and the client runs without it.

## npm packages in the shipped client

${licenceTable(runtime)}

### Build-time only

These are not installed on a player's machine, but their output is: the
bundler, the type system and the CSS toolchain all contribute to what ships.

${licenceTable(build)}

## Rust crates

${rustSection(crates)}

## Fonts

None are bundled. The interface asks for the platform's own UI font
(\`Segoe UI\` on Windows) and falls back through the system stack, so no font
file is redistributed and no font licence applies.

## Shared 3D assets

The world viewer draws on a shared asset library, tracked as a submodule at
\`godot/shared-assets\` and admitted one selection at a time through
\`${SELECTIONS}\`. Every admitted selection to date is **${assetLicences.join(', ')}**.

| Selection | Source pack | Licence |
|---|---|---|
${selections.selections.map((s) => `| \`${s.id}\` | \`${s.sourcePack}\` | ${s.sourceLicense} |`).join('\n')}

Nothing in that library contributes routes, exits, collision, navigation or
any other game fact; it is presentation only, which is a rule of the admission
process rather than a property of the licences.
`
}

/* ----------------------------------------------------------------- run --- */

const crates = cargoCrates()

if (!check) {
  if (!crates) {
    console.error(
      `FAIL cargo metadata --filter-platform ${RUST_TARGET} did not run, so the Rust ` +
        'crate list cannot be derived. Refusing to write a licence notice with a section missing.'
    )
    process.exit(1)
  }
  writeFileSync(OUT, document(crates))
  console.log(`${OUT}: ${runtime.length} runtime and ${build.length} build npm packages, ${crates.length} Rust crates, ${selections.selections.length} shared assets`)
  process.exit(0)
}

/* --check */

if (!existsSync(OUT)) {
  console.error(`FAIL ${OUT} is not committed. Run: node tools/build-third-party.mjs`)
  process.exit(1)
}
const committed = readFileSync(OUT, 'utf8')
const norm = (s) => s.split('\r\n').join('\n')

if (crates) {
  ok(`${OUT} matches its sources`, norm(committed) === norm(document(crates)),
    `${runtime.length} runtime + ${build.length} build npm packages, ${crates.length} crates for ${RUST_TARGET}`)
  if (norm(committed) !== norm(document(crates))) {
    console.error('     Run: node tools/build-third-party.mjs')
  }
} else {
  // Cargo is absent or could not resolve. The Rust section cannot be
  // re-derived, so say so - and still run the part that does not need it,
  // because "could not check one section" is not "checked nothing".
  skip('the Rust crate list', `cargo metadata --filter-platform ${RUST_TARGET} did not run here`)

  const locked = lockedCrates()
  const named = [...committed.matchAll(/^\| `([a-zA-Z0-9_.-]+)` \| (\d[^|]*?) \|/gm)].map((m) => [m[1], m[2].trim()])
  const npmNames = new Set([...runtime, ...build].map((d) => d.name))
  const crateRows = named.filter(([name]) => !npmNames.has(name))
  // The denominator: if the row parser stopped matching, every crate in the
  // document is trivially "in the lockfile" because there are none to check.
  ok('the document still names Rust crates to check', crateRows.length >= 50, `${crateRows.length} rows`)
  const strays = crateRows.filter(([name, version]) => !locked.has(`${name}@${version}`))
  ok('every crate the document names is in src-tauri/Cargo.lock', strays.length === 0,
    strays.length ? strays.slice(0, 5).map(([n, v]) => `${n}@${v}`).join(', ') : `${crateRows.length} crates`)
}

// Verified rather than trusted, per docs/ENGINE.md. Three states: read and
// matched, read and disagreed, or no Lich on this machine.
{
  const path = LICH_LICENCE_PATHS.find((p) => existsSync(p))
  if (!path) {
    skip("Lich's licence text", `no Lich install found at ${LICH_LICENCE_PATHS.join(' or ')}`)
  } else {
    const text = readFileSync(path, 'utf8')
    // Compared with the licence's line wrapping removed: `lichLicense.ts`
    // holds each clause as one string so the app can wrap it to whatever
    // width the sheet is, and the file on disk is hard-wrapped at 79 columns.
    // Without this the comparison would be measuring newlines.
    const flat = text.replace(/\s+/g, ' ')
    ok(`${path} is the ${LICH.title}`, text.includes(LICH.title))
    ok('...and carries the copyright holders this document names',
      LICH.holders.every((h) => text.includes(h)),
      LICH.holders.filter((h) => !text.includes(h)).join('; ') || 'all three')
    // A positive control on the reader itself: a phrase that must be in any
    // BSD-3 text. If this is absent the file is not what was read.
    ok('...and the redistribution clause is actually in the file read',
      text.includes('Redistribution and use in source and binary forms'))
    // E9. The app now reproduces the whole licence, not a summary of it, so
    // every clause it shows is compared against the installed file rather
    // than only the copyright lines. A paraphrase that crept into the module
    // would still satisfy the three checks above and fail these.
    ok('...and the grant the app shows is the installed one', flat.includes(LICH.grant))
    for (const [i, condition] of LICH.conditions.entries()) {
      ok(`...and condition ${i + 1} the app shows is the installed one`,
        flat.includes(condition))
    }
    ok('...and the disclaimer the app shows is the installed one',
      flat.includes(LICH.disclaimer))
  }
}

// The point of E9 is that the text reaches a player, so check the screen that
// shows it, not only the module that holds it. A section that stopped
// rendering the licence would leave every check above green.
{
  const sheet = readFileSync('src/components/layout/SettingsSheet.tsx', 'utf8')
  ok('the Settings sheet imports the licence rather than keeping a copy',
    // `(\.ts)?` because src/ now writes the extension (C14), and whether it
    // does is not what this check is about.
    /import \{ LICH_LICENSE \} from '\.\.\/\.\.\/data\/lichLicense(\.ts)?'/.test(sheet))
  for (const field of ['holders', 'grant', 'conditions', 'disclaimer']) {
    ok(`...and renders LICH_LICENSE.${field}`, sheet.includes(`LICH_LICENSE.${field}`))
  }
}

// The document must not have lost a section to a template edit.
for (const heading of ['## Lich', '## Godot', '## npm packages', '## Rust crates', '## Fonts', '## Shared 3D assets']) {
  ok(`the document still has its ${heading.replace('## ', '')} section`, committed.includes(heading))
}

console.log('')
if (failures) {
  console.log(`${failures} failed${notChecked ? `, ${notChecked} not checked` : ''}`)
  process.exit(1)
}
console.log(notChecked ? `no failures, but ${notChecked} not checked` : 'all third-party licence checks passed')
process.exit(0)
