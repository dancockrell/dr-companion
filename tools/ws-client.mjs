/**
 * Speaks the companion protocol to a bridge as an independent WebSocket
 * client. This is how the framing was verified in the first place: against
 * somebody else's WebSocket implementation rather than against our own.
 *
 * Run it directly against a bridge you started yourself (see
 * lich-scripts/test/README.md), or let tools/protocol-harness-test.mjs start
 * the harness and call `runProtocolClient` for you.
 *
 * It used to exit 0 on close whatever it had received, so a bridge that
 * accepted the socket and then said nothing at all passed exactly like a
 * working one. It now reports what it saw and the caller decides.
 */
import WebSocket from 'ws'

export const DEFAULT_URL = 'ws://127.0.0.1:7419/companion'

/** Frame types a working bridge must produce during the exchange below. */
export const EXPECTED_TYPES = ['hello', 'status', 'scripts', 'inventory', 'log', 'intent_ack']

/**
 * Drives one full exchange and resolves with `{ types, lines }`.
 *
 * @param {{url?: string, log?: (line: string) => void}} [options]
 */
export function runProtocolClient({ url = DEFAULT_URL, log = console.log } = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    const seen = []
    const lines = []
    const say = (line) => {
      lines.push(line)
      log(line)
    }
    const timers = []
    const later = (ms, fn) => timers.push(setTimeout(fn, ms))

    ws.on('open', () => {
      say('OPEN')
      ws.send(JSON.stringify({ type: 'subscribe', channels: ['status'] }))
      ws.send(JSON.stringify({ type: 'ping' }))
      ws.send(JSON.stringify({ type: 'get_inventory' }))
      later(400, () => ws.send(JSON.stringify({ type: 'intent', intent: 'stop_all' })))
      later(800, () => ws.send(JSON.stringify({ type: 'intent', intent: 'town_run' })))
      // Not JSON: the bridge must answer rather than drop the connection.
      later(1000, () => ws.send('this is not json'))
      later(1600, () => ws.close())
    })

    ws.on('message', (d) => {
      const m = JSON.parse(d.toString())
      seen.push(m.type)
      if (m.type === 'status') {
        const p = m.payload
        say(
          `STATUS name=${p.name} guild=${p.guild} inst=${p.instance} favors=${p.favors} hp=${p.vitals.health} situation=[${p.situation}] skills=${p.skills.length} activity="${p.activity}"`,
        )
        const ev = p.skills.find((s) => s.name === 'Evasion')
        if (ev) say(`  Evasion ranks=${ev.ranks} mindstate=${ev.mindstate} set=${ev.skillset}`)
      } else if (m.type === 'hello') {
        say(`HELLO protocol=${m.protocol} bridge=${m.bridgeVersion} lich=${m.lichVersion}`)
      } else if (m.type === 'intent_ack') {
        say(`ACK ${m.intent} ok=${m.ok} detail="${m.detail}"`)
      } else if (m.type === 'scripts') {
        say(`SCRIPTS ${JSON.stringify(m.payload)}`)
      } else if (m.type === 'inventory') {
        say(`INVENTORY containers=${m.payload.containers.length} worn=${m.payload.wornCount}`)
      } else if (m.type === 'log') {
        say(`LOG [${m.level || 'info'}] ${m.line}`)
      } else if (m.type === 'error') {
        say(`ERROR ${m.message}`)
      }
    })

    ws.on('close', () => {
      timers.forEach(clearTimeout)
      const types = [...new Set(seen)]
      say('CLOSED. types seen: ' + types.join(','))
      resolve({ types, lines })
    })
    ws.on('error', (e) => {
      timers.forEach(clearTimeout)
      say('WS ERROR ' + e.message)
      reject(e)
    })
  })
}

// Run directly: the same output as before, and now a non-zero exit when the
// bridge answered the socket without ever speaking the protocol.
const invokedDirectly =
  process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())

if (invokedDirectly) {
  const { types } = await runProtocolClient({ url: process.argv[2] || DEFAULT_URL })
  const missing = EXPECTED_TYPES.filter((t) => !types.includes(t))
  if (missing.length) {
    console.error(`missing frame types: ${missing.join(', ')}`)
    process.exit(1)
  }
}
