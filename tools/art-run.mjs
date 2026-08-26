/**
 * Generate images from a prompt file through a local ComfyUI.
 *
 *   node tools/art-run.mjs creatures 6        first six creatures
 *   node tools/art-run.mjs creatures 6 --pick Kobold,Antelope
 *
 * The model is FLUX.1-schnell and the licence is why: schnell is Apache 2.0
 * and puts no conditions on its output, so the pack can be given to
 * Simutronics and shipped commercially. FLUX.1-dev is on this machine and is
 * non-commercial, which would make the gift legally useless. Never swap it.
 * See DESIGN.md S4.
 *
 * Everything that could vary between two images is pinned here, because style
 * consistency is a stated reject condition: one checkpoint, one step count,
 * one guidance value, no LoRAs, and a seed derived from the subject name so a
 * regeneration reproduces rather than reinvents.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const HOST = 'http://127.0.0.1:8188'
const CKPT = 'flux1-schnell-fp8.safetensors'
/** schnell is a four-step model. More steps is not better, it is just slower. */
const STEPS = 4
/** schnell is distilled and ignores guidance; 1.0 is the documented value. */
const CFG = 1.0

const SOURCES = {
  creatures: 'data/art/creature-prompts.json',
  rooms: 'data/art/room-prompts.json',
}

function workflow(entry, filenamePrefix) {
  return {
    1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: CKPT } },
    2: { class_type: 'CLIPTextEncode', inputs: { text: entry.prompt, clip: ['1', 1] } },
    3: { class_type: 'CLIPTextEncode', inputs: { text: entry.negative ?? '', clip: ['1', 1] } },
    4: {
      class_type: 'EmptyLatentImage',
      inputs: { width: entry.width, height: entry.height, batch_size: 1 },
    },
    5: {
      class_type: 'KSampler',
      inputs: {
        seed: entry.seed,
        steps: STEPS,
        cfg: CFG,
        sampler_name: 'euler',
        scheduler: 'simple',
        denoise: 1,
        model: ['1', 0],
        positive: ['2', 0],
        negative: ['3', 0],
        latent_image: ['4', 0],
      },
    },
    6: { class_type: 'VAEDecode', inputs: { samples: ['5', 0], vae: ['1', 2] } },
    // WebP rather than PNG, through the animated node with a single frame.
    // Nothing on this machine can encode WebP (no magick, ffmpeg, cwebp or
    // sharp) and adding an image library for one conversion is a dependency
    // the pack does not need. The size difference is not cosmetic: PNG at
    // 832x1216 is around 680 KB against roughly 180 KB, which across 18,490
    // rooms is the difference between a 3 GB download and a 12 GB one.
    7: {
      class_type: 'SaveAnimatedWEBP',
      inputs: {
        images: ['6', 0],
        filename_prefix: filenamePrefix,
        fps: 1,
        lossless: false,
        quality: 90,
        method: 'slowest',
      },
    },
  }
}

const slug = (s) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)

async function post(path, body) {
  const res = await fetch(`${HOST}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${path} ${res.status}: ${await res.text()}`)
  return res.json()
}

/** Wait for one prompt to finish, or give up loudly rather than hang forever. */
async function waitFor(promptId, timeoutMs = 300_000) {
  const started = Date.now()
  for (;;) {
    const h = await (await fetch(`${HOST}/history/${promptId}`)).json()
    const entry = h[promptId]
    if (entry?.status?.completed) return entry
    if (entry?.status?.status_str === 'error') {
      throw new Error(JSON.stringify(entry.status.messages ?? entry.status).slice(0, 400))
    }
    if (Date.now() - started > timeoutMs) throw new Error('timed out waiting for the render')
    await new Promise((r) => setTimeout(r, 1500))
  }
}

const kind = process.argv[2] ?? 'creatures'
const limit = Number(process.argv[3] ?? 6)
const pickArg = process.argv.indexOf('--pick')
const picks = pickArg > 0 ? process.argv[pickArg + 1].split(',') : null

const file = SOURCES[kind]
if (!file || !existsSync(file)) {
  console.error(`no prompt file for "${kind}" (${file})`)
  process.exit(1)
}

const prompts = JSON.parse(readFileSync(file, 'utf8'))
const names = picks ?? Object.keys(prompts).slice(0, limit)

mkdirSync('data/art/out', { recursive: true })
const manifest = existsSync('data/art/manifest.json')
  ? JSON.parse(readFileSync('data/art/manifest.json', 'utf8'))
  : {}

console.log(`${names.length} to render, ${STEPS} steps, ${CKPT}`)
let done = 0
for (const name of names) {
  const entry = prompts[name]
  if (!entry) {
    console.log(`  skip ${name}: not in the prompt file`)
    continue
  }
  const prefix = `${kind}/${slug(name)}`
  const started = Date.now()
  try {
    const { prompt_id } = await post('/prompt', { prompt: workflow(entry, prefix) })
    const result = await waitFor(prompt_id)
    const images = Object.values(result.outputs ?? {}).flatMap((o) => o.images ?? [])
    manifest[name] = {
      kind,
      seed: entry.seed,
      source: entry.source,
      files: images.map((i) => join(i.subfolder, i.filename)),
      steps: STEPS,
      checkpoint: CKPT,
    }
    done++
    console.log(
      `  ${String(done).padStart(3)}/${names.length}  ${((Date.now() - started) / 1000).toFixed(1)}s  ${name}`
    )
  } catch (e) {
    console.log(`  FAIL ${name}: ${e.message}`)
  }
}

writeFileSync('data/art/manifest.json', JSON.stringify(manifest, null, 1))
console.log(`${done} rendered, manifest has ${Object.keys(manifest).length}`)
