#!/usr/bin/env node
/**
 * Lane-private, not committed. Compiles a Crossing snapshot with one room
 * edited in the scene editor, so the viewer can be photographed drawing it.
 *
 * The point of the capture is that the override reaches the screen, so the
 * snapshot has to come from the real `compileWorldSnapshot` with the real
 * override store - not from a hand-written fixture, which would only prove
 * that Godot can draw a JSON file somebody typed.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
}

const { compileWorldSnapshot } = await import('../src/lib/presentationBridge.ts')
const { setSceneField } = await import('../src/lib/sceneOverrides.ts')

const ZONE = '1'
const SUBJECT = Number(process.argv[2] ?? 14)
const OUT = process.argv[3] ?? 'scene-override-fixture.json'

const map = JSON.parse(readFileSync(`src/data/map/${ZONE}.json`, 'utf8'))
const content = JSON.parse(readFileSync(`src/data/world/${ZONE}.json`, 'utf8'))
const byRoom = new Map(content.rooms.map((r) => [r.id, r]))

const zone = {
  ok: true,
  zone: ZONE,
  name: map.name,
  here: null,
  total: map.rooms.length,
  truncated: false,
  rooms: map.rooms.map((room) => ({
    id: room.id,
    uid: null,
    title: room.name,
    x: room.x,
    y: room.y,
    z: room.z,
    tags: room.label ? [room.label] : [],
    to: (room.exits ?? []).map((e) => e.to),
    mapColour: room.color,
    moves: (room.exits ?? []).map((e) => e.move.trim()).filter(Boolean),
    links: (room.exits ?? []).map((e) => ({ to: e.to, kind: 'walk' })),
  })),
}

const roomId = `${ZONE}-${SUBJECT}`
const before = compileWorldSnapshot({ zone, here: { id: SUBJECT }, character: null, content: byRoom, sequence: 1 })
const beforeCell = before.cells.find((c) => c.id === roomId)
console.log('before:', beforeCell.content.blockKind, beforeCell.board.footprint.height, 'm,', beforeCell.content.primitives.map((p) => p.kind).join(' '))

// The edit a person would make in the panel.
for (const [field, value] of [
  ['block', 'building-interior'],
  ['primitives', [
    { kind: 'water-ribbon-5m', x: -1.6, z: -1.6 },
    { kind: 'bridge-span-5m', x: 1.6, z: 1.6 },
  ]],
]) {
  const result = setSceneField(roomId, field, value)
  if (!result.ok) throw new Error(`${field}: ${result.reason}`)
}

const after = compileWorldSnapshot({ zone, here: { id: SUBJECT }, character: null, content: byRoom, sequence: 2 })
const afterCell = after.cells.find((c) => c.id === roomId)
console.log('after: ', afterCell.content.blockKind, afterCell.board.footprint.height, 'm,', afterCell.content.primitives.map((p) => `${p.kind}${p.offset ? `@${p.offset.x},${p.offset.z}` : ''}`).join(' '))

writeFileSync(OUT, JSON.stringify({ ...after, currentRoomId: roomId }, null, 2))
console.log(`wrote ${OUT}: ${after.cells.length} cells, focus ${roomId} (${afterCell.title})`)
