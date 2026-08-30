/**
 * A base for DragonRealms tasks written in TypeScript - the same layer
 * `python/drtask.py` is for Python, over `dr_companion.ts` instead of
 * `dr_companion.py`. Ported line-for-line where the two languages let it:
 * the parsing regexes, the vital/roundtime handling and the safety cap below
 * are the same rules, not re-derived, so the two runtimes cannot quietly
 * disagree with each other about what a `progressBar` or a `roundTime` tag
 * means. See `drtask.py`'s own module docstring for the grounding
 * (`xmlparser.rb` line references and all) - not repeated here to avoid two
 * copies of the same citation drifting apart.
 *
 * # The safety rule this file exists to enforce
 *
 * **A task cannot send commands faster than MAX_COMMANDS_PER_MINUTE.**
 * Enforced in `do()`, the one method anything reaches the game through, and
 * a task cannot turn it off - see `drtask.py` for why this matters more than
 * it looks like it should.
 *
 * # Use
 *
 *     import { Task } from './drtask.ts'
 *
 *     class Watch extends Task {
 *       onClean(line) {
 *         if (line.text.toLowerCase().includes('you are stunned')) {
 *           this.do('stand')
 *         }
 *       }
 *     }
 *     await new Watch().run()
 */

import { Companion, type Line } from './dr_companion.ts'

export class RateLimited extends Error {}

/** Comfortably above human play, far below anything that looks automated -
 * see `drtask.py`'s own comment on this number. Kept identical rather than
 * re-tuned per language: two different caps for the same safety property
 * would be a harder thing to explain than a single shared constant. */
export const MAX_COMMANDS_PER_MINUTE = 40

const TAG = /<[^>]*>/g
const ENTITIES: Record<string, string> = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&apos;': "'" }

