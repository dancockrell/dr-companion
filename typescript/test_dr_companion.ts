/**
 * dr_companion.ts against a bare TCP server standing in for the app -
 * the same pattern `game_link.rs`'s own Rust tests use for Lich (a bare
 * `TcpListener`), and the honest option here: this project's Tauri app does
 * not run in this environment, so there is no live DR Companion to test
 * against the way `python/test_dr_companion.py` does. A fake server that
 * speaks the real wire protocol is a closer test of this file than skipping
 * the network entirely.
 *
 * Run with:
 *
 *     node --experimental-strip-types typescript/test_dr_companion.ts
 *     node typescript/test_dr_companion.ts   # Node 24+, no flag needed
 */

import { createServer, type Socket } from 'node:net'
import { Companion, type Line, type Status } from './dr_companion.ts'

let failed = 0
function ok(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${label.padEnd(58)}${detail}`)
  if (!cond) failed++
}

/** A minimal fake app: hello, auth, then whatever the test wants to push. */
function startFakeServer(token: string): Promise<{ port: number; close: () => void; send: (obj: object) => void }> {
  return new Promise((resolve) => {
    let client: Socket | null = null
    const server = createServer((socket) => {
      client = socket
      let buf = ''
      socket.write(JSON.stringify({ type: 'hello', version: 1 }) + '\n')
      socket.on('data', (chunk) => {
        buf += chunk.toString('utf8')
        const nl = buf.indexOf('\n')
        if (nl === -1) return
        const msg = JSON.parse(buf.slice(0, nl))
        buf = buf.slice(nl + 1)
        if (msg.type === 'auth') {
          if (msg.token === token) {
            socket.write(JSON.stringify({ type: 'auth_ok' }) + '\n')
          } else {
            socket.write(JSON.stringify({ type: 'auth_failed' }) + '\n')
            socket.end()
          }
        }
        // 'send'/'status' requests from the client are otherwise ignored -
        // this fake only pushes what the test explicitly asks it to.
      })
    })
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (addr === null || typeof addr === 'string') throw new Error('unexpected server address')
      resolve({
        port: addr.port,
        close: () => server.close(),
        send: (obj: object) => {
          if (!client) throw new Error('no client connected yet')
          client.write(JSON.stringify(obj) + '\n')
        },
      })
    })
  })
}

async function main(): Promise<number> {
  const token = 'test-token-12345'

  // -- connect() succeeds against a real handshake -----------------------
  {
    const fake = await startFakeServer(token)
    const c = new Companion({ host: '127.0.0.1', port: fake.port, token })
    await c.connect()
    ok('connect() completes the hello/auth handshake', true)
    c.close()
    fake.close()
  }

  // -- connect() rejects a bad token ---------------------------------
  {
    const fake = await startFakeServer(token)
    const c = new Companion({ host: '127.0.0.1', port: fake.port, token: 'wrong' })
    let threw = false
    try {
      await c.connect()
    } catch {
      threw = true
    }
    ok('connect() rejects a bad token', threw)
    fake.close()
  }

  // -- line/state events fire, in order, after connect --------------------
  {
    const fake = await startFakeServer(token)
    const c = new Companion({ host: '127.0.0.1', port: fake.port, token })
    await c.connect()

    const lines: Line[] = []
    const states: Status[] = []
    c.on('line', (l) => lines.push(l))
    c.on('state', (s) => states.push(s))

    fake.send({ type: 'line', seq: 1, text: 'hello world' })
    fake.send({ type: 'state', connected: true, host: '127.0.0.1', port: 11024, lines: 1, note: '' })

    await new Promise((r) => setTimeout(r, 50))

    ok('a line event fires with the right text', lines.length === 1 && lines[0].text === 'hello world', JSON.stringify(lines))
    ok('a state event fires with the right shape', states.length === 1 && states[0].connected === true, JSON.stringify(states))

    c.close()
    fake.close()
  }

  // -- status() resolves on the next state message, not before ------------
  {
    const fake = await startFakeServer(token)
    const c = new Companion({ host: '127.0.0.1', port: fake.port, token })
    await c.connect()

    // A line arriving before the state reply must still be emitted, not
    // swallowed by the pending status() call - the same guarantee
    // dr_companion.py's status() makes.
    const lines: Line[] = []
    c.on('line', (l) => lines.push(l))

    const statusPromise = c.status()
    fake.send({ type: 'line', seq: 2, text: 'a line that arrived first' })
    fake.send({ type: 'state', connected: true, host: '127.0.0.1', port: 11024, lines: 2, note: '' })

    const status = await statusPromise
    ok('status() resolves with the state message', status.lines === 2, JSON.stringify(status))
    ok("status() does not swallow a line that arrived first", lines.length === 1, JSON.stringify(lines))

    c.close()
    fake.close()
  }

  // -- a malformed message on the wire is reported, not thrown -----------
  {
    const fake = await startFakeServer(token)
    const c = new Companion({ host: '127.0.0.1', port: fake.port, token })
    await c.connect()

    const errors: string[] = []
    c.on('error', (msg) => errors.push(msg))
    fake.send({ type: 'error', message: 'something went wrong' })
    await new Promise((r) => setTimeout(r, 50))
    ok("an 'error' message is emitted as an 'error' event", errors.length === 1 && errors[0] === 'something went wrong')

    c.close()
    fake.close()
  }

  if (failed) {
    console.log(`\n${failed} check(s) FAILED`)
    return 1
  }
  console.log('\nall checks OK')
  return 0
}

main().then((code) => process.exit(code))
