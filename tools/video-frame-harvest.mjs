/**
 * Turn one generated video into a folder of candidate stamp frames.
 *
 *   node tools/video-frame-harvest.mjs <video-file> [--out DIR] [--every SECONDS] [--max N]
 *
 * The map-stamp art under public/map-stamps/ is generated one still image at
 * a time, and 22 of its 27 terrain/service kinds only have two variants each
 * (see MapStampLayer.tsx's STAMP_ART) - reused often enough across an
 * 85-zone, 17,750-room map that the repetition shows. A single generated
 * video - a camera pan across a fantasy town, a walk down a street, a slow
 * turn through a scene - contains dozens of usable, already-lit,
 * already-composed stills for the price of one generation. This is the
 * "cut it up" half of that pipeline; the video itself comes from whatever
 * Magnific-style tool Quartermaster ends up gating that job on (see
 * quartermaster#16 - no verified path to drive one exists yet), and once a
 * video lands on disk, this script is what turns it into frames worth
 * looking at.
 *
 * Default mode extracts on scene changes, not a fixed interval. A slow pan
 * or held shot produces near-duplicate frames every fixed N seconds and
 * wastes review time on repeats; a scene-change threshold instead pulls the
 * moments the video is actually composed differently, which is what "cheap,
 * high quality, and distinct" needs. --every switches to fixed-interval
 * sampling for a source where that's actually the wanted behavior (e.g. a
 * deliberately steady walk-cycle you want evenly sampled).
 *
 * Output is raw frames for a human to curate, deliberately not
 * auto-cropped or background-stripped to a stamp's exact aspect - the STAMP_ART
 * entries each need a specific crop/scale/opacity picked by eye, and
 * guessing that here would produce assets nobody actually looks at before
 * they ship, which is exactly the failure mode this app's own map-stamp
 * doc comments warn about (drawing a placeholder rather than nothing).
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { basename, extname, join } from 'node:path'

function usageAndExit(message) {
  if (message) console.error(`error: ${message}\n`)
  console.error('usage: node tools/video-frame-harvest.mjs <video-file> [--out DIR] [--every SECONDS] [--max N] [--scene THRESHOLD]')
  process.exit(1)
}

const args = process.argv.slice(2)
const videoPath = args.find((a) => !a.startsWith('--'))
if (!videoPath) usageAndExit('no input video given')
if (!existsSync(videoPath)) usageAndExit(`no such file: ${videoPath}`)

function flag(name, fallback) {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? fallback : args[i + 1]
}

const every = flag('every', null)
const max = Number(flag('max', 60))
const sceneThreshold = Number(flag('scene', 0.28))
const stem = basename(videoPath, extname(videoPath)).replace(/[^a-z0-9-]+/gi, '-').toLowerCase()
const outDir = flag('out', join('data', 'art', 'stamp-frames', stem))

mkdirSync(outDir, { recursive: true })

// ffmpeg is a Quartermaster-known capability (discover.rs lists it by name,
// probe "-version", expect "ffmpeg version") - probed the same way here so
// this script fails with the same clear message a Quartermaster job would
// see rather than a raw ENOENT from spawnSync.
const probe = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' })
if (probe.error || !probe.stdout?.includes('ffmpeg version')) {
  usageAndExit('ffmpeg not found on PATH - this is exactly the capability Quartermaster would gate this job on')
}

const pattern = join(outDir, `${stem}-%04d.png`)
const vf = every
  ? `fps=1/${Number(every)}`
  : `select='gt(scene,${sceneThreshold})',setpts=N/FRAME_RATE/TB`

const result = spawnSync(
  'ffmpeg',
  ['-y', '-i', videoPath, '-vf', vf, '-fps_mode', 'vfr', '-frames:v', String(max), pattern],
  { encoding: 'utf8' }
)

if (result.status !== 0) {
  console.error(result.stderr?.slice(-2000) ?? '(no stderr captured)')
  usageAndExit(`ffmpeg exited ${result.status}`)
}

const produced = readdirSync(outDir).filter((f) => f.startsWith(`${stem}-`) && f.endsWith('.png'))
if (produced.length === 0) {
  // A scene-change filter that never crosses its threshold produces zero
  // frames and ffmpeg still exits 0 - that is a config problem (threshold
  // too high, or a source with no real scene changes at all, e.g. a locked-
  // off shot), not success. Say so rather than reporting a quiet "done".
  usageAndExit(
    every
      ? 'ffmpeg ran but wrote no frames - check the video actually has that many seconds of content'
      : `no frame crossed the scene-change threshold (${sceneThreshold}) - try a lower --scene value, or --every SECONDS for a fixed-interval sample instead`
  )
}

const totalBytes = produced.reduce((sum, f) => sum + statSync(join(outDir, f)).size, 0)
console.log(
  `${produced.length} frame(s) written to ${outDir} (${(totalBytes / 1024 / 1024).toFixed(1)} MB total).\n` +
    `Mode: ${every ? `fixed interval, one every ${every}s` : `scene-change, threshold ${sceneThreshold}`}, capped at ${max}.\n` +
    `Next step is manual: look at what actually landed, pick what's usable, crop/process each pick to the aspect ratio\n` +
    `its target STAMP_ART entry (or new pin icon) needs, and only then does it become a real asset.`
)
