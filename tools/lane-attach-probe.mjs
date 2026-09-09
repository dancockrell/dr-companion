#!/usr/bin/env node
/**
 * Lane probe: measure #523 and #525 against whatever tree it is run in.
 *
 * Not a gate stage, and deliberately not a pass/fail check. It is the "show
 * the artefact" step - run on `origin/main` to establish the defects are real,
 * and again on the fix to show the same measurements moved. Every line prints
 * a number with a stated denominator and a verdict derived from that number,
 * so it reads correctly on both trees rather than asserting one of them.
 *
 * The regression checks are `tools/session-source-test.mjs` and
 * `tools/attach-states-test.mjs`.
 *
 * `src/store/useAppStore.ts` cannot be imported under plain node: it reaches
 * `import.meta.glob` through the map data. That is not an inconvenience, it is
 * half the finding - an invariant these two states must obey has to live in a
 * module a node test can load, which is why the fix is a `src/lib` module and
 * not four lines in the store. So the store half is read as source, and the
 * socket half is executed for real over a real loopback socket.
 */
import { mock } from 'node:test'
import net from 'node:net'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0)

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 11500 + (process.pid % 300)

// ------------------------------------------------------- a stand-in for Rust
const handlers = new Map()
const emit = (name, payload) => handlers.get(name)?.(payload)
let wire = null
let chunkSeq = 0
let linkState = { connected: false, host: '127.0.0.1', port: PORT, lines: 0, note: '' }

function dial(port) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1')
    socket.setNoDelay(true)
    socket.once('error', reject)
    socket.once('connect', () => {
      socket.removeListener('error', reject)
      wire = socket
      linkState = { connected: true, host: '127.0.0.1', port, lines: 0, note: '' }
      socket.on('data', (buf) => {
        emit('game:line', { seq: ++chunkSeq, receivedAtMs: Date.now(), text: buf.toString('utf8') })
      })
      socket.on('close', () => { wire = null })
      socket.on('error', () => {})
      resolve(linkState)
    })
  })
}

const stub = {
  isTauri: () => true,
  listenTauri: (name, fn) => { handlers.set(name, fn); return () => handlers.delete(name) },
  invokeTauri: async (command, args) => {
    switch (command) {
      case 'game_backlog': return { lines: [], dropped: 0 }
      case 'game_attach': return await dial(args?.port ?? PORT)
      case 'game_status': return linkState
      case 'game_detach': wire?.end(); linkState = { ...linkState, connected: false }; return linkState
      case 'game_send': wire?.write(`${args.command}\r\n`); return undefined
      case 'game_lane_status': return null
      case 'game_lane_flush': return 0
      case 'viewer_status': return undefined
      default: return undefined
    }
  },
  setAlwaysOnTop: async () => {},
  getBridgeDefaultUrl: async () => '',
  emitTauri: (event, payload) => emit(event, payload),
}
const nodeMajor = Number(process.versions.node.split('.')[0])
mock.module('../src/lib/tauri.ts', nodeMajor >= 24 ? { exports: stub } : { namedExports: stub })

const gameLink = await import('../src/lib/gameLink.ts')

const read = (rel) => {
  try {
    return readFileSync(join(root, rel), 'utf8')
  } catch {
    return ''
  }
}
const lifecycleSrc = read('src/store/bridgeLifecycle.ts')
const linkSrc = read('src/lib/gameLink.ts')
const appTsx = read('src/App.tsx')
const wfc = read('src/components/shared/WaitingForCharacter.tsx')
const switchSrc = read('src/store/sessionSwitch.ts')

// The shape a real game sends: two tagged channels, and the main window, which
// carries no tag at all. The main window is most of what a MUD says.
const TAGGED =
  '<pushStream id="thoughts"/>You hear the faint thoughts of Aral.<popStream/>\r\n' +
  'The Town Green, Northwest\r\n' +
  'Obvious paths: north, east.\r\n' +
  '<pushStream id="talk"/>Someone says, "well met."<popStream/>\r\n'

const server = net.createServer((s) => { s.write(TAGGED) })
await new Promise((r) => server.listen(PORT, '127.0.0.1', r))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let facts = 0
const say = (label, value) => { facts++; console.log(`  ${label}: ${value}`) }
const broken = (why) => {
  console.error(`  PROBE BROKEN: ${why}`)
  server.close()
  process.exit(2)
}

console.log('\n=== #523: is Attach reachable in a state where a socket can exist')
/*
 * Scoped to the console row. `{setupComplete && character &&` also opens the
 * TopBar block further up the file, and matching that one instead is exactly
 * how a check comes to be confidently right about the wrong line. The row is
 * found by its own aria-label and the gate is read from the text immediately
 * before it.
 */
