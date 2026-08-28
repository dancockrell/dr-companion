/**
 * The TypeScript side of the scripting API decided in docs/ENGINE.md.
 *
 * Same transport `python/dr_companion.py` talks to - `src-tauri/src/script_api.rs`'s
 * loopback socket, newline-delimited JSON, authenticated by a token the app
 * writes beside its own data on startup. That server was already
 * language-agnostic (`python/dr_companion.py`'s own docs say as much: "If you
 * are not using dr_companion.py - a script in another language, say - this is
 * everything it does for you"), so this is not new server-side work, only a
 * second client for a protocol that was never Python-specific.
 *
 * Zero npm dependencies, on purpose, for the same reason `dr_companion.py` is
 * pure standard library: `npm install` is a step between a script idea and
 * running it, and Node's own `net`/`fs`/`events` modules are enough. On
 * Node 24 (this project's stated minimum, see DEPENDENCIES.md), a `.ts` file
 * runs directly - `node your_script.ts` - no build step, the same "just run
 * it" promise Python makes. Older Node 22.6+ needs
 * `--experimental-strip-types` for the same thing; verified in this sandbox
 * at Node 22.22 with that flag.
 *
 * **The one real constraint that comes with "no build step":** Node's type
 * stripping erases type annotations only - it does not transpile TypeScript
 * features that generate actual code. Constructor parameter properties
 * (`constructor(public x: number) {}`) are the one `drtask.ts` hit first
 * (`SyntaxError [ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX]`); enums with values and
 * `namespace` blocks are the same category of problem. Assign fields the
 * plain way in a script's own code and this never comes up.
 *
 * # Where this deliberately differs from the Python client, and why
 *
 * `dr_companion.py`'s `Companion` blocks: `run()` loops on a synchronous
 * socket read and calls your handlers in between. Node has no equivalent
 * "blocking read" without spinning up a worker thread to fake it, and faking
 * it would fight the platform instead of using it. So this `Companion` is an
 * ordinary Node `EventEmitter` over an async socket: `on('line', ...)` /
 * `on('state', ...)` instead of `on_line`/`on_state`, and the process stays
 * alive because the socket has listeners, the same as any other Node network
 * client - there is no `run()` loop to call. `connect()`, `send()` and
 * `status()` are `async` because the underlying I/O is.
 *
 * # The same known gap Python has
 *
 * `Line.text` is the same raw wire chunk the Python client receives - see
 * `dr_companion.py`'s module docstring for the fuller version of this note.
 * `<pushStream id='thoughts'/>` markup is not parsed out here either.
 *
 * # Example
 *
 *     import { Companion } from './dr_companion.ts'
 *
 *     const c = new Companion()
 *     c.on('line', (line) => {
 *       if (line.text.toLowerCase().includes('you are stunned')) {
 *         c.send('stand')
 *       }
 *     })
 *     await c.connect()
 */

import { EventEmitter } from 'node:events'
import { existsSync, readFileSync } from 'node:fs'
import { createConnection, type Socket } from 'node:net'
import * as path from 'node:path'

export class ConnectionError extends Error {}
export class NotConnected extends Error {}

/** One chunk of game text. `seq` is stable and increasing; `text` is not
 * guaranteed to be one visual line - see the module note on markup. */
export interface Line {
  seq: number
  text: string
}

/** The app's own connection to Lich, as of the last time it was asked or the
 * last time it changed - not necessarily this instant. */
export interface Status {
  connected: boolean
  host: string
  port: number
  lines: number
  note: string
}

interface ConnectionInfo {
  port: number
  token: string
}

/** Mirrors `setup::app_data_dir()` on the Rust side - `%LOCALAPPDATA%` joined
 * with the app's data folder name. Throws rather than guessing a folder the
 * app never wrote to if the environment variable is absent. */
