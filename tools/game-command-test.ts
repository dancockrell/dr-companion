import assert from 'node:assert/strict'
import { validateGameActionCommand } from '../src/lib/gameCommand.ts'

let checks = 0
const accepts = (command: string) => {
  assert.equal(validateGameActionCommand(command), command)
  checks += 1
}
const rejects = (command: string) => {
  assert.throws(() => validateGameActionCommand(command))
  checks += 1
}

accepts('look iron sword')
accepts('appraise my crossing shield quick')
accepts('assess goblin')
rejects('look sword\n;quit')
rejects('look sword\rquit')
rejects('look sword;quit')
rejects(`look sword${String.fromCharCode(0)}quit`)
rejects(`look sword${String.fromCharCode(31)}quit`)
rejects('   ')
rejects(`look ${'x'.repeat(160)}`)

console.log(`game command validation: ${checks} assertions passed`)
