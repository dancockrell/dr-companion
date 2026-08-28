/**
 * A Lich that is not there, so the client can be built before the game is up.
 *
 *   node tools/fake-lich.mjs [--port 11124] [--speed 1]
 *
 * # Why the default is 11124, not the real Lich port
 *
 * It used to default to 11024 - the same port `src-tauri/src/lich.rs`'s
 * `DETACHABLE_PORT` opens a real `--headless` Lich on, and the same one the
 * app's own Attach button defaults to. A copy of this fixture was left
 * running for hours during real development (27 Aug 2026), silently holding
 * that port, so when a real Lich later tried to open `--headless=11024` it
 * simply could not, and Attach would have happily connected to this replay
 * instead - indistinguishable from the real thing, since it speaks the exact
 * same wire protocol on purpose and replays real captured game text.
 *
 * Pass `--port 11024` explicitly if a collision is genuinely what you want to
 * test. The default no longer makes that mistake free.
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

const PORT = Number(arg('port', 11124))
const SPEED = Number(arg('speed', 1))

/**
 * Ports a real Lich needs, which this fixture must never take by accident.
 *
 * Moving the default off 11024 (above) made the mistake un-free. It did not
 * make it impossible, and on 27 Aug 2026 the un-free version happened anyway:
 * a copy left running on 11024 was still holding it hours later, and was found
 * only because somebody went looking for why a real Lich would not start.
 *
 * 11024 is `DETACHABLE_PORT` in src-tauri/src/lich.rs - the game socket.
 * 7415 is the companion bridge. A fixture on either is worse than a fixture
 * that fails to start, because it answers: it speaks the same wire protocol
 * on purpose, so Attach connects and replays captured text that looks exactly
 * like a live game.
 */
const RESERVED_PORTS = new Map([
  [11024, 'the real Lich game socket (DETACHABLE_PORT in src-tauri/src/lich.rs)'],
  [7415, 'the companion bridge'],
])

/** Deliberate collision testing is still allowed - it just has to be said out loud. */
const FORCE_REAL_PORT = process.argv.includes('--force-real-port')

/**
 * How long this fixture may live before it stops on its own.
 *
 * The forgotten-fixture failure is not that starting one is risky; it is that
 * nothing ever ends one. A test tool has no business outliving the test, and
 * the cost of it doing so is paid much later by somebody debugging a port
 * they cannot bind, with no reason to suspect a fixture at all.
 *
 * `--max-minutes 0` disables the limit, for the rare case of genuinely wanting
 * a long-lived replay. That is a decision someone makes, not a default.
 */
const MAX_MINUTES = Number(arg('max-minutes', 30))

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

/**
 * The structured tags a `--stormfront` frontend receives, which nothing in
 * this app reads yet.
 *
 * These are state, not text: vitals as numbers, posture and affliction flags,
 * room contents, exits. The client currently gets all of it by polling the
 * bridge instead, which is a round trip through Ruby to fetch what is already
 * arriving on the socket it is holding.
 *
 * Shapes taken from Lich's own source rather than from memory or from a
 * guess, because the fixture is what a parser will be developed against and a
 * fixture that encodes a guess produces a parser and a test that agree with
 * each other and disagree with the game:
 *
 *   - `detachable_client_send_init` (global_defs.rb:2306) - the exact dump
 *     Lich sends a newly attached client. Every tag below appears there.
 *   - `XMLParser#tag_start` (xmlparser.rb:698, :788) - how Lich reads the
 *     game's own ongoing tags.
 *
 * Cross-checked against 22 seconds of real wire capture from a live
 * DragonRealms session on Phemius, which produced exactly these tag names:
 * dialogData, skin, progressBar, prompt, spell, indicator, compass, dir,
 * output, component, image, pushBold, popBold, crtrStatus.
 *
 * # Three traps a parser author needs before starting
 *
 * **Read `text`, not `value`, for vitals.** Lich's own parser does
 * `attributes['text'].scan(/-?\d+/)` to get [current, max]. In the init dump
 * `value` is hardcoded `'0'` for every bar, so a parser reading `value` gets
 * zero health on a healthy character and nothing errors.
 *
 * **`value` is meaningful only for GemStone bars** - `pbarStance` and
 * `mindState`. Those are the two Lich reads it from.
 *
 * **Hands, wounds and mindstate never arrive in DragonRealms.** The init dump
 * gates `<right>`, `<left>`, `<image id="chest" name="Injury2"/>`,
 * `pbarStance`, `mindState` and `encumlevel` behind
 * `XMLData.game.to_s.match?(/GS/)`. Building a DR panel fed by those tags
 * would wait forever. Confirmed by the live capture: none of them appeared.
 *
 * Sent once on attach, mirroring `detachable_client_send_init`, rather than
 * repeated in the loop - which is also how the real thing behaves, and means
 * a parser that only handles them mid-stream will be caught out here too.
 */