function dataDir(): string {
  const localAppData = process.env.LOCALAPPDATA
  if (!localAppData) {
    throw new ConnectionError(
      'LOCALAPPDATA is not set - cannot find where DR Companion keeps its data. ' +
        'Pass host/port/token to Companion() explicitly instead.',
    )
  }
  return path.join(localAppData, 'DR Companion Data')
}

function readConnectionInfo(dir: string): ConnectionInfo {
  const portFile = path.join(dir, 'script-api.port')
  const tokenFile = path.join(dir, 'script-api.token')

  if (!existsSync(portFile) || !existsSync(tokenFile)) {
    throw new ConnectionError(
      `No script API files found in ${dir}. Is DR Companion running? It writes these on startup.`,
    )
  }

  const portText = readFileSync(portFile, 'utf8').trim()
  const port = Number(portText)
  if (!Number.isInteger(port)) {
    throw new ConnectionError(`${portFile} does not contain a port number: ${JSON.stringify(portText)}`)
  }

  const token = readFileSync(tokenFile, 'utf8').trim()
  if (!token) {
    throw new ConnectionError(`${tokenFile} is empty`)
  }

  return { port, token }
}

function statusFrom(msg: Record<string, unknown>): Status {
  return {
    connected: Boolean(msg.connected),
    host: typeof msg.host === 'string' ? msg.host : '',
    port: typeof msg.port === 'number' ? msg.port : 0,
    lines: typeof msg.lines === 'number' ? msg.lines : 0,
    note: typeof msg.note === 'string' ? msg.note : '',
  }
}

export interface CompanionOptions {
  host?: string
  port?: number
  token?: string
  connectTimeoutMs?: number
}

export interface Companion {
  on(event: 'line', listener: (line: Line) => void): this
  on(event: 'state', listener: (status: Status) => void): this
  on(event: 'error', listener: (message: string) => void): this
  on(event: 'close', listener: () => void): this
}

/** One connection to the app, and the events a script listens for on it. */
export class Companion extends EventEmitter {
  private readonly host: string
  private port: number | undefined
  private token: string | undefined
  private readonly connectTimeoutMs: number
  private socket: Socket | null = null
  private buf = ''
  private statusWaiters: Array<(s: Status) => void> = []

  constructor(opts: CompanionOptions = {}) {
    super()
    if (opts.port === undefined || opts.token === undefined) {
      const found = readConnectionInfo(dataDir())
      opts.port = opts.port ?? found.port
      opts.token = opts.token ?? found.token
    }
    this.host = opts.host ?? '127.0.0.1'
    this.port = opts.port
    this.token = opts.token
    this.connectTimeoutMs = opts.connectTimeoutMs ?? 5000
  }

  /** Opens the socket and authenticates. Rejects on anything short of
   * success - there is no partially-connected state a caller needs to check
   * for. */
  async connect(): Promise<void> {
    if (this.port === undefined || this.token === undefined) {
      throw new ConnectionError('no port/token available')
    }
    const port = this.port
    const token = this.token

    const socket = await new Promise<Socket>((resolve, reject) => {
      const s = createConnection({ host: this.host, port }, () => resolve(s))
      s.setTimeout(this.connectTimeoutMs)
      s.once('timeout', () => reject(new ConnectionError(`connect to ${this.host}:${port} timed out`)))
      s.once('error', (e) => reject(new ConnectionError(String(e))))
    })
    this.socket = socket
    this.buf = ''

    const hello = await this.readOneMessage()
    if (hello === null || hello.type !== 'hello') {
      this.close()
      throw new ConnectionError(`expected a hello frame, got ${JSON.stringify(hello)}`)
    }

    this.writeMessage({ type: 'auth', token })
    const reply = await this.readOneMessage()
    if (reply === null || reply.type !== 'auth_ok') {
      this.close()
      throw new ConnectionError(
        'the app refused this token. If DR Companion was restarted, its token changed - reread it rather than reusing an old one.',
      )
    }

    socket.setTimeout(0)
    socket.on('data', (chunk) => this.onData(chunk))
    socket.on('close', () => this.emit('close'))
    socket.on('error', (e) => this.emit('error', String(e)))
  }

