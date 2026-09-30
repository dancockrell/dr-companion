import { createHash } from 'node:crypto'
import { closeSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { readViewerPackage, VIEWER_DATA_FILES } from './godot-viewer-package.mjs'
import { checkViewerPackageReader } from './godot-viewer-package-test.mjs'

const root = resolve(import.meta.dirname, '..')
const projectDir = resolve(root, 'godot')
const args = process.argv.slice(2)

function option(name) {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

// Checked first, before anything that reads the project. It used to sit after
// an asset validation that needed an uninitialised submodule, which made it
// unreachable on exactly the machines most likely to have the bug.
//
// The app tells a person how to build a viewer when it cannot find one, and
// that instruction points at this tool. It was wrong once already - the text
// said `npm run viewer:export`, and the script is `godot:export` - which is
// the worst kind of message: confident, specific, and failing for a reason
// the reader cannot see. Checked here rather than trusted to care, because
// the string lives in Rust and TSX and nothing else compares it to
// package.json.
const INSTRUCTION_SOURCES = [
  'src-tauri/src/viewer.rs',
  'src/components/shared/PresentationBridgePanel.tsx',
]
const scripts = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).scripts
let namedCommands = 0
for (const file of INSTRUCTION_SOURCES) {
  const path = resolve(root, file)
  if (!existsSync(path)) continue
  for (const [, script] of readFileSync(path, 'utf8').matchAll(/npm run ([a-z0-9:_-]+)/g)) {
    namedCommands += 1
    if (!scripts[script]) {
      console.error(
        `${file} tells the user to run \`npm run ${script}\`, which is not a script in package.json.`,
      )
      process.exit(1)
    }
  }
}
if (namedCommands === 0) {
  console.error(
    'No `npm run` instruction found in any of: ' +
      INSTRUCTION_SOURCES.join(', ') +
      '. Either the files moved or the guidance was removed - a check that examines nothing passes for free.',
  )
  process.exit(1)
}

// include_filter names extra project-local files, not outside-project assets.
// Godot 4.3 already exports these JSON resources with all_resources, so an
// empty filter is valid. Explicitly listing the same data is valid too. Keep
// this guard narrow: unknown assets need review, while the built PCK below
// must actually contain the standalone data regardless of filter spelling.
const preset = readFileSync(resolve(projectDir, 'export_presets.cfg'), 'utf8')
const FILTER = /^include_filter="([^"]*)"\r?$/m
const filterLine = preset.match(FILTER)
if (!filterLine) {
  console.error(
    'godot/export_presets.cfg has no include_filter line. Either the preset was rewritten or this ' +
      'parser stopped matching it - and a filter this cannot read is one it cannot check.',
  )
  process.exit(1)
}
const included = filterLine[1].split(',').filter(Boolean)
const unreviewed = included.filter((path) => !VIEWER_DATA_FILES.includes(path))
if (unreviewed.length > 0) {
  console.error(`Windows export include_filter contains unreviewed project assets: ${unreviewed.join(', ')}`)
  process.exit(1)
}
// The positive control on the parser, run every time. Without it "the filter
// is empty" is equally satisfied by a regex that stopped matching anything:
// an empty result and an absent one are the same observation (CLAUDE.md 1).
const CONTROL = 'include_filter="a.glb,b.glb"\n'
const seen = CONTROL.match(FILTER)?.[1].split(',').filter(Boolean) ?? []
if (seen.length !== 2) {
  console.error(
    `control failed: the include_filter parser read ${seen.length} path(s) out of a line holding two. ` +
      'It cannot tell an empty filter from one it failed to read.',
  )
  process.exit(1)
}
if (args.includes('--check')) {
  // Reported as individual OK lines, because `tools/run-tests.mjs` counts them
  // and a suite that prints one summary sentence registers as zero checks —
  // which it correctly calls NOT RUN rather than a pass. Everything asserted
  // here has already been enforced above by an exit; these lines are what make
  // the work visible to the runner and to a reader.
  console.log(`OK   the include_filter line is present and parseable`)
  console.log(`OK   control: the parser reads ${seen.length} of 2 paths out of a two-path filter`)
  console.log(`OK   the Windows include_filter contains only reviewed project-local assets`)
  console.log(`OK   ${namedCommands} npm command(s) named in app-facing messages all exist`)
  const packageChecks = checkViewerPackageReader()
  console.log(`\n${4 + packageChecks} checked, 0 failed`)
  console.log('all passed')
  process.exit(0)
}

const requestedGodot = option('--godot') || process.env.GODOT4 || 'godot4'
const output = resolve(option('--output') || resolve(projectDir, 'build', 'DRCompanionWorldViewer.exe'))
mkdirSync(dirname(output), { recursive: true })

const stage = mkdtempSync(resolve(tmpdir(), 'drc-godot-export-'))
const stagedProject = resolve(stage, 'project')
const stagedOutput = resolve(stage, 'DRCompanionWorldViewer.exe')
let packaged
let exportError
try {
  cpSync(projectDir, stagedProject, {
    recursive: true,
    filter(source) {
      const local = relative(projectDir, source)
      if (!local) return true
      const top = local.split(sep)[0]
      return top !== '.godot' && top !== 'build'
    },
  })
  const result = spawnSync(requestedGodot, [
    '--headless',
    '--path', stagedProject,
    '--export-release', 'Windows Desktop',
    stagedOutput,
  ], { cwd: root, encoding: 'utf8', stdio: 'pipe', maxBuffer: 16 * 1024 * 1024 })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  if (result.error) throw new Error(`Unable to start Godot at ${requestedGodot}: ${result.error.message}`)
  if (result.status !== 0 || !existsSync(stagedOutput)) {
    throw new Error(`Godot returned status ${result.status ?? 'unknown'} without a successful fresh export.`)
  }
  if (/^(?:SCRIPT )?ERROR:/m.test(`${result.stdout}\n${result.stderr}`)) {
    throw new Error('Godot reported errors during export.')
  }
  packaged = readViewerPackage(readFileSync(stagedOutput))
  for (const local of VIEWER_DATA_FILES) {
    if (!packaged.files.get(`res://${local}`).equals(readFileSync(resolve(stagedProject, local)))) {
      throw new Error(`Exported ${local} does not match the checked-in standalone data.`)
    }
  }
  // Only a verified fresh export replaces the destination. A zero-exit engine
  // failure cannot accidentally validate last week's executable or receipt.
  copyFileSync(stagedOutput, output)
} catch (error) {
  exportError = error
} finally {
  rmSync(stage, { recursive: true, force: true })
}
if (exportError) {
  console.error(`Godot viewer export failed: ${exportError.message}`)
  process.exit(1)
}

const bytes = statSync(output).size
const hash = createHash('sha256')
const handle = openSync(output, 'r')
const chunk = Buffer.alloc(1024 * 1024)
let position = 0
while (position < bytes) {
  const count = readSync(handle, chunk, 0, chunk.length, position)
  if (count === 0) break
  hash.update(chunk.subarray(0, count))
  position += count
}
closeSync(handle)

const receipt = {
  schemaVersion: 1,
  preset: 'Windows Desktop',
  output,
  bytes,
  sha256: hash.digest('hex'),
  engine: packaged.engine,
  packagedFiles: packaged.files.size,
  verifiedDataFiles: VIEWER_DATA_FILES,
}
writeFileSync(resolve(dirname(output), 'viewer-build.json'), `${JSON.stringify(receipt, null, 2)}\n`)
console.log(`Verified Windows viewer export: ${bytes} bytes, ${packaged.files.size} packaged resources, sha256 ${receipt.sha256}`)