const STREAM_OPEN = /<pushStream\s+id=['"]([^'"]+)['"]\s*\/?>/
const PROGRESS = /<progressBar\s+[^>]*id=['"]([^'"]+)['"][^>]*text=['"]([^'"]*)['"]/g
const ROUNDTIME = /<roundTime\s+value=['"](\d+)['"]/

/** The five DragonRealms vitals - a fixed set, same reasoning as
 * `drtask.py`'s `VITAL_IDS`: an unknown `progressBar` id is not a vital. */
export const VITAL_IDS = ['health', 'mana', 'stamina', 'spirit', 'concentration'] as const
export type VitalId = (typeof VITAL_IDS)[number]

/** Decode entities once. `&amp;lt;` must stay `&lt;`, so `&amp;` is last. */
export function unescape(text: string): string {
  let out = text
  for (const [entity, ch] of Object.entries(ENTITIES)) {
    if (entity !== '&amp;') out = out.split(entity).join(ch)
  }
  return out.split('&amp;').join('&')
}

/** `<d cmd='east'>east</d>` becomes `east` - the tag is presentation, the
 * word is what the player read.
 *
 * Loops the regex to a fixed point rather than one `replace()` pass -
 * flagged by CodeQL (`js/incomplete-multi-character-sanitization`) on the
 * single-pass version: removing one match can splice two surviving
 * fragments into a new `<...>` span the regex never re-scans for
 * (`<scri<script>pt>` loses the inner tag in one pass and is left holding
 * `pt>`, but a differently-shaped input can reassemble one). Looping until a
 * pass changes nothing closes that regardless of the specific construction,
 * rather than patching the one shape found. Terminates in at most
 * `text.length` iterations - each pass only removes characters or leaves the
 * string unchanged, never adds any. */
export function stripTags(text: string): string {
  let current = text
  for (;;) {
    const next = current.replace(TAG, '')
    if (next === current) break
    current = next
  }
  return unescape(current)
}

export class Vital {
  readonly current: number
  readonly max: number
  /** `false` when the game has not reported this vital yet - see
   * `percent`'s own doc for why this matters. */
  readonly known: boolean

  constructor(current: number, max: number, known = true) {
    this.current = current
    this.max = max
    this.known = known
  }

  /** Percent full, or `NaN` when the vital is unknown.
   *
   * `NaN` rather than `0`, and this is the important line in the file - see
   * `drtask.py`'s `Vital.percent` for the full reasoning (a fixture with no
   * health bar making a branching flow decide the character needed
   * treatment, caught on the first real run). Every comparison against
   * `NaN` is `false` in both directions, so `< 50` and `> 50` are both
   * false while the answer is unknown, which is the only safe default. */
  get percent(): number {
    if (!this.known || this.max <= 0) return NaN
    return (100 * this.current) / this.max
  }
}

export interface CleanLine {
  seq: number
  text: string
  stream: string
  raw: string
}

class Rate {
  private sent: number[] = []

  record(now: number): number {
    this.sent = this.sent.filter((t) => now - t < 60_000)
    this.sent.push(now)
    return this.sent.length
  }
}

export interface DoOptions {
  /** `false` for the handful of commands DragonRealms accepts during
   * roundtime - `look`, `health`, `exp` and the like, or a Lich `;` command
   * that never reaches the game at all. Default `true`. */
  waitRt?: boolean
}

export class Task {
  readonly c: Companion
  readonly vitals: Partial<Record<VitalId, Vital>> = {}
  /** Epoch millisecond the current roundtime ends, or 0. */
  roundtimeUntil = 0
  private readonly rate = new Rate()
  private stopping = false
  private closed = new Promise<void>((resolve) => {
    this.resolveClosed = resolve
  })
  private resolveClosed!: () => void

  constructor(companion?: Companion) {
    this.c = companion ?? new Companion()
  }

  // -- hooks, override these -------------------------------------------

  onClean(_line: CleanLine): void {}
  onVitals(_vitals: Partial<Record<VitalId, Vital>>): void {}
  onStart(): void | Promise<void> {}

  // -- actions ------------------------------------------------------------

  /** Sends a command, respecting roundtime and the rate cap - see the
   * module docstring. */
  async do(command: string, opts: DoOptions = {}): Promise<void> {
    const waitRt = opts.waitRt ?? true
    if (waitRt) await this.waitRt()

    const count = this.rate.record(Date.now())
    if (count > MAX_COMMANDS_PER_MINUTE) {
      this.stop()
      throw new RateLimited(
        `${count} commands in the last minute, cap is ${MAX_COMMANDS_PER_MINUTE}. The task has been stopped.\n` +
          'This is almost always a loop that never sees its own exit condition - check what the task is waiting for, rather than raising the cap.',
      )
    }
    await this.c.send(command)
  }

  /** Resolves once the current roundtime has passed. */
  async waitRt(extraMs = 200): Promise<void> {
    for (;;) {
      const remaining = this.roundtimeUntil - Date.now()
      if (remaining <= 0) return
      await sleep(Math.min(remaining + extraMs, 1000))
    }
  }

  stop(): void {
    this.stopping = true
    this.c.close()
  }

  // -- plumbing -------------------------------------------------------

  private feed(line: Line): void {
    const raw = line.text

    const rt = ROUNDTIME.exec(raw)
    if (rt) this.roundtimeUntil = Number(rt[1]) * 1000

    let changed = false
    PROGRESS.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = PROGRESS.exec(raw)) !== null) {
      const id = m[1].toLowerCase() as VitalId
      if (!(VITAL_IDS as readonly string[]).includes(id)) continue
      const nums = m[2].match(/-?\d+/g)
      if (!nums || nums.length < 2) continue
      this.vitals[id] = new Vital(Number(nums[0]), Number(nums[1]))
      changed = true
    }
    if (changed) this.onVitals(this.vitals)

    const streamMatch = STREAM_OPEN.exec(raw)
    const stream = streamMatch ? streamMatch[1] : ''

    const text = stripTags(raw).trim()
    if (text) {
      this.onClean({ seq: line.seq, text, stream, raw })
    }
  }

  /** Connects, wires the hooks, and resolves once the connection closes
   * (Stop, or the process's own `stop()`). Unlike `drtask.py`'s `run()`,
   * this does not block a thread - it is just a promise a script can
   * `await` at the end so `node script.ts` does not exit early, the same
   * role `dr_companion.py`'s `run()` loop plays for Python. */
  async run(): Promise<void> {
    await this.c.connect()
    this.c.on('line', (line) => this.feed(line))
    this.c.on('close', () => this.resolveClosed())
    await this.onStart()
    await this.closed
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