  close(): void {
    if (this.socket) {
      this.socket.destroy()
      this.socket = null
    }
  }

  /** Sends a command exactly as typed - no aliasing, no interpretation,
   * matching the Rust side's own `game_send`. Connects first if not already
   * connected. */
  async send(command: string): Promise<void> {
    if (this.socket === null) await this.connect()
    this.writeMessage({ type: 'send', command })
  }

  /** Asks the app once for its state, rather than waiting for the next
   * unprompted broadcast. Any `line` (or other) message that arrives first
   * is still emitted normally through the usual events - waiting for status
   * never swallows it. */
  async status(): Promise<Status> {
    if (this.socket === null) await this.connect()
    return new Promise<Status>((resolve) => {
      this.statusWaiters.push(resolve)
      this.writeMessage({ type: 'status' })
    })
  }

  private writeMessage(obj: Record<string, unknown>): void {
    if (this.socket === null) throw new NotConnected('call connect() first')
    this.socket.write(JSON.stringify(obj) + '\n')
  }

  /** One JSON object read directly off the socket, or `null` on a clean
   * close - used only for the handshake, before `data` events take over. */
  private readOneMessage(): Promise<Record<string, unknown> | null> {
    if (this.socket === null) throw new NotConnected('call connect() first')
    const socket = this.socket
    return new Promise((resolve, reject) => {
      const onData = (chunk: Buffer) => {
        this.buf += chunk.toString('utf8')
        const nl = this.buf.indexOf('\n')
        if (nl === -1) return
        const line = this.buf.slice(0, nl)
        this.buf = this.buf.slice(nl + 1)
        cleanup()
        if (!line.trim()) return resolve(null)
        try {
          resolve(JSON.parse(line))
        } catch {
          reject(new ConnectionError(`could not parse a message from the app: ${JSON.stringify(line)}`))
        }
      }
      const onClose = () => {
        cleanup()
        resolve(null)
      }
      const cleanup = () => {
        socket.off('data', onData)
        socket.off('close', onClose)
      }
      socket.on('data', onData)
      socket.on('close', onClose)
    })
  }

  /** Splits accumulated bytes on `\n` - a message and the start of the next
   * one can arrive in the same packet, or one message can be split across
   * two, same reasoning as `dr_companion.py`'s own `_read_message`. */
  private onData(chunk: Buffer): void {
    this.buf += chunk.toString('utf8')
    let nl: number
    while ((nl = this.buf.indexOf('\n')) !== -1) {
      const raw = this.buf.slice(0, nl)
      this.buf = this.buf.slice(nl + 1)
      if (!raw.trim()) continue
      let msg: Record<string, unknown>
      try {
        msg = JSON.parse(raw)
      } catch {
        this.emit('error', `could not parse a message from the app: ${JSON.stringify(raw)}`)
        continue
      }
      this.dispatch(msg)
    }
  }

  private dispatch(msg: Record<string, unknown>): void {
    switch (msg.type) {
      case 'line':
        this.emit('line', {
          seq: typeof msg.seq === 'number' ? msg.seq : 0,
          text: typeof msg.text === 'string' ? msg.text : '',
        } satisfies Line)
        break
      case 'state': {
        const status = statusFrom(msg)
        this.emit('state', status)
        const waiters = this.statusWaiters
        this.statusWaiters = []
        for (const resolve of waiters) resolve(status)
        break
      }
      case 'error':
        this.emit('error', typeof msg.message === 'string' ? msg.message : String(msg.message))
        break
      // Unknown message types are ignored, same reasoning as the Python
      // client: a future message kind this version doesn't know about
      // should not crash an already-running script.
    }
  }
}
