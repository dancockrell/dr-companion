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
})
