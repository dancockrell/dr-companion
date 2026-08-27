/**
 * A Lich that is not there, so the client can be built before the game is up.
 *
 *   node tools/fake-lich.mjs [--port 11024] [--speed 1]
 *
 * Lich's `--detachable-client=PORT` opens a TCPServer and hands the accepted
 * socket to `$_CLIENT_`: it writes game output to it and reads player commands
 * from it. There is no handshake and no framing beyond newlines. That is the
 * entire protocol the frontend has to speak, which is why this fixture is
 * eighty lines rather than a project.
 *
 * # Why a fixture rather than waiting for a login
 *
 * Attaching to a real Lich needs an account password typed into Lich's own
 * window, which is a person's job and not something to block development on.
 * More importantly, a live game is a terrible test rig: it never sends the same
 * thing twice, it will not produce a mind-lock message on request, and it
 * cannot be replayed after a change to see whether the change helped.
 *
 * The lines below are real, captured off the wire on 27 Aug 2026 during a
 * session on Phemius. Invented game text would encode what somebody assumed
 * DragonRealms looks like, and this project has already been bitten twice by
 * exactly that - a GemStone mindstate ladder in a DragonRealms config, and a
 * wound scale that stopped at "severe".
 */
import { createServer } from 'node:net'

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const PORT = Number(arg('port', 11024))
const SPEED = Number(arg('speed', 1))

/**
 * Send the tagged stream an xml-capable frontend receives, rather than plain
 * text.
 *
 *   node tools/fake-lich.mjs --tagged
 *
 * Lich sends plain text only to a frontend with no xml capability. Every
 * frontend anybody uses has it, so plain text is the *unusual* case and the
 * fixture defaulting to it was quietly testing the path that matters least.
 *
 * The tags here are the ones the parser has to survive: streams pushed and
 * popped, bold room titles, prompts, and markup around text that must be kept.
 */
const TAGGED = process.argv.includes('--tagged')

/**
 * Deliver each line in two pieces, split at a point chosen to fall inside a
 * tag where there is one.
 *
 *   node tools/fake-lich.mjs --tagged --split
 *
 * This is the case a fixture that sends whole lines can never produce, and the
 * one a real socket produces constantly. A parser that splits lines before
 * parsing tags passes every test until it meets a real network.
 */
const SPLIT = process.argv.includes('--split')

/**
 * Observed traffic, in the order and rough density it actually arrived.
 *
 * Firulf Vista at a busy hour: eighteen movement events in ninety seconds,
 * each reprinting the room. That density is the point of the fixture rather
 * than an accident of capture - it is what a text pane has to survive, and a
 * gentle trickle of tidy lines would prove nothing about scrollback.
 */
const CAPTURED = [
  ['[The Crossing, Firulf Vista]', 900],
  ['You also see a stone stairway.', 60],
  ['Obvious paths: east, south, west.', 60],
  ['Wipsy just arrived.', 1400],
  ['[The Crossing, Firulf Vista]', 80],
  ['You also see a stone stairway.', 60],
  ['Also here: Wipsy.', 60],
  ['Obvious paths: east, south, west.', 60],
  ['Wipsy runs south.', 2200],
  ['You feel fully attuned to the mana streams again.', 1800],
  ['A shaggy mutt bounds into the area.', 1500],
  ['You notice as a black lynx pads into the area.', 2000],
  ['The black lynx pads off.', 1700],
  ['Serial Killer Damiza just arrived.', 1200],
  ['Also here: Serial Killer Damiza who is surrounded by a purple cloud of glitter.', 60],
  ['A town guard walks in, glancing about with a false look of boredom on his face.', 2400],
  ['     Performance:      5 07% perusing       (2/34)', 2600],
  ['The armor on your head makes playing your cocobolo txistu more difficult.', 1500],
  ['Commoner Brommoner came down a stone stairway.', 1900],
  ['Commoner Brommoner hobbles east.', 1600],
  ['You are relaxed and your mind has entered a light state of rest.  To wake up and start learning again, type: AWAKEN.', 3000],
  ['GENIE HAS FLAGGED YOU AS IDLE, PLEASE RESPOND!', 2200],
]

/**
 * The same traffic, tagged the way Lich tags it for an xml frontend.
 *
 * Room titles are bold, thoughts and deaths are their own streams, and a
 * prompt closes each exchange. Everything here mirrors a line in CAPTURED so
 * the two modes are the same session told two ways.
 */
