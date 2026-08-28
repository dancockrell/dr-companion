/**
 * The smallest useful script: watch the game, react to one thing. TypeScript
 * counterpart to `python/examples/hello.py`.
 *
 * Run it with DR Companion open and attached to a game:
 *
 *     node --experimental-strip-types typescript/examples/hello.ts
 *     node typescript/examples/hello.ts   # Node 24+, no flag needed
 */

import { Companion } from '../dr_companion.ts'

const c = new Companion()

c.on('line', (line) => {
  console.log(`[${line.seq}] ${line.text.trimEnd()}`)
})

const status = await c.status()
console.log(`attached: ${JSON.stringify(status)}`)
console.log('watching for game lines - Ctrl+C to stop')
