/**
 * Local mock of the Lich companion_bridge WebSocket endpoint.
 * Lets the UI "Live Lich" mode be tested without real Lich.
 *
 *   node tools/mock-lich-server.mjs
 *   → ws://127.0.0.1:7415/companion
 *
 * Uses the 'ws' package if available; otherwise pure HTTP upgrade is not
 * attempted — install with: npm install ws --no-save
 */

import { createServer } from 'http'
import { WebSocketServer } from 'ws'

const PORT = 7415

/**
 * How long this mock may live before it stops on its own.
 *
 * Unlike tools/fake-lich.mjs, this one cannot simply move off the real port:
 * 7415 is where the app dials the companion bridge, so a mock anywhere else
 * is a mock nothing connects to. That makes a deadline the only guard
 * available here, and it matters more than it does there.
 *
 * If this starts before a real Lich, it wins 7415 and the real bridge cannot
 * bind. The app then connects to a mock that answers every intent and reports
 * a character - fabricated, but complete and plausible - so the dashboard
 * fills in and reads like a working live session. A sibling fixture held the
 * game socket for hours on 27 Aug 2026 and was found only when somebody went
 * looking for why a real Lich would not start. This one would be harder to
 * find, because it fails as success rather than as silence.
 *
 * --max-minutes 0 disables it. That is a decision someone makes, not a
 * default.
 */
const maxMinutesAt = process.argv.indexOf('--max-minutes')
const MAX_MINUTES =
  maxMinutesAt > 0 && process.argv[maxMinutesAt + 1]
    ? Number(process.argv[maxMinutesAt + 1])
    : 30

const character = {
  name: 'LiveMock Character',
  instance: 'Prime',
  accountTier: 'basic',
  location: {
    title: 'Crossing – Town Square Central',
    zone: 'Crossing',
    province: 'Zoluren',
    isTown: true,
    isSafe: true,
  },
  vitals: {
    health: 90,
    healthMax: 100,
    spirit: 100,
    spiritMax: 100,
    fatigue: 50,
    fatigueMax: 100,
  },
  situation: [],
  activity: 'Ready',
  connected: true,
}

const inventory = {
  containers: [
    { name: 'backpack', used: 12, capacity: 30 },
    { name: 'belt pouch', used: 3, capacity: 8 },
  ],
  wornCount: 10,
  looseCount: 0,
  pressure: 'ok',
}

function send(ws, obj) {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj))
}

const server = createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' })
  res.end('DR Companion mock Lich bridge — use WebSocket on /companion\n')
})

const wss = new WebSocketServer({ server, path: '/companion' })

wss.on('connection', (ws) => {
  console.log('[mock-lich] client connected')
  send(ws, {
    type: 'hello',
    protocol: 1,
    lichVersion: '5.20.1-mock-server',
    bridgeVersion: '0.1.0',
  })
  send(ws, { type: 'status', payload: character })
  send(ws, { type: 'inventory', payload: inventory })
  send(ws, { type: 'log', line: 'Mock Lich bridge ready.' })

  ws.on('message', (raw) => {
    let msg
    try {
      msg = JSON.parse(String(raw))
    } catch {
      send(ws, { type: 'error', message: 'bad json' })
      return
    }
    console.log('[mock-lich] ←', msg.type, msg.intent || '')

    if (msg.type === 'subscribe' || msg.type === 'get_status') {
      send(ws, { type: 'status', payload: character })
      return
    }
    if (msg.type === 'get_inventory') {
      send(ws, { type: 'inventory', payload: inventory })
      return
    }
    if (msg.type === 'ping') {
      send(ws, { type: 'log', line: 'pong' })
      return
    }
    if (msg.type === 'intent') {
      send(ws, { type: 'intent_ack', intent: msg.intent, ok: true })
      if (msg.intent === 'stop_all') {
        character.activity = 'Stopped'
        send(ws, { type: 'scripts', payload: [] })
        send(ws, { type: 'status', payload: character })
        send(ws, { type: 'log', line: 'All stopped (mock lich).' })
      } else if (msg.intent === 'go_healer') {
        character.activity = 'At Crossing Empath Guild'
        character.vitals.health = character.vitals.healthMax
        character.situation = []
        send(ws, { type: 'status', payload: character })
        send(ws, {
          type: 'log',
          line: 'Healer complete (mock lich — real scoring lives in Lich scripts).',
        })
      } else if (msg.intent === 'town_run') {
        character.activity = 'Town run (mock lich)'
        send(ws, {
          type: 'scripts',
          payload: [{ name: 'town-run', status: 'running' }],
        })
        send(ws, { type: 'status', payload: character })
        send(ws, { type: 'log', line: 'Town run started (mock lich).' })
      } else if (msg.intent === 'start_training') {
        character.activity = 'Training (attended)'
        send(ws, {
          type: 'scripts',
          payload: [{ name: 'training-core', status: 'running' }],
        })
        send(ws, { type: 'status', payload: character })
        send(ws, { type: 'log', line: 'Training started (mock lich).' })
      } else {
        send(ws, { type: 'log', line: `Intent: ${msg.intent}` })
      }
    }
  })

  ws.on('close', () => console.log('[mock-lich] client disconnected'))
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[mock-lich] ws://127.0.0.1:${PORT}/companion`)
  // Said plainly, because the thing that makes this dangerous is that it does
  // not look dangerous: every character field below is invented, and the app
  // cannot tell this apart from a bridge with a real game behind it.
  console.log(
    `[mock-lich] this holds ${PORT}, the real companion bridge port - a real Lich cannot bind it while this runs`
  )
  console.log('[mock-lich] every character value it reports is fabricated')

  if (MAX_MINUTES > 0) {
    console.log(
      `[mock-lich] will stop on its own in ${MAX_MINUTES} minutes (--max-minutes 0 to disable)`
    )
    // unref() so this is a deadline rather than a reason to stay alive.
    setTimeout(() => {
      console.log(
        `[mock-lich] ${MAX_MINUTES} minute limit reached, exiting so ${PORT} is not held for ever.`
      )
      process.exit(0)
    }, MAX_MINUTES * 60_000).unref()
  }
})