const INIT_TAGS = [
  // value='0' is not a typo. Lich hardcodes it in the init dump and puts the
  // real numbers in `text` - see the trap note above.
  "<progressBar id='mana' value='0' text='mana 98/100'/>",
  "<progressBar id='health' value='0' text='health 100/100'/>",
  "<progressBar id='spirit' value='0' text='spirit 100/100'/>",
  "<progressBar id='stamina' value='0' text='stamina 96/100'/>",
  '<spell>None</spell>',
  // The seven Lich sends, in its own order. `visible` is 'y' or 'n', and an
  // empty string appears in real captures for icons the game has not spoken
  // to yet - which is neither, and must not be read as 'n'.
  "<indicator id='IconBLEEDING' visible='n'/>",
  "<indicator id='IconPOISONED' visible=''/>",
  "<indicator id='IconDISEASED' visible=''/>",
  "<indicator id='IconSTANDING' visible='y'/>",
  "<indicator id='IconKNEELING' visible='n'/>",
  "<indicator id='IconSITTING' visible='n'/>",
  "<indicator id='IconPRONE' visible='n'/>",
  // Short forms only: n ne e se s sw w nw up down out.
  "<compass><dir value='e'/><dir value='s'/><dir value='w'/></compass>",
]

/**
 * Structured tags that arrive during play rather than on attach.
 *
 * `component` wraps room contents and is where Objects and Players come from;
 * `crtrStatus` is how DragonRealms rebuilds its creature roster after a
 * `room objs` component, per the comment at xmlparser.rb:457.
 */
const LIVE_TAGS = [
  ["<component id='room objs'>You also see <d>a stone stairway</d>.</component>", 1200],
  ["<component id='room players'>Also here: <d>Wipsy</d>.</component>", 1400],
  ["<progressBar id='stamina' value='96' text='stamina 96/100'/>", 900],
  ["<indicator id='IconKNEELING' visible='y'/>", 1100],
  ["<indicator id='IconSTANDING' visible='n'/>", 60],
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

    // The attach-time state dump, once, before the replay starts - mirroring
    // `detachable_client_send_init`. Only in tagged mode: a frontend with no
    // xml capability never receives these, so sending them in plain mode
    // would be the fixture inventing a state the real thing cannot produce.
    //
    // Sent as one write, as Lich does (`client.puts_main_stream(init_str)`),
    // rather than line by line. That matters: a parser that assumes one tag
    // per read passes against a tidier fixture and fails against Lich.
    if (TAGGED) {
      socket.write(INIT_TAGS.join('') + EOL)
      await new Promise((r) => setTimeout(r, 200))
    }

    while (alive) {
      pass++
      // Structured tags interleaved with the text, which is how they arrive.
      // Appended rather than woven in at a fixed point so the text replay
      // stays byte-identical to what was captured.
      const script = TAGGED ? [...CAPTURED_TAGGED, ...LIVE_TAGS] : CAPTURED
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

// Checked before listen(), so a refusal costs nothing and cannot leave a
// half-bound socket behind. Exits non-zero and names the port, the owner and
// the override: a guard that fires without saying how to proceed just gets
// worked around by the next person in a hurry.
const reservedFor = RESERVED_PORTS.get(PORT)
if (reservedFor && !FORCE_REAL_PORT) {
  console.error(`fake-lich: refusing to bind ${PORT} - that is ${reservedFor}.`)
  console.error(
    'A fixture here does not fail loudly, it ANSWERS: it speaks the same wire'
  )
  console.error(
    'protocol, so Attach connects to replayed text and reports a healthy game.'
  )
  console.error(
    `Use the default (11124), or pass --force-real-port if colliding is the point.`
  )
  process.exit(2)
}

server.listen(PORT, '127.0.0.1', () => {
  console.error(`fake Lich listening on 127.0.0.1:${PORT} (speed ${SPEED}x)`)
  console.error(
    `this is a fixture of captured DragonRealms text, not a game` +
      ` (${TAGGED ? 'tagged stream' : 'plain text'}${SPLIT ? ', split across reads' : ''})`
  )
  if (reservedFor) {
    console.error(
      `WARNING: bound ${PORT}, which is ${reservedFor}. A real Lich cannot start while this runs.`
    )
  }

  if (MAX_MINUTES > 0) {
    console.error(`this fixture will stop on its own in ${MAX_MINUTES} minutes (--max-minutes 0 to disable)`)
    // unref() so the timer never keeps the process alive by itself - this is
    // a deadline, not a reason to exist. Without it a fixture whose server
    // had closed would linger until the timer fired.
    setTimeout(() => {
      console.error(`fake-lich: ${MAX_MINUTES} minute limit reached, exiting so this port is not held for ever.`)
      process.exit(0)
    }, MAX_MINUTES * 60_000).unref()
  }
})
