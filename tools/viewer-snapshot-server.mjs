#!/usr/bin/env node
/**
 * Publish one snapshot - with tokens in it - to the Godot viewer, so a token
 * can be photographed.
 *
 * # Why this exists
 *
 * The viewer's mock mode cannot show a token. `bridge_client.gd:_build_snapshot`
 * emits `"entities": []` and `"groundItems": []` with a comment saying why ("no
 * live entity/ground-item source exists yet in this slice - an empty array is
 * the honest state, never an invented occupant"), and it publishes no `player`
 * key either, so `entity_projection_layer.gd` renders nothing at all in mock
 * mode. Every board capture in docs/verification is therefore a picture of an
 * empty board, and issue #373 - every token drawn inside its own cell's block -
 * is invisible in all of them. That is not a gap in the captures; it is a gap
 * in what mock mode can be asked.
 *
 * The other half of the viewer can be asked. `world_root.gd --live-presentation`
 * connects to the Tauri-owned loopback bridge and takes whatever snapshot it is
 * sent. This is the smallest thing that speaks that protocol
 * (`godot/scripts/bridge_client.gd`, protocol 1, newline-delimited JSON over
 * loopback TCP): hello, auth against a token file, one snapshot, then it holds
 * the connection open so the window stays up to be captured.
 *
 * # It does not touch the app's own bridge files
 *
 * `BridgeClient.start_live()` looks for `presentation-bridge.port` and
 * `.token` under `%LOCALAPPDATA%\DR Companion Data`, which is a real installed
 * location another session's app may be using. This writes its pair into a
 * directory of its own and the caller points the *viewer process alone* at it
 * with `LOCALAPPDATA`, so a running app's bridge is untouched.
 *
 * # The tokens are a fixture, and are labelled one
 *
 * The entities below are not game content and are not read from anywhere: they
 * are one of each role the board publishes a spawn point for, named so that
 * nothing can mistake a capture of them for a capture of a real room.
 *
 *   node tools/viewer-snapshot-server.mjs --config-dir <dir> [--room <cellId>]
 *
 * It prints the port it bound and the directory it wrote, then stays up until
 * killed.
 */
import { createServer } from 'node:net'
import { randomBytes } from 'node:crypto'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const argument = (name, fallback = '') => {
  const at = process.argv.indexOf(name)
  return at === -1 || at === process.argv.length - 1 ? fallback : process.argv[at + 1]
}

const CONFIG_DIR = argument('--config-dir')
if (!CONFIG_DIR) {
  console.error('FAILED: --config-dir is required; it is where the port/token pair is written')
  process.exit(2)
}
const FIXTURE = argument('--fixture', 'godot/mock/crossing_mock_world.json')
const world = JSON.parse(readFileSync(FIXTURE, 'utf8'))
const ROOM = argument('--room', world.currentRoomId)
if (!world.cells.some((cell) => cell.id === ROOM)) {
  console.error(`FAILED: ${ROOM} is not a cell in ${FIXTURE}`)
  process.exit(2)
}

/** One token per role the board publishes a spawn point for, plus a tactical
 * entity - the path that is staged on a range band rather than on an anchor,
 * and the one that carried the hand-typed height issue #373 is about. */
const snapshotFor = (sequence) => ({
  ...world,
  protocol: 1,
  type: 'snapshot',
  sequence,
  worldId: 'capture-fixture',
  currentRoomId: ROOM,
  activeRoom: world.cells.find((cell) => cell.id === ROOM),
  player: { cannotAct: false, roundtime: 0, health: 1, situation: [] },
  entities: [
    { id: 'fixture-occupant', roomId: ROOM, name: 'FIXTURE occupant', deck: 'people' },
    { id: 'fixture-second', roomId: ROOM, name: 'FIXTURE bystander', deck: 'people' },
    {
      id: 'fixture-hostile',
      roomId: ROOM,
      name: 'FIXTURE hostile',
      deck: 'hostile',
      tactical: { range: 'melee', target: 'you', disengaged: false, dead: false, statuses: [], conditions: [], enrichedAgeSeconds: 2 },
    },
  ],
  groundItems: [
    { id: 'fixture-item', roomId: ROOM, name: 'a FIXTURE dagger' },
    { id: 'fixture-item-2', roomId: ROOM, name: 'a FIXTURE coin' },
  ],
})

const token = randomBytes(32).toString('hex')
mkdirSync(CONFIG_DIR, { recursive: true })
writeFileSync(join(CONFIG_DIR, 'presentation-bridge.token'), token)

let sequence = 0
const server = createServer((socket) => {
  let authenticated = false
  let buffered = ''
  console.log('viewer connected')
  socket.write(`${JSON.stringify({ protocol: 1, type: 'hello' })}\n`)
  socket.on('data', (chunk) => {
    buffered += chunk.toString('utf8')
    let newline = buffered.indexOf('\n')
    while (newline >= 0) {
      const line = buffered.slice(0, newline).trim()
      buffered = buffered.slice(newline + 1)
      if (line) {
        const message = JSON.parse(line)
        if (message.type === 'auth') {
          authenticated = message.token === token
          socket.write(`${JSON.stringify({ type: authenticated ? 'auth_ok' : 'auth_failed' })}\n`)
          if (authenticated) {
            sequence += 1
            socket.write(`${JSON.stringify(snapshotFor(sequence))}\n`)
            console.log(`published snapshot ${sequence}: ${world.cells.length} cells, 3 entities, 2 ground items, room ${ROOM}`)
          }
        }
      }
      newline = buffered.indexOf('\n')
    }
  })
  socket.on('error', (error) => console.log(`viewer socket error: ${error.message}`))
})

server.listen(0, '127.0.0.1', () => {
  const { port } = server.address()
  writeFileSync(join(CONFIG_DIR, 'presentation-bridge.port'), String(port))
  console.log(`listening on 127.0.0.1:${port}, wrote port and token into ${CONFIG_DIR}`)
})
