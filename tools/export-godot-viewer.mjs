import { createHash } from 'node:crypto'
import { closeSync, cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const projectDir = resolve(root, 'godot')
const args = process.argv.slice(2)

function option(name) {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

// Checked before anything that needs the shared-assets submodule, so it runs
// on a checkout that has not initialised it. Put after the asset validation it
// was unreachable on exactly the machines most likely to have the bug.
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

const selections = JSON.parse(readFileSync(resolve(projectDir, 'assets', 'shared_asset_selections.json'), 'utf8'))
const runtimeAssets = selections.selections.flatMap((selection) =>
  selection.paths.map((path) => `shared-assets/${path}`),
)
const preset = readFileSync(resolve(projectDir, 'export_presets.cfg'), 'utf8')
const included = preset.match(/^include_filter="([^"]*)"$/m)?.[1].split(',').filter(Boolean) || []
if (JSON.stringify(included) !== JSON.stringify(runtimeAssets)) {
  console.error('Windows export include_filter must exactly match the reviewed shared-asset selections.')
  process.exit(1)
}
for (const local of runtimeAssets) {
  if (!existsSync(resolve(projectDir, local))) {
    console.error(`Required admitted runtime asset is missing: ${local}`)
    process.exit(1)
  }
}
if (args.includes('--check')) {
  console.log(
    `Godot export contract is synchronized with ${runtimeAssets.length} reviewed runtime assets; ` +
      `${namedCommands} npm command(s) named in app-facing messages all exist.`,
  )
  process.exit(0)
}

const requestedGodot = option('--godot') || process.env.GODOT4 || 'godot4'
const output = resolve(option('--output') || resolve(projectDir, 'build', 'DRCompanionWorldViewer.exe'))
mkdirSync(dirname(output), { recursive: true })

const stage = mkdtempSync(resolve(tmpdir(), 'drc-godot-export-'))
let result
try {
  cpSync(projectDir, stage, {
    recursive: true,
    filter(source) {
      const local = relative(projectDir, source)
      if (!local) return true
      const top = local.split(sep)[0]
      return top !== 'shared-assets' && top !== '.godot' && top !== 'build'
    },
  })
  for (const local of runtimeAssets) {
    const source = resolve(projectDir, local)
    const target = resolve(stage, local)
    mkdirSync(dirname(target), { recursive: true })
    cpSync(source, target)
  }
  result = spawnSync(requestedGodot, [
    '--headless',
    '--path', stage,
    '--export-release', 'Windows Desktop',
    output,
  ], { cwd: root, encoding: 'utf8', stdio: 'pipe', maxBuffer: 16 * 1024 * 1024 })
} finally {
  rmSync(stage, { recursive: true, force: true })
}

if (result.stdout) process.stdout.write(result.stdout)
if (result.stderr) process.stderr.write(result.stderr)
if (result.error) {
  console.error(`Unable to start Godot at ${requestedGodot}: ${result.error.message}`)
  process.exit(1)
}
if (result.status !== 0 || !existsSync(output)) {
  console.error(`Godot viewer export failed with status ${result.status ?? 'unknown'}.`)
  process.exit(result.status || 1)
}

const descriptor = openSync(output, 'r')
const header = Buffer.alloc(2)
readSync(descriptor, header, 0, header.length, 0)
closeSync(descriptor)
if (header.toString('ascii') !== 'MZ') {
  console.error('Godot reported success but the viewer output is not a Windows executable.')
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
}
writeFileSync(resolve(dirname(output), 'viewer-build.json'), `${JSON.stringify(receipt, null, 2)}\n`)
console.log(`Verified Windows viewer export: ${bytes} bytes, sha256 ${receipt.sha256}`)
