/**
 * The DevTools request deadline: it must fire, and it must not outlive the
 * request it was guarding.
 *
 * Both halves are here because fixing one is how you break the other. The
 * deadline in `browser.mjs` was a bare `setTimeout` that nothing cleared. It
 * worked - a request that never answers still rejects - and it also kept the
 * Node event loop alive for the full thirty seconds afterwards, because a
 * pending timer is a live handle whether or not anyone still wants it.
 *
 * So every `app-eyes` call took thirty seconds. Not the eval, which returned
 * in ~250ms with the right answer and exit 0; the process simply could not
 * leave. Three sessions used the tool heavily for an evening without filing
 * it, because correct output plus a zero exit plus silence is indistinguishable
 * from a busy machine. One of them nearly blamed the GPU.
 *
 * The obvious fix - delete the timer - would have made every symptom better
 * and removed a real protection. Hence both tests: one proves the deadline
 * still fires, the other proves it stops existing once answered.
 *
 * The deadline case asks for its own timeout through `requestTimeoutMs`, so it
 * takes a second and a half rather than thirty. A branch that can only be
 * reached by waiting out a real failure is one nobody exercises.
 *
 * It used to read `DRC_CDP_TIMEOUT_MS` instead, which meant the test's runtime
 * depended on whether its caller happened to set a variable - thirty seconds
 * inside a suite that otherwise runs in seconds. The environment variable
 * survives as an operator's escape hatch; a parameter is the right seam for a
 * test, because it cannot be accidentally left unset. The shipped default is
 * asserted separately, without waiting for it.
 */
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))

let failed = 0
const ok = (label, cond, detail = '') => {
  if (!cond) failed++
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${label.padEnd(56)}${detail}`)
}

/**
 * A CDP endpoint that completes the WebSocket handshake and then says nothing
 * ever again - which is the condition the deadline exists for, and one a real
 * browser will not produce on demand.
 */
async function silentEndpoint(port) {
  const srv = createServer((req, res) => {
    if (req.url.startsWith('/json/version')) {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/browser/silent` }))
    } else {
      res.statusCode = 404
      res.end()
    }
  })
  srv.on('upgrade', (req, sock) => {
    const key = req.headers['sec-websocket-key']
    const accept = createHash('sha1')
      .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
      .digest('base64')
    sock.write(
      'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    )
    // and then nothing, deliberately
  })
  await new Promise((r) => srv.listen(port, '127.0.0.1', r))
  return srv
}

/**
 * A CDP endpoint that answers just enough for `attach()` to succeed.
 *
 * Needed because the leak only exists on the path where a reply *arrives* -
 * that is where `clearTimeout` lives. A silent server exercises the timeout
 * branch instead, which is the opposite test.
 *
 * Frames are handled by hand: client frames are masked, server frames are not,
 * and only short text frames occur here, so the full spec is not needed.
 */
