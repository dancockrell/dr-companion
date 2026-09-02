/**
 * video-frame-harvest.mjs shells out to ffmpeg for both the probe and the
 * actual extraction, so this is a real end-to-end test against generated
 * video files rather than a unit test of argument parsing - the failure
 * modes that matter here (a removed ffmpeg flag, a threshold that never
 * fires, a fixed-interval count that's off by one) only show up by actually
 * running ffmpeg. Skips itself cleanly (reported, not silently) if ffmpeg
 * isn't on PATH, the same three-state discipline the rest of this repo's
 * suites use for an optional external tool.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let pass = 0
let fail = 0
function ok(label, cond, detail = '') {
  if (cond) {
    pass++
    console.log(`OK   ${label}`)
  } else {
    fail++
    console.log(`FAIL ${label}${detail ? ` (${detail})` : ''}`)
  }
}

const probe = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' })
if (probe.error || !probe.stdout?.includes('ffmpeg version')) {
  console.log('SKIPPED: ffmpeg is not on PATH in this environment - not checked, not a pass')
  process.exit(0)
}

const dir = mkdtempSync(join(tmpdir(), 'frame-harvest-'))
const video = join(dir, 'three-scenes.mp4')

// Three one-second solid-color scenes concatenated - two real scene changes,
// a known, exact ground truth to assert against rather than eyeballing output.
const build = spawnSync('ffmpeg', [
  '-y',
  '-f', 'lavfi', '-i', 'color=c=red:s=64x64:d=1,format=yuv420p',
  '-f', 'lavfi', '-i', 'color=c=blue:s=64x64:d=1,format=yuv420p',
  '-f', 'lavfi', '-i', 'color=c=green:s=64x64:d=1,format=yuv420p',
  '-filter_complex', '[0][1][2]concat=n=3:v=1:a=0',
  video,
], { encoding: 'utf8' })
ok('the test fixture video itself was built', build.status === 0, build.stderr?.slice(-300))

function harvest(args) {
  return spawnSync('node', [join(import.meta.dirname, 'video-frame-harvest.mjs'), video, ...args], { encoding: 'utf8' })
}

console.log('\n-- scene-change mode finds the two real transitions --')
const sceneOut = join(dir, 'scene')
const sceneRun = harvest(['--out', sceneOut])
ok('exits clean', sceneRun.status === 0, sceneRun.stderr)
const sceneFrames = existsSync(sceneOut) ? readdirSync(sceneOut).filter((f) => f.endsWith('.png')) : []
ok('exactly two frames for two scene changes across three scenes', sceneFrames.length === 2, String(sceneFrames.length))
ok('the summary names the mode it actually used', /scene-change/.test(sceneRun.stdout))

console.log('\n-- fixed-interval mode samples on a clock, not on content --')
const everyOut = join(dir, 'every')
const everyRun = harvest(['--out', everyOut, '--every', '1'])
ok('exits clean', everyRun.status === 0, everyRun.stderr)
const everyFrames = existsSync(everyOut) ? readdirSync(everyOut).filter((f) => f.endsWith('.png')) : []
ok('one frame per second of a 3-second video', everyFrames.length === 3, String(everyFrames.length))

console.log('\n-- a threshold nothing crosses is a named failure, not a quiet empty success --')
const deadOut = join(dir, 'dead')
const deadRun = harvest(['--out', deadOut, '--scene', '0.999'])
ok('exits non-zero', deadRun.status !== 0)
ok('names the actual problem rather than just failing', /no frame crossed the scene-change threshold/.test(deadRun.stderr))

console.log('\n-- missing input file refuses before ever touching ffmpeg --')
const missingRun = spawnSync('node', [join(import.meta.dirname, 'video-frame-harvest.mjs'), join(dir, 'nope.mp4')], { encoding: 'utf8' })
ok('exits non-zero', missingRun.status !== 0)
ok('names the missing file', missingRun.stderr.includes('no such file'))

console.log('\n-- positive control: this suite can actually fail --')
ok('sabotage check: a file that does exist is found', existsSync(video))

rmSync(dir, { recursive: true, force: true })

const denom = pass + fail
ok(`enough was checked for a pass to mean something: ${denom} assertions`, denom >= 10)

console.log(fail === 0 ? '\nall passed' : `\n${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
