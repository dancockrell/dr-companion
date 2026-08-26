/**
 * Talk to DragonRealms through the Genie plugin.
 *
 *   node tools/genie.mjs watch [seconds]        stream what the game is saying
 *   node tools/genie.mjs send "look" [seconds]  send a command, show the reply
 *   node tools/genie.mjs run script.txt         one command per line, in order
 *   node tools/genie.mjs vars <name>...         read Genie's own variables
 *
 * The plugin (genie-plugin/CompanionBridge.cs) publishes newline-delimited
 * JSON on 127.0.0.1:7416 and accepts bare commands back. This is the other
 * end of that.
 *
 * Why this exists rather than clicking: driving Genie through the desktop
 * meant a click could land on the shell whenever focus drifted between two
 * tool calls, which it did constantly. Half the attempts failed for reasons
 * that had nothing to do with the game. A socket has no focus.
 *
 * Every subcommand exits on its own. Nothing here holds the connection open
 * across calls, because a session that outlives the command that made it is
 * a session nobody can see the state of.
 */
import { connect } from 'node:net'
import { readFileSync } from 'node:fs'

const HOST = '127.0.0.1'
const PORT = 7416

/**
 * Lines worth showing.
 *
 * The raw stream is mostly prompts and XML bookkeeping, and a wall of it
 * hides the two lines that matter. Filtering happens here rather than in the
 * plugin so the plugin stays a dumb pipe and the judgement stays where it can
 * be changed without a recompile.
 */
const NOISE = /^\s*$|^>\s*$|^\s*<|^\[Plugin\]/

function open(onEvent) {
  return new Promise((resolve, reject) => {
    const sock = connect(PORT, HOST)
    let buf = ''
    sock.on('data', (chunk) => {
      buf += chunk.toString('utf8')
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i)
        buf = buf.slice(i + 1)
        if (!line.trim()) continue
        try {
          onEvent(JSON.parse(line))
        } catch {
          // A malformed line is the plugin's bug, not a reason to stop
          // listening to the game.
        }
      }
    })
    sock.on('connect', () => resolve(sock))
    sock.on('error', (e) =>
      reject(
        new Error(
          `${e.message}. Is Genie running with the CompanionBridge plugin? ` +
            `Check: the plugin echoes "[companion] listening" on startup.`
        )
      )
    )
  })
}

/** Collect for a while, then stop. Returns the game text seen. */
async function listen(sock, seconds, { quiet = false } = {}) {
  const seen = []
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      sock.end()
      resolve(seen)
    }, seconds * 1000)
    timer.unref?.()
  })
}

const [, , cmd, ...rest] = process.argv

if (!cmd || cmd === 'help') {
  console.log(readFileSync(new URL(import.meta.url)).toString().split('*/')[0])
  process.exit(0)
}

const show = (e) => {
  if (e.t === 'hello') {
    console.error(`connected to ${e.plugin} v${e.version}`)
    return
  }
  if (e.t === 'text' && e.line && !NOISE.test(e.line)) console.log(e.line.replace(/\s+$/, ''))
  if (e.t === 'input') console.log(`  > ${e.line}`)
  if (e.t === 'variable' && cmd === 'vars') console.log(`  ${e.name} = ${e.value}`)
}

const sock = await open(show).catch((e) => {
  console.error(e.message)
  process.exit(1)
})

if (cmd === 'watch') {
  const secs = Number(rest[0]) || 15
  console.error(`watching for ${secs}s`)
  await listen(sock, secs)
} else if (cmd === 'send') {
  const secs = Number(rest[1]) || 4
  sock.write(`send ${rest[0]}\n`)
  await listen(sock, secs)
} else if (cmd === 'run') {
  const lines = readFileSync(rest[0], 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
  const gap = Number(rest[1]) || 3
  for (const line of lines) {
    console.error(`--- ${line}`)
    sock.write(`send ${line}\n`)
    await new Promise((r) => setTimeout(r, gap * 1000))
  }
  sock.end()
} else if (cmd === 'vars') {
  for (const v of rest) sock.write(`var ${v}\n`)
  await listen(sock, 2)
} else {
  console.error(`unknown command: ${cmd}`)
  process.exit(1)
}
