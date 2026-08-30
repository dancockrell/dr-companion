/**
 * Watch the game and say what is happening, without touching it. TypeScript
 * counterpart to `python/tasks/watch.py` - same behaviour, ported rather
 * than redesigned, so the two runtimes' "does the scripting stack work at
 * all" check says the same thing.
 *
 *     node --experimental-strip-types typescript/tasks/watch.ts
 *
 * Sends nothing - never calls `do()` - so it is safe to point at a live
 * character mid-session.
 */

import { Task, type CleanLine, type Vital } from '../drtask.ts'

class Watch extends Task {
  private previous: Partial<Record<string, Vital>> = {}

  override async onStart(): Promise<void> {
    const st = await this.c.status()
    console.log(`watching ${st.host}:${st.port} - ${st.lines} lines already in the buffer`)
    console.log('nothing will be sent. Ctrl+C to stop.\n')
  }

  override onVitals(vitals: Partial<Record<string, Vital>>): void {
    for (const [name, v] of Object.entries(vitals)) {
      if (!v) continue
      const was = this.previous[name]
      if (was && was.current === v.current && was.max === v.max) continue
      const arrow = !was ? '' : v.current > was.current ? '  up' : '  down'
      console.log(`  [vital] ${name.padEnd(14)} ${v.current}/${v.max} (${v.percent.toFixed(0)}%)${arrow}`)
    }
    this.previous = { ...vitals }
  }

  override onClean(line: CleanLine): void {
    // A bare prompt is punctuation, not an event - see watch.py's own note.
    if (line.text === '>' || line.text === '>>') return

    if (line.stream) {
      console.log(`  [${line.stream}] ${line.text}`)
      return
    }

    const low = line.text.toLowerCase()
    if (low.includes(' just arrived') || low.includes(' runs ') || low.includes(' walks ') || low.includes(' limps ')) {
      console.log(`  [room] ${line.text}`)
      return
    }

    if (low.includes('roundtime') || this.roundtimeUntil > Date.now()) {
      const left = Math.max(0, this.roundtimeUntil - Date.now()) / 1000
      if (left > 0) {
        console.log(`  [rt] ${left.toFixed(0)}s - ${line.text}`)
        return
      }
    }

    console.log(`        ${line.text}`)
  }
}

const watch = new Watch()
process.on('SIGINT', () => {
  console.log('\nstopped.')
  watch.stop()
  process.exit(0)
})
await watch.run()