const CAPTURED_TAGGED = [
  ["<pushBold/>[The Crossing, Firulf Vista]<popBold/>", 900],
  ['You also see <d cmd="look #4021">a stone stairway</d>.', 60],
  ['Obvious paths: <d cmd="east">east</d>, <d cmd="south">south</d>.', 60],
  ['<prompt time="1756300001">&gt;</prompt>', 40],
  ['Wipsy just arrived.', 1400],
  ["<pushStream id='thoughts'/>You hear the faint thoughts of Wipsy echo in your mind: anyone selling a lockpick ring<popStream/>", 1800],
  ['You feel fully attuned to the mana streams again.', 1800],
  ['A shaggy mutt bounds into the area.', 1500],
  ["<pushStream id='death'/>  * Someone was just struck down!<popStream/>", 2000],
  ["<pushStream id='talk'/>Someone says, &quot;Well met.&quot;<popStream/>", 1700],
  ['The armor on your head makes playing your cocobolo txistu more difficult.', 1500],
  ['     Performance:      5 07% perusing       (2/34)', 2600],
  ['<prompt time="1756300060">&gt;</prompt>', 40],
  ['GENIE HAS FLAGGED YOU AS IDLE, PLEASE RESPOND!', 2200],
]

/** What the game says back to a command, for the few worth answering. */
const REPLIES = {
  look: [
    '[The Crossing, Firulf Vista]',
    'You also see a stone stairway.',
    'Obvious paths: east, south, west.',
  ],
  exp: ['     Performance:      5 07% perusing       (2/34)', 'Overall state of mind: clear'],
  awaken: ['You awaken from your reverie and begin to take in the world around you (You will now begin to gain new experience again)'],
  health: ['You have no significant injuries.'],
}

const server = createServer((socket) => {
  console.error(`client attached from ${socket.remoteAddress}`)
  socket.setNoDelay(true)

  let alive = true
  socket.on('close', () => {
    alive = false
    console.error('client detached')
  })
  socket.on('error', () => {
    alive = false
  })

  // Commands arrive newline-delimited, exactly as Lich reads them.
  let buf = ''
  socket.on('data', (chunk) => {
    buf += chunk.toString('utf8')
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, '')
      buf = buf.slice(i + 1)
      if (!line.trim()) continue
      console.error(`  > ${line}`)
      const reply = REPLIES[line.trim().toLowerCase().split(/\s+/)[0]]
      if (reply) for (const r of reply) socket.write(r + '\r\n')
      else socket.write(`...wait, what?  (the fixture has no answer for ${JSON.stringify(line)})\r\n`)
    }
  })

  // Replay on a loop, so a pane can be left running to see how it behaves
  // after ten thousand lines rather than after twenty.
  ;(async () => {
    let pass = 0
    // The terminator, built rather than written, so no escape sequence lives
    // in this file for a shell or an editor to mangle on the way in. Three
    // separate edits today were eaten by exactly that.
    const EOL = String.fromCharCode(13) + String.fromCharCode(10)
    while (alive) {
      pass++
      const script = TAGGED ? CAPTURED_TAGGED : CAPTURED
      for (const [line, gap] of script) {
        if (!alive) return
        const payload = line + EOL

        if (SPLIT && payload.length > 8) {
          // Split inside a tag where there is one, so the parser has to hold
          // a partial tag across reads. A split at a random offset usually
          // lands in plain text and proves nothing.
          const tagAt = payload.indexOf("<")
          const at = tagAt >= 0
            ? Math.min(payload.length - 1, tagAt + 4)
            : Math.floor(payload.length / 2)
          socket.write(payload.slice(0, at))
          await new Promise((r) => setTimeout(r, 15))
          if (!alive) return
          socket.write(payload.slice(at))
        } else {
          socket.write(payload)
        }

        await new Promise((r) => setTimeout(r, Math.max(1, gap / SPEED)))
      }
      socket.write("--- fixture pass " + pass + " complete ---" + EOL)
    }
  })()
})

server.listen(PORT, '127.0.0.1', () => {
  console.error(`fake Lich listening on 127.0.0.1:${PORT} (speed ${SPEED}x)`)
  console.error(
    `this is a fixture of captured DragonRealms text, not a game` +
      ` (${TAGGED ? 'tagged stream' : 'plain text'}${SPLIT ? ', split across reads' : ''})`
  )
})