async function answeringEndpoint(port) {
  const srv = createServer((req, res) => {
    if (req.url.startsWith('/json/version')) {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/browser/x` }))
    } else {
      res.statusCode = 404
      res.end()
    }
  })
  srv.handled = 0
  srv.sockets = []

  srv.on('upgrade', (req, sock) => {
    const key = req.headers['sec-websocket-key']
    const accept = createHash('sha1')
      .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
      .digest('base64')
    sock.write(
      'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    )

    let buf = Buffer.alloc(0)
    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk])
      // One text frame at a time; payloads here are well under 126 bytes
      // except the odd larger one, so both short forms are handled.
      for (;;) {
        if (buf.length < 2) return
        const masked = (buf[1] & 0x80) !== 0
        let len = buf[1] & 0x7f
        let off = 2
        if (len === 126) {
          if (buf.length < 4) return
          len = buf.readUInt16BE(2)
          off = 4
        }
        const maskLen = masked ? 4 : 0
        if (buf.length < off + maskLen + len) return
        const mask = masked ? buf.subarray(off, off + 4) : null
        const payload = Buffer.from(buf.subarray(off + maskLen, off + maskLen + len))
        if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4]
        buf = buf.subarray(off + maskLen + len)

        let msg
        try {
          msg = JSON.parse(payload.toString('utf8'))
        } catch {
          continue
        }
        srv.handled++

        const result =
          msg.method === 'Target.getTargets'
            ? { targetInfos: [{ type: 'page', url: 'http://127.0.0.1:1420/', targetId: 'T1' }] }
            : msg.method === 'Target.attachToTarget'
              ? { sessionId: 'S1' }
              : {}

        const body = Buffer.from(JSON.stringify({ id: msg.id, result }), 'utf8')
        const header =
          body.length < 126
            ? Buffer.from([0x81, body.length])
            : Buffer.concat([Buffer.from([0x81, 126]), (() => { const b = Buffer.alloc(2); b.writeUInt16BE(body.length); return b })()])
        sock.write(Buffer.concat([header, body]))
      }
    })
    srv.sockets.push(sock)
    sock.on('error', () => {})
  })

  await new Promise((r) => srv.listen(port, '127.0.0.1', r))
  return srv
}

const { attach, DEFAULT_REQUEST_TIMEOUT_MS } = await import(`file://${join(HERE, 'browser.mjs').replace(/\\/g, '/')}`)

console.log('-- the deadline still fires against a target that never answers --')
{
  // A port unlikely to collide, and its own so a real browser is never
  // involved. See tools/fake-lich.mjs for why picking a port that something
  // real might want is its own class of bug.
  const PORT = 9934
  const srv = await silentEndpoint(PORT)
  // Driven by the parameter, not by the environment. Reading
  // `DRC_CDP_TIMEOUT_MS` here made this case take its full thirty seconds
  // whenever the suite ran without that variable set - a 30s test inside a run
  // that is otherwise seconds, and one whose duration depended on who invoked
  // it rather than on anything about the test. Asking for the deadline
  // explicitly is faster and makes it a fixed fact about this test.
  const DEADLINE = 1500
  const t0 = Date.now()
  let message = ''
  let resolved = false
  try {
    await attach({ port: PORT, timeoutMs: 3000, requestTimeoutMs: DEADLINE })
    resolved = true
  } catch (e) {
    message = e.message
  }
  const ms = Date.now() - t0
  srv.sockets?.forEach((x) => x.destroy())
  srv.unref?.()

  ok('it rejects rather than hanging', !resolved && /timed out/.test(message), message.slice(0, 60))

  // The denominator: without this, the check above would still pass thirty
  // seconds later and nobody would notice the parameter had stopped being
  // honoured.
  ok(
    'and within the deadline it was given, not the default',
    ms < DEADLINE + 2000,
    `${ms}ms against a ${DEADLINE + 2000}ms budget`
  )

  // The shipped default still gets covered, without waiting for it. A test
  // that only ever exercises an overridden value would not notice the default
  // being changed to something absurd.
  ok(
    'and the shipped default is unchanged',
    DEFAULT_REQUEST_TIMEOUT_MS === 30000,
    `${DEFAULT_REQUEST_TIMEOUT_MS}ms`
  )
}

console.log('\n-- and it does not outlive the request it was guarding --')
{
  // This has to run against an endpoint that *answers*, and the first version
  // did not - it reused the silent one above, where `onmessage` never fires,
  // so `clearTimeout` was never on the path being tested. It passed with the
  // fix deliberately reverted, which is a test that proves nothing.
  //
  // Caught by sabotage: removing the `clearTimeout` left the suite green.
  const PORT = 9935
  const srv = await answeringEndpoint(PORT)

  const before = process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length
  await attach({ port: PORT, timeoutMs: 3000 })
  const after = process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length
  srv.sockets?.forEach((x) => x.destroy())
  srv.unref?.()

  // Measured straight after `attach` rather than after `close()`, and the
  // session is deliberately left open.
  //
  // Every request `attach` makes has been answered by the time it returns, so
  // if the deadlines are cancelled on reply the count is back where it
  // started; if they are not, one timer per request is still standing. That
  // isolates the `clearTimeout`-on-response path exactly, and it does not
  // depend on `close()` doing its job - a test that needed both would not say
  // which one broke.
  //
  // It also sidesteps tearing a WebSocket client and server down inside one
  // process, which on Windows trips a libuv assertion at exit and turns a
  // correct verdict into exit 127. That is an environment quirk rather than
  // anything about this code, and a test whose exit code cannot be trusted is
  // one the runner would report as failing forever.
  ok('the attach actually issued requests', srv.handled >= 3, `${srv.handled} handled`)
  ok(
    'no timer survives a request that was answered',
    after <= before,
    `${before} before, ${after} after ${srv.handled} answered requests`
  )
}

console.log(failed ? `\n${failed} failed` : '\nall passed')

// Let the sockets finish closing before leaving.
//
// Tearing a WebSocket client and its server down inside one process and then
// exiting immediately trips a libuv assertion on Windows
// (`!(handle->flags & UV_HANDLE_CLOSING)`), which aborts with exit 127 *after*
// the verdict has already printed. The result was correct every time; the
// exit code was not, and the runner reads the exit code.
//
// Real use never hits this - there the server is a separate process - so this
// is a cost of the mock rather than anything about `browser.mjs`. One tick of
// grace is enough for the handles to finish.
await new Promise((r) => setTimeout(r, 250))
process.exit(failed ? 1 : 0)
