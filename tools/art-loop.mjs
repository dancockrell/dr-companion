/**
 * Keep rendering until there is nothing left.
 *
 *   node tools/art-loop.mjs
 *
 * The art pack is about 42 hours of GPU time: 767 creatures and 18,490 rooms
 * at roughly eight seconds each. That is longer than any session, longer than
 * most uptimes, and certainly longer than anyone wants to babysit.
 *
 * So this is the durable half. It walks the queues in priority order, renders
 * one thing at a time, records each success in the manifest as it goes, and
 * picks up exactly where it left off when restarted. Interruption is assumed
 * rather than guarded against: a reboot, a game that wants the GPU, or closing
 * the window all cost the one image in flight and nothing else.
 *
 * The pattern is borrowed from the claude-agent runner in this repo's sibling
 * project — leave a window open, it works, close it and it stops.
 *
 * Creatures first because there are far fewer of them and they appear on
 * cards the moment they exist. Rooms are the long tail.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

const QUEUES = [
  { kind: 'portraits', file: 'data/art/portrait-prompts.json' },
  { kind: 'creatures', file: 'data/art/creature-prompts.json' },
  { kind: 'rooms', file: 'data/art/room-prompts.json' },
]

/** How many to render before re-reading the manifest and reporting progress. */
const CHUNK = 25

const read = (f) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {})

function remaining(file) {
  if (!existsSync(file)) return 0
  const done = new Set(Object.keys(read('data/art/manifest.json')))
  return Object.keys(read(file)).filter((k) => !done.has(k)).length
}

function comfyUp() {
  const r = spawnSync(
    process.execPath,
    ['-e', "fetch('http://127.0.0.1:8188/system_stats').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"],
    { timeout: 10_000 }
  )
  return r.status === 0
}

console.log('art loop starting. Close this window to stop it.')

for (;;) {
  if (!comfyUp()) {
    // Not an error. ComfyUI gets closed to free the GPU for the game, and the
    // right response is to wait rather than to fail and lose the queue.
    console.log('ComfyUI is not answering on 8188. Waiting a minute.')
    spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},60000)'])
    continue
  }

  const next = QUEUES.find((q) => remaining(q.file) > 0)
  if (!next) {
    console.log('nothing left to render.')
    break
  }

  const left = remaining(next.file)
  console.log(`${next.kind}: ${left.toLocaleString()} to go`)

  const r = spawnSync(process.execPath, ['tools/art-run.mjs', next.kind, String(CHUNK)], {
    stdio: 'inherit',
  })

  // A failing chunk should not spin. If the run died rather than rendering,
  // pause before trying again so a persistent fault does not fill the disk
  // with log lines at full speed.
  if (r.status !== 0) {
    console.log('that chunk failed. Waiting thirty seconds.')
    spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},30000)'])
  }
}