const rowIdx = appTsx.indexOf('aria-label="Console"')
if (rowIdx < 0) broken('no console row in App.tsx, so its gate cannot be read')
const rowOpen = appTsx.slice(Math.max(0, rowIdx - 400), rowIdx)
const gatedOnCharacter = /\{setupComplete && character && \(/.test(rowOpen)
say('the console row is gated on `character`', gatedOnCharacter)
// Positive control: the pattern is capable of matching, so a `false` above is
// a fact about the row and not about the regexp.
const patternWorks = /\{setupComplete && character && \(/.test(appTsx)
say('  positive control - that pattern does match some block in this file', patternWorks)
if (!patternWorks) broken('the gate pattern matches nothing anywhere, so it cannot be read as absent')
say('the console row holds GameChatColumn', /aria-label="Console"[\s\S]{0,1800}<GameChatColumn \/>/.test(appTsx))
say('GameChatColumn owns GameConnectionBar', /<GameConnectionBar \/>/.test(read('src/components/room/GameChatColumn.tsx')))
say('setBridgeMode clears the character', /character: null/.test(lifecycleSrc))
say('WaitingForCharacter can tell an open socket from nothing', /sessionSource\(/.test(wfc))
console.log(
  gatedOnCharacter
    ? '  >>> Leave the demo -> character null -> the row unmounts -> the only Attach\n' +
      '      control is gone, while the socket it opened is still open.'
    : '  >>> The row renders on `setupComplete` alone, so Attach is on screen in every\n' +
      '      state in which a socket can exist.'
)

console.log('\n=== #525a: does anything own the demo and the socket together')
say('a module owns both', Boolean(switchSrc))
say('  it closes the socket before starting the demo', /detachGame\(\)[\s\S]{0,500}setBridgeMode\('mock'\)/.test(switchSrc))
say('  it leaves the demo before attaching', /setBridgeMode\('live'\)[\s\S]{0,500}attachGame\(/.test(switchSrc))
// Neither of these two files ever mentions the other, on either tree. That is
// the point: the owner is a third module, not a cross-reference between them.
say('setBridgeMode() alone mentions the game socket', /attachGame|detachGame|game_detach|gameLink/.test(lifecycleSrc))
say('attachGame() alone mentions the demo mode', /bridgeMode|setBridgeMode/.test(linkSrc))
console.log(
  switchSrc
    ? '  >>> One module ends the other source first, so the demo running beside a live\n' +
      '      socket is not reachable through any player act.'
    : "  >>> Nothing forbids bridgeMode === 'mock' with an open game socket. The demo\n" +
      '      banner says "this is invented data" over a window half full of real text.'
)

console.log('\n=== #525b: where the live text actually goes')
await gameLink.attachGame(PORT, '127.0.0.1')
await sleep(400)
const buf = gameLink.gameLines()
say('lines delivered through the socket (the denominator)', buf.length)
if (buf.length === 0) broken('nothing arrived through the socket, so nothing below means anything')
const untagged = buf.filter((l) => l.stream === '')
const channelled = buf.filter((l) => l.stream !== '')
say('untagged lines (the main game window)', untagged.length)
say('tagged lines (channels)', channelled.length)
if (untagged.length === 0 || channelled.length === 0) {
  broken('the fixture produced only one kind of line, so the comparison below is vacuous')
}

// The list `StreamTabs` builds its row from. `gameTabs()` on the fixed tree,
// `gameStreams()` before it existed.
const tabs = (gameLink.gameTabs ?? gameLink.gameStreams)()
say('the tab row a game pane can offer', JSON.stringify(tabs))

// Reachable = the line's stream is one of the tabs, so some tab can show it.
const reachable = (lines) => lines.filter((l) => tabs.includes(l.stream)).length
const mainReachable = reachable(untagged)
const chanReachable = reachable(channelled)
say('untagged lines reachable through a tab', `${mainReachable} of ${untagged.length}`)
say('tagged lines reachable (positive control)', `${chanReachable} of ${channelled.length}`)
if (chanReachable !== channelled.length) {
  broken('even the channel lines read as unreachable, so the measure is wrong, not the app')
}
// And the control that proves the measure can say yes for the main window too,
// given a tab list that contains it. Without this a `0` above could be the
// measure being incapable rather than the row being incomplete.
const wouldReach = untagged.filter((l) => [...tabs, ''].includes(l.stream)).length
say('  and with a main-window tab present they would be reachable', `${wouldReach} of ${untagged.length}`)
if (wouldReach !== untagged.length) {
  broken('the measure cannot say "reachable" even when handed a tab list containing the answer')
}
console.log(
  mainReachable === untagged.length
    ? `  >>> all ${buf.length} live lines have a tab. The main window is the empty stream.`
    : `  >>> ${untagged.length - mainReachable} of ${buf.length} live lines have no tab and cannot be\n` +
      '      displayed by any means: gameStreams() drops the empty stream with .filter(Boolean).'
)

console.log(`\n${facts} facts measured, socket ${gameLink.gameState().connected ? 'open' : 'closed'}.`)
await gameLink.detachGame()
server.close()
process.exit(0)
