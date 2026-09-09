#!/usr/bin/env node
/**
 * Photograph the Lich card in every state it has.
 *
 *   node tools/lich-card-shots.mjs [--port 8123] [--out docs/verification]
 *
 * Starts the harness dev server (`tools/lich-card-harness/`), drives a real
 * browser at one state per shot, and saves a PNG per state. Kills the server
 * by the pid it started, never by name - several sessions run dev servers here
 * and `CLAUDE.md` section 4 is about exactly this.
 *
 * # Three states, in a screenshot tool
 *
 * A shot of a page that failed to render looks like a shot of a state with
 * nothing in it. So each shot is preceded by two readings the run refuses to
 * proceed without: the page's own `document.title`, which the harness sets to
 * the state it is actually rendering (a shot filed under the wrong name is
 * worse than no shot), and the card's rendered text, which must be non-empty
 * and must contain the sentence that state is supposed to say.
 */
import { spawn } from 'node:child_process'
import { mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launch } from './browser.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : fallback
}
const port = Number(arg('port', 8123))
const outDir = arg('out', join(root, 'docs', 'verification'))
const stamp = arg('stamp', '2026-09-09')

// Ports known to be spoken for on this machine. Named rather than probed
// because a probe only sees what is listening this second.
if ([1420, 5180, 5184, 11024].includes(port)) {
  console.error(`ABORT: port ${port} is in use by something else on this machine.`)
  process.exit(2)
}

/** What each state must be saying, so an empty or wrong render is caught. */
const EXPECT = {
  ready: 'Sign in above to start Lich for a character.',
  'gui-usable': "Open Lich's own window",
  'health-ok': 'starts cleanly',
  'health-broken': 'Lich is installed but does not start.',
  running: 'Nothing to do here.',
  'not-installed': 'Connection help below',
  'no-ruby': 'Connection help below',
}

mkdirSync(outDir, { recursive: true })

// Vite's own entry under this Node, not `npx`: spawning a `.cmd` on Windows
// needs a shell, and a shell is one more thing between the pid this run holds
// and the process it must be able to kill.
const viteBin = join(root, 'node_modules', 'vite', 'bin', 'vite.js')
if (!existsSync(viteBin)) {
  console.error(`ABORT: ${viteBin} is missing. Junction node_modules into this worktree first.`)
  process.exit(2)
}
const server = spawn(
  process.execPath,
  [viteBin, '--config', 'tools/lich-card-harness/vite.harness.config.ts', '--port', String(port)],
  { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] },
)
let serverOut = ''
server.stdout.on('data', (d) => (serverOut += d))
server.stderr.on('data', (d) => (serverOut += d))
// The pid this run created. Nothing else is ever killed.
const pid = server.pid
console.log(`harness dev server pid ${pid} on ${port}`)

const stop = () => {
  if (!pid) return
  try {
    if (process.platform === 'win32') spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
    else process.kill(pid)
  } catch {
    /* already gone */
  }
}
process.on('exit', stop)

// Vite colours its banner, so the URL sits behind ANSI escapes and a naive
// /Local:\s+http/ never matches. Strip them before reading, or the run
// reports a server that is up as one that never started.
const ESC = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g')
const plain = () => serverOut.replace(ESC, '')
const ready = async () => {
  for (let i = 0; i < 120; i++) {
    if (/Local:\s+http:\/\//.test(plain())) return true
    if (/EADDRINUSE|Port .* is in use|is already in use/i.test(plain())) return false
    await new Promise((r) => setTimeout(r, 250))
  }
  return false
}
if (!(await ready())) {
  console.error(`ABORT: the harness dev server did not come up on ${port}.\n${plain()}`)
  stop()
  process.exit(2)
}

const { STATES } = await import('./lich-card-harness/states.ts')
const b = await launch({ width: 520, height: 460 })
let good = 0
try {
  for (const s of STATES) {
    // The harness page has no <main>; wait for the card's own container.
    await b.goto(`http://127.0.0.1:${port}/?state=${s.slug}`, { waitFor: '#root' })
    // Give React a tick to run the effect that reads `lich_status`, and for
    // the health states the deliberate second call.
    await new Promise((r) => setTimeout(r, 400))
    if (s.health) await b.click('button', /why won't it start/i).catch(() => {})
    await new Promise((r) => setTimeout(r, 400))

    const title = await b.eval('document.title')
    const text = await b.eval('(document.body.innerText || "").trim()')
    const file = join(outDir, `lich-panel-${stamp}-${s.slug}.png`)
    const want = EXPECT[s.slug]
    const rendered = typeof text === 'string' && text.length > 0
    const named = title === `lich-card:${s.slug}`
    const says = rendered && text.includes(want)
    if (!named || !says) {
      console.log(`FAIL ${s.slug.padEnd(15)} title=${JSON.stringify(title)} text=${JSON.stringify(String(text).slice(0, 160))}`)
      continue
    }
    await b.screenshot(file)
    if (!existsSync(file)) {
      console.log(`FAIL ${s.slug.padEnd(15)} the screenshot was not written`)
      continue
    }
    good++
    console.log(`OK   ${s.slug.padEnd(15)} ${JSON.stringify(String(text).replace(/\s+/g, ' ').slice(0, 110))}`)
    console.log(`     ${''.padEnd(15)} -> ${file}`)
  }
} finally {
  await b.close()
  stop()
}
console.log(`\n${good} of ${STATES.length} states photographed`)
process.exit(good === STATES.length ? 0 : 1)
