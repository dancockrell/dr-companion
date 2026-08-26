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
 * KNOWN GAP, and it shapes how you use this: the plugin sees server text and
 * nothing else. Genie's own client-side output never reaches IPlugin.ParseText,
 * so #echo, #reload, #highlight and every other client command come back
 * silent. Probed directly: "#echo ZQ-PROBE-7731" produced no line on the
 * socket.
 *
 * That means every # command sent through here is fire-and-forget. There is no
 * acknowledgement, and success and failure are indistinguishable from this
 * side - the exact shape of bug that has cost the most time on this project.
 * So: verify a config change by reading the file back, not by sending #reload
 * and moving on. If something has to be confirmed from inside Genie, it has to
 * be confirmed by a human looking at the window.
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

/**
 * The auto-look, which is most of the wire and almost none of the information.
 *
 * Every time anybody walks into or out of the room, DragonRealms replays the
 * whole room description between `@suspend@` and `@resume@` markers. In a busy
 * gate room that is forty lines a minute of text that has not changed since the
 * last time it was sent, and it buries the one line that did.
 *
 * So the replayed block is dropped and the line that is actually new - who
 * arrived, who left, by which exit - is kept. `--all` turns the filter off for
 * when the description itself is the thing being read.
 *
 * These four are kept inside the block on purpose. The room title and the exits
 * are the only lines in it that change when *you* move, and losing them would
 * make the stream useless for navigation, which is the thing it exists to
 * support. Who is present is kept for the same reason as the arrival lines.
 */
const KEEP_IN_BLOCK = /^\[|^Obvious paths|^Also here|^You also see/

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

const ALL = process.argv.includes('--all')
let suspended = false
let lastLine = ''

const show = (e) => {
  if (e.t === 'hello') {
    console.error(`connected to ${e.plugin} v${e.version}`)
    return
  }
  if (e.t === 'text' && typeof e.line === 'string') {
    const line = e.line.replace(/\s+$/, '')
    if (line.startsWith('@suspend@')) {
      suspended = true
      return
    }
    if (line.startsWith('@resume@')) {
      suspended = false
      return
    }
    if (suspended && !ALL && !KEEP_IN_BLOCK.test(line)) return
    if (!line || NOISE.test(line)) return

    // The same line twice running is the auto-look repeating itself, not the
    // room changing. Suppressed by content rather than by position, because
    // the markers do not survive every code path the game sends text down.
    if (ALL || line !== lastLine) console.log(line)
    lastLine = line
    return
  }
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
  const raw = readFileSync(rest[0], 'utf8').split('\n').map((l) => l.trim())

  // Comments are `//`, not `#`.
  //
  // The first version skipped lines starting with `#`, which is the ordinary
  // convention and exactly wrong here: every Genie client command begins with
  // `#`. So a script of `#echo`, `#highlight`, `#config` lines was filtered
  // down to nothing, sent nothing, printed no error and exited 0. It reported
  // success for doing precisely nothing, which is the same shape as every
  // other silent-success bug and took a screenshot of the game window to
  // notice.
  const lines = raw.filter((l) => l && !l.startsWith('//'))

  if (!lines.length) {
    console.error(`${rest[0]} has no commands in it (comments are //, not #)`)
    process.exit(1)
  }

  const gap = Number(rest[1]) || 3
  console.error(`sending ${lines.length} command(s)`)
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
